import { useCallback, useEffect, useMemo, useState } from "react";
import { Moon, Sun } from "./components/icons";
import type { CaseOutcome, RadCase, RoundFilters, RoundRecord, ScoringSettings } from "./types";
import { DEFAULT_SCORING } from "./types";
import {
  clearHistory,
  deleteCase,
  getAllCases,
  loadSettings,
  parseImportedCases,
  saveCase,
  saveSettings,
} from "./lib/storage";
import {
  clearAccountHistory,
  loadAccountHistory,
  loadAccountSettings,
  saveAccountRound,
  saveAccountSettings,
} from "./lib/accountData";
import { Landing } from "./views/Landing";
import { Home } from "./views/Home";
import { Play } from "./views/Play";
import { Summary } from "./views/Summary";
import { Cases } from "./views/Cases";
import { Editor } from "./views/Editor";
import { Study } from "./views/Study";
import { Stats } from "./views/Stats";
import { Viewer } from "./views/Viewer";
import { Admin } from "./views/Admin";
import {
  applyGlobalCaseOverride,
  mergeGlobalCaseOverrides,
  saveGlobalCaseOverride,
} from "./lib/admin";
import { useAuth } from "./lib/auth";
import { AccountMenu } from "./components/AccountMenu";
import { deleteCloudCase, loadCloudCases, syncCaseToCloud } from "./lib/r2";
import {
  loadPublishedLibraryCases,
  prepareLibraryCaseMedia,
  publishLibraryCase,
  publishPreparedLibraryCase,
} from "./lib/libraryCases";
import {
  prepareAcquisitionMedia,
  saveAcquisition,
  type AcquisitionRecord,
} from "./lib/acquisition";

type Route =
  | { view: "landing" }
  | { view: "home" }
  | { view: "play"; cases: RadCase[]; filters: RoundFilters }
  | { view: "summary"; outcomes: CaseOutcome[]; filters: RoundFilters }
  | { view: "library" }
  | { view: "personal" }
  | { view: "admin"; section?: "library" | "acquisition" }
  | { view: "editor"; existing: RadCase | null; back: "personal" | "admin"; acquisition?: AcquisitionRecord }
  | { view: "study"; startAt: number; back: "library" | "personal" | "admin" }
  | { view: "viewer" }
  | { view: "stats" };

type Theme = "dark" | "light";

function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(
    () => (document.documentElement.dataset.theme as Theme) ?? "dark",
  );
  const toggle = useCallback(() => {
    setTheme((t) => {
      const next = t === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = next;
      localStorage.setItem("pinpoint:theme", next);
      return next;
    });
  }, []);
  return [theme, toggle];
}

function pickRound(cases: RadCase[], f: RoundFilters): RadCase[] {
  const pool = cases.filter(
    (c) =>
      (f.source === "all" || (f.source === "library" ? c.seed : !c.seed)) &&
      (f.modalities.length === 0 || f.modalities.includes(c.modality)) &&
      (f.subspecialties.length === 0 || f.subspecialties.includes(c.subspecialty)) &&
      (f.difficulties.length === 0 || f.difficulties.includes(c.difficulty)),
  );
  if (!f.shuffle) return pool;
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function hasLocalCaseMedia(radCase: RadCase): boolean {
  return !!(
    radCase.imageBlob ||
    radCase.imageBlobs?.length ||
    radCase.dicomBlobs?.length ||
    radCase.posterBlob
  );
}

function acquisitionCaseDraft(record: AcquisitionRecord, cases: RadCase[]): RadCase {
  const published = record.draftCase ?? (record.libraryCaseId
    ? cases.find((radCase) => radCase.id === record.libraryCaseId)
    : undefined);
  if (published) return published;
  const bodyRegion = record.subspecialty === "Abdominal" ? "Abdomen"
    : record.subspecialty === "Neuro" || record.subspecialty === "Head & Neck" ? "Head"
      : record.subspecialty === "MSK" ? "Upper limb" : "Chest";
  return {
    id: record.libraryCaseId ?? `library-${record.id.replace(/^candidate-/, "")}`,
    title: record.finding,
    explanation: "",
    modality: record.modality,
    bodyRegion,
    subspecialty: record.subspecialty,
    difficulty: record.targetDifficulty,
    regions: [],
    imageUrl: record.preparedMedia?.imageUrl,
    credit: record.attribution,
    creditUrl: record.sourceUrl,
    mediaQa: record.preparedMedia?.mediaQa,
    seed: true,
    createdAt: Date.now(),
  };
}

export default function App() {
  const [route, setRoute] = useState<Route>(() =>
    location.pathname.replace(/\/$/, "") === "/admin"
      ? { view: "admin" }
      : { view: "landing" },
  );
  const [cases, setCases] = useState<RadCase[]>([]);
  const [settings, setSettings] = useState<ScoringSettings>(loadSettings);
  const [history, setHistory] = useState<RoundRecord[]>([]);
  const [accountDataError, setAccountDataError] = useState<string | null>(null);
  const [theme, toggleTheme] = useTheme();
  const auth = useAuth();

  const refreshCases = useCallback(async () => {
    const localCases = await getAllCases();
    // Browser-owned personal cases belong to guest mode. Authenticated users
    // only see bundled cases plus their own RLS-protected cloud cases.
    const visibleLocalCases = auth.user
      ? localCases.filter((radCase) => radCase.seed)
      : localCases;
    const byId = new Map(visibleLocalCases.map((radCase) => [radCase.id, radCase]));
    for (const radCase of await loadPublishedLibraryCases()) byId.set(radCase.id, radCase);
    if (auth.user) {
      try {
        const cloudCases = await loadCloudCases();
        for (const radCase of cloudCases) byId.set(radCase.id, radCase);
        // Older builds cached signed-in cases in the shared browser database.
        // Remove only duplicates that are safely present in this user's cloud
        // account so they cannot reappear after sign-out or account switching.
        const cloudIds = new Set(cloudCases.map((radCase) => radCase.id));
        await Promise.all(
          localCases
            .filter((radCase) => !radCase.seed && cloudIds.has(radCase.id))
            .map((radCase) => deleteCase(radCase)),
        );
      } catch (error) {
        console.warn("Could not load cloud cases; using the local cache.", error);
      }
    }
    setCases(await mergeGlobalCaseOverrides([...byId.values()]));
  }, [auth.user]);

  useEffect(() => {
    void refreshCases();
  }, [refreshCases]);

  useEffect(() => {
    let active = true;
    setAccountDataError(null);
    if (!auth.user) {
      // Guest progress is deliberately session-only. Remove history written
      // by older builds so refreshing or revisiting always starts clean.
      clearHistory();
      setHistory([]);
      setSettings(loadSettings());
      return () => {
        active = false;
      };
    }
    void Promise.all([loadAccountHistory(), loadAccountSettings()])
      .then(([nextHistory, nextSettings]) => {
        if (!active) return;
        setHistory(nextHistory);
        setSettings(nextSettings);
      })
      .catch((error) => {
        if (!active) return;
        // Never fall back to another browser user's data while authenticated.
        setHistory([]);
        setSettings({ ...DEFAULT_SCORING });
        setAccountDataError(
          error instanceof Error ? error.message : "Could not load private account data.",
        );
      });
    return () => {
      active = false;
    };
  }, [auth.user]);

  // A shared-set deep link (?share=CODE) imports on load, then lands the user
  // in My cases so they can see what arrived.
  useEffect(() => {
    if (auth.loading) return;
    const params = new URLSearchParams(location.search);
    const code = params.get("share") ?? params.get("import");
    if (!code) return;
    window.history.replaceState(null, "", location.pathname);
    (async () => {
      try {
        const { importFromCloud, parseCasesFromCloud } = await import("./lib/cloud");
        if (auth.user) {
          const imported = await parseCasesFromCloud(code);
          for (const radCase of imported) await syncCaseToCloud(radCase);
        } else {
          await importFromCloud(code);
        }
        refreshCases();
        setRoute({ view: "personal" });
      } catch {
        /* invalid or unreachable code; stay on the landing page */
      }
    })();
  }, [auth.loading, auth.user, refreshCases]);

  const updateSettings = useCallback((s: ScoringSettings) => {
    setSettings(s);
    if (auth.user) {
      void saveAccountSettings(s).catch((error) => {
        setAccountDataError(
          error instanceof Error ? error.message : "Could not save account settings.",
        );
      });
    } else {
      saveSettings(s);
    }
  }, [auth.user]);

  const finishRound = useCallback(
    async (outcomes: CaseOutcome[], filters: RoundFilters) => {
      const flat = outcomes.flatMap((c) => c.outcomes);
      const byModality: Record<string, { hits: number; total: number }> = {};
      for (const c of outcomes) {
        const entry = (byModality[c.modality] ??= { hits: 0, total: 0 });
        entry.total += Math.max(c.outcomes.length, 1);
        entry.hits += c.outcomes.filter((o) => o.result === "hit").length;
      }
      const record: RoundRecord = {
        id: `round-${Date.now()}`,
        finishedAt: Date.now(),
        caseCount: outcomes.length,
        totalScore: outcomes.reduce((a, c) => a + c.baseScore + c.timeBonus, 0),
        maxScore:
          outcomes.length *
          (settings.hitPoints + (settings.timerSeconds > 0 ? settings.timerBonusMax : 0)),
        hits: flat.filter((o) => o.result === "hit").length,
        nears: flat.filter((o) => o.result === "near").length,
        misses: flat.filter((o) => o.result === "miss").length,
        byModality,
      };
      // Leave the playable screen immediately so the final action cannot be
      // submitted twice while the private cloud write is in flight.
      setRoute({ view: "summary", outcomes, filters });
      if (auth.user) {
        try {
          await saveAccountRound(record, outcomes, filters);
          setHistory(await loadAccountHistory());
          setAccountDataError(null);
        } catch (error) {
          setAccountDataError(
            error instanceof Error ? error.message : "Could not save this round.",
          );
        }
      } else {
        setHistory((current) => [...current, record]);
      }
    },
    [auth.user, settings],
  );

  const nav = useMemo(
    () =>
      [
        ["home", "Play"],
        ["library", "Library"],
        ["personal", "My cases"],
        ["viewer", "Viewer"],
        ["stats", "Stats"],
      ] as const,
    [],
  );
  const activeNav =
    route.view === "editor"
      ? route.back
      : route.view === "study"
        ? route.back
        : route.view === "play" || route.view === "summary"
          ? "home"
          : route.view;

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-10 border-b border-line bg-bg/85 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-6 px-4">
          <button
            type="button"
            onClick={() => {
              window.history.replaceState(null, "", "/");
              setRoute({ view: "landing" });
            }}
            className="flex cursor-pointer items-center gap-2"
            aria-label="Pinpoint home"
          >
            <svg width="20" height="20" viewBox="0 0 32 32" aria-hidden>
              <circle cx="16" cy="16" r="10" fill="none" stroke="var(--accent)" strokeWidth="2.5" />
              <circle cx="16" cy="16" r="3" fill="var(--accent)" />
            </svg>
            <span className="font-semibold tracking-tight">Pinpoint</span>
          </button>
          <nav className="flex items-center gap-1">
            {nav.map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  if (location.pathname !== "/") {
                    window.history.replaceState(null, "", "/");
                  }
                  setRoute({ view: id });
                }}
                className={`cursor-pointer rounded-(--radius-ctl) px-3 py-1.5 text-sm transition-colors ${
                  activeNav === id ? "bg-surface-2 text-ink" : "text-ink-dim hover:text-ink"
                }`}
              >
                {label}
              </button>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-1">
            <AccountMenu auth={auth} />
            <button
              type="button"
              onClick={toggleTheme}
              className="cursor-pointer rounded-(--radius-ctl) p-2 text-ink-dim transition-colors hover:bg-surface-2 hover:text-ink"
              aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            >
              {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {accountDataError && (
          <div className="mx-auto mt-4 w-full max-w-6xl px-4">
            <div className="rounded-(--radius-panel) border border-miss/40 bg-miss/10 px-4 py-3 text-sm text-miss">
              Your private account data could not be synced: {accountDataError}
            </div>
          </div>
        )}
        {route.view === "landing" && (
          <Landing
            onPlay={() => setRoute({ view: "home" })}
            onBrowse={() => setRoute({ view: "library" })}
          />
        )}
        {route.view === "home" && (
          <Home
            cases={cases}
            settings={settings}
            onSettings={updateSettings}
            onStart={(filters) => {
              const round = pickRound(cases, filters);
              if (round.length > 0) setRoute({ view: "play", cases: round, filters });
            }}
          />
        )}
        {route.view === "play" && (
          <Play
            key={route.cases.map((c) => c.id).join()}
            cases={route.cases}
            settings={settings}
            onFinish={(outcomes) => finishRound(outcomes, route.filters)}
            onExit={() => setRoute({ view: "home" })}
          />
        )}
        {route.view === "summary" && (
          <Summary
            outcomes={route.outcomes}
            settings={settings}
            onReplay={() => {
              const round = pickRound(cases, route.filters);
              if (round.length > 0) setRoute({ view: "play", cases: round, filters: route.filters });
            }}
            onHome={() => setRoute({ view: "home" })}
          />
        )}
        {(route.view === "library" || route.view === "personal") && (
          <Cases
            scope={route.view}
            cases={cases}
            onNew={() => setRoute({ view: "editor", existing: null, back: "personal" })}
            onEdit={(c) =>
              setRoute({ view: "editor", existing: c, back: "personal" })
            }
            onDelete={async (c) => {
              if (auth.user && c.cloud) await deleteCloudCase(c);
              if (!auth.user || !c.cloud) await deleteCase(c);
              refreshCases();
            }}
            onStudy={(c) => {
              const back = route.view === "library" ? "library" : "personal";
              const list = cases.filter((x) => (back === "library" ? x.seed : !x.seed));
              setRoute({ view: "study", startAt: Math.max(0, list.indexOf(c)), back });
            }}
            onChanged={refreshCases}
            onImport={
              auth.user
                ? async (json) => {
                    const imported = await parseImportedCases(json);
                    for (const radCase of imported) await syncCaseToCloud(radCase);
                    return imported.length;
                  }
                : undefined
            }
            onImportCases={
              auth.user
                ? async (imported) => {
                    for (const radCase of imported) await syncCaseToCloud(radCase);
                  }
                : undefined
            }
            description={
              route.view === "personal" && auth.user
                ? "Your private uploads, available only to this signed-in account."
                : undefined
            }
          />
        )}
        {route.view === "admin" && (
          <Admin
            initialSection={route.section}
            cases={cases}
            onEdit={(c) => setRoute({ view: "editor", existing: c, back: "admin" })}
            onStudy={(c) => {
              const list = cases.filter((candidate) => candidate.seed);
              setRoute({
                view: "study",
                startAt: Math.max(0, list.indexOf(c)),
                back: "admin",
              });
            }}
            onChanged={() => void refreshCases()}
            onBuildCase={(record) => {
              setRoute({
                view: "editor", back: "admin", acquisition: record,
                existing: acquisitionCaseDraft(record, cases),
              });
            }}
            onPrepareCase={async (record) => {
              const preparedMedia = await prepareAcquisitionMedia(record);
              return saveAcquisition({ ...record, preparedMedia });
            }}
            onPublishCase={async (record) => {
              if (!record.draftCase) throw new Error("Prepare and mark the case before publishing.");
              const published = await publishPreparedLibraryCase(record.draftCase);
              const updated = await saveAcquisition({
                ...record,
                draftCase: published,
                libraryCaseId: published.id,
              });
              setCases((current) => [...current.filter((item) => item.id !== published.id), published]);
              return updated;
            }}
          />
        )}
        {route.view === "editor" && (
          <Editor
            existing={route.existing}
            onSave={async (c) => {
              if (route.back === "admin") {
                if (route.acquisition) {
                  const draftCase = await prepareLibraryCaseMedia(c);
                  await saveAcquisition({ ...route.acquisition, draftCase });
                } else if (c.id.startsWith("library-")) {
                  const published = await publishLibraryCase(c);
                  setCases((current) => [...current.filter((item) => item.id !== published.id), published]);
                } else {
                  const saved = await saveGlobalCaseOverride(c);
                  setCases((current) => applyGlobalCaseOverride(current, saved));
                }
                setRoute({ view: "admin", section: route.acquisition ? "acquisition" : "library" });
              } else {
                if (auth.user) {
                  await syncCaseToCloud(c);
                  // Successful cloud upload makes the old shared-browser copy
                  // unnecessary and prevents it leaking into guest mode.
                  await deleteCase(c).catch(() => undefined);
                } else if (hasLocalCaseMedia(c) || !c.cloud) {
                  await saveCase(c);
                }
                await refreshCases();
                setRoute({ view: "personal" });
              }
            }}
            onCancel={() => setRoute(
              route.back === "admin"
                ? { view: "admin", section: route.acquisition ? "acquisition" : "library" }
                : { view: route.back },
            )}
            adminMode={route.back === "admin"}
            draftMode={Boolean(route.acquisition)}
          />
        )}
        {route.view === "study" && (
          <Study
            cases={cases.filter((x) =>
              route.back === "library" || route.back === "admin" ? x.seed : !x.seed,
            )}
            startAt={route.startAt}
            onExit={() => setRoute({ view: route.back })}
            onEdit={
              route.back === "admin"
                ? (current) => setRoute({ view: "editor", existing: current, back: "admin" })
                : undefined
            }
          />
        )}
        {route.view === "viewer" && (
          <Viewer
            onImportSeries={(draft) =>
              setRoute({ view: "editor", existing: draft, back: "personal" })
            }
          />
        )}
        {route.view === "stats" && (
          <Stats
            history={history}
            onClear={async () => {
              if (auth.user) {
                await clearAccountHistory();
                setHistory([]);
              } else {
                setHistory([]);
              }
            }}
          />
        )}
      </main>

      <footer className="border-t border-line py-4">
        <p className="mx-auto w-full max-w-6xl px-4 text-xs text-ink-faint">
          For education only, not for clinical use. Bundled images are de-identified, openly
          licensed teaching files from Wikimedia Commons.
        </p>
      </footer>
    </div>
  );
}
