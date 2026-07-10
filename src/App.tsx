import { useCallback, useEffect, useMemo, useState } from "react";
import { Moon, Sun } from "./components/icons";
import type { CaseOutcome, RadCase, RoundFilters, RoundRecord, ScoringSettings } from "./types";
import {
  appendHistory,
  deleteCase,
  getAllCases,
  loadHistory,
  loadSettings,
  saveCase,
  saveSettings,
} from "./lib/storage";
import { Landing } from "./views/Landing";
import { Home } from "./views/Home";
import { Play } from "./views/Play";
import { Summary } from "./views/Summary";
import { Cases } from "./views/Cases";
import { Editor } from "./views/Editor";
import { Study } from "./views/Study";
import { Stats } from "./views/Stats";

type Route =
  | { view: "landing" }
  | { view: "home" }
  | { view: "play"; cases: RadCase[]; filters: RoundFilters }
  | { view: "summary"; outcomes: CaseOutcome[]; filters: RoundFilters }
  | { view: "library" }
  | { view: "personal" }
  | { view: "editor"; existing: RadCase | null }
  | { view: "study"; startAt: number; back: "library" | "personal" }
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

export default function App() {
  const [route, setRoute] = useState<Route>({ view: "landing" });
  const [cases, setCases] = useState<RadCase[]>([]);
  const [settings, setSettings] = useState<ScoringSettings>(loadSettings);
  const [history, setHistory] = useState<RoundRecord[]>(loadHistory);
  const [theme, toggleTheme] = useTheme();

  const refreshCases = useCallback(() => {
    getAllCases().then(setCases);
  }, []);

  useEffect(refreshCases, [refreshCases]);

  const updateSettings = useCallback((s: ScoringSettings) => {
    setSettings(s);
    saveSettings(s);
  }, []);

  const finishRound = useCallback(
    (outcomes: CaseOutcome[], filters: RoundFilters) => {
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
      appendHistory(record);
      setHistory(loadHistory());
      setRoute({ view: "summary", outcomes, filters });
    },
    [settings],
  );

  const nav = useMemo(
    () =>
      [
        ["home", "Play"],
        ["library", "Library"],
        ["personal", "My cases"],
        ["stats", "Stats"],
      ] as const,
    [],
  );
  const activeNav =
    route.view === "editor"
      ? "personal"
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
            onClick={() => setRoute({ view: "landing" })}
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
                onClick={() => setRoute({ view: id })}
                className={`cursor-pointer rounded-(--radius-ctl) px-3 py-1.5 text-sm transition-colors ${
                  activeNav === id ? "bg-surface-2 text-ink" : "text-ink-dim hover:text-ink"
                }`}
              >
                {label}
              </button>
            ))}
          </nav>
          <button
            type="button"
            onClick={toggleTheme}
            className="ml-auto cursor-pointer rounded-(--radius-ctl) p-2 text-ink-dim transition-colors hover:bg-surface-2 hover:text-ink"
            aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          >
            {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </div>
      </header>

      <main className="flex-1">
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
            onNew={() => setRoute({ view: "editor", existing: null })}
            onEdit={(c) => setRoute({ view: "editor", existing: c })}
            onDelete={async (c) => {
              await deleteCase(c);
              refreshCases();
            }}
            onStudy={(c) => {
              const back = route.view === "library" ? "library" : "personal";
              const list = cases.filter((x) => (back === "library" ? x.seed : !x.seed));
              setRoute({ view: "study", startAt: Math.max(0, list.indexOf(c)), back });
            }}
            onChanged={refreshCases}
          />
        )}
        {route.view === "editor" && (
          <Editor
            existing={route.existing}
            onSave={async (c) => {
              await saveCase(c);
              refreshCases();
              setRoute({ view: "personal" });
            }}
            onCancel={() => setRoute({ view: "personal" })}
          />
        )}
        {route.view === "study" && (
          <Study
            cases={cases.filter((x) => (route.back === "library" ? x.seed : !x.seed))}
            startAt={route.startAt}
            onExit={() => setRoute({ view: route.back })}
          />
        )}
        {route.view === "stats" && (
          <Stats history={history} onChanged={() => setHistory(loadHistory())} />
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
