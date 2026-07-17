import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowCounterClockwise,
  CloudArrowUp,
  DownloadSimple,
  FilePlus,
  FilmStrip,
  MagnifyingGlass,
  PencilSimple,
  Stack,
  Trash,
  UploadSimple,
} from "../components/icons";
import type { CaseSource, RadCase, Subspecialty } from "../types";
import { DIFFICULTIES, MODALITIES, SUBSPECIALTIES, frameCount, isStack } from "../types";
import { exportCases, importCases, restoreSeeds } from "../lib/storage";
import { withImageRetry } from "../lib/image";
import { Button, Chip, EmptyState, Panel, Select, inputClass } from "../components/ui";
import { CloudPanel } from "../components/CloudPanel";

function CaseThumb({ radCase }: { radCase: RadCase }) {
  const [src, setSrc] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setRetryToken(null);
    setFailed(false);
    // A poster (or the first frame) stands in for the whole case; DICOM
    // series can't be shown as an <img>, so they carry a rendered poster.
    if (radCase.posterUrl) {
      setSrc(radCase.posterUrl);
      return;
    }
    if (radCase.posterBlob) {
      const url = URL.createObjectURL(radCase.posterBlob);
      setSrc(url);
      return () => URL.revokeObjectURL(url);
    }
    if (radCase.imageBlobs?.length) {
      const url = URL.createObjectURL(radCase.imageBlobs[0]);
      setSrc(url);
      return () => URL.revokeObjectURL(url);
    }
    if (radCase.imageBlob) {
      const url = URL.createObjectURL(radCase.imageBlob);
      setSrc(url);
      return () => URL.revokeObjectURL(url);
    }
    setSrc(radCase.imageUrls?.[0] ?? radCase.imageUrl ?? null);
  }, [radCase]);
  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-t-(--radius-panel) bg-black">
      {src && (
        <img
          src={withImageRetry(src, retryToken)}
          alt=""
          loading="lazy"
          decoding="async"
          onLoad={() => setFailed(false)}
          onError={() => {
            if (!retryToken) setRetryToken(`${Date.now()}`);
            else setFailed(true);
          }}
          className="h-full w-full object-cover opacity-90"
        />
      )}
      {failed && (
        <button
          type="button"
          onClick={() => {
            setFailed(false);
            setRetryToken(`${Date.now()}`);
          }}
          className="absolute inset-0 cursor-pointer text-xs text-white/60"
        >
          Retry image
        </button>
      )}
      {isStack(radCase) && (
        <span className="absolute right-2 top-2 flex items-center gap-1 rounded-(--radius-ctl) bg-black/60 px-1.5 py-0.5 font-mono text-[11px] text-white/90">
          <Stack size={12} />
          {frameCount(radCase)}
        </span>
      )}
    </div>
  );
}

const DIFF_COLOR: Record<string, string> = {
  easy: "var(--hit)",
  medium: "var(--near)",
  hard: "var(--miss)",
};

export function Cases({
  scope,
  cases,
  onNew,
  onEdit,
  onDelete,
  onStudy,
  onChanged,
  canEditLibrary = false,
  heading,
  description,
  headerActions,
}: {
  scope: Extract<CaseSource, "library" | "personal">;
  cases: RadCase[];
  onNew: () => void;
  onEdit: (c: RadCase) => void;
  onDelete: (c: RadCase) => void;
  onStudy: (c: RadCase) => void;
  onChanged: () => void;
  canEditLibrary?: boolean;
  heading?: string;
  description?: string;
  headerActions?: ReactNode;
}) {
  const isLibrary = scope === "library";
  const [confirming, setConfirming] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pickedSubs, setPickedSubs] = useState<Subspecialty[]>([]);
  const [modality, setModality] = useState<string>("all");
  const [difficulty, setDifficulty] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [showCloud, setShowCloud] = useState(false);
  const importInput = useRef<HTMLInputElement>(null);

  // Curated (bundled) cases live in the Library; the user's own uploads
  // live in Personal.
  const scoped = useMemo(
    () => cases.filter((c) => (isLibrary ? c.seed : !c.seed)),
    [cases, isLibrary],
  );

  const subspecialties = useMemo(
    () => SUBSPECIALTIES.filter((s) => scoped.some((c) => c.subspecialty === s)),
    [scoped],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return scoped.filter(
      (c) =>
        (pickedSubs.length === 0 || pickedSubs.includes(c.subspecialty)) &&
        (modality === "all" || c.modality === modality) &&
        (difficulty === "all" || c.difficulty === difficulty) &&
        (q === "" || c.title.toLowerCase().includes(q)),
    );
  }, [scoped, pickedSubs, modality, difficulty, query]);

  const filtersActive =
    pickedSubs.length > 0 || modality !== "all" || difficulty !== "all" || query.trim() !== "";

  const doExport = async () => {
    const json = await exportCases(scoped);
    const blob = new Blob([json], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = isLibrary ? "pinpoint-library.json" : "pinpoint-my-cases.json";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const doImport = async (file: File | undefined) => {
    if (!file) return;
    try {
      const n = await importCases(await file.text());
      setNotice(`Imported ${n} ${n === 1 ? "case" : "cases"}.`);
      onChanged();
    } catch {
      setNotice("That file is not a Pinpoint case export.");
    }
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8">
      <div className="mb-1 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">
          {heading ?? (isLibrary ? "Case library" : "My cases")}
        </h1>
        <span className="font-mono text-sm text-ink-faint">
          {filtersActive ? `${visible.length} of ${scoped.length}` : scoped.length}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {notice && <span className="mr-2 text-sm text-ink-dim">{notice}</span>}
          {headerActions}
          {!isLibrary && (
            <Button onClick={() => importInput.current?.click()}>
              <UploadSimple size={15} />
              Import file
            </Button>
          )}
          {!isLibrary && (
            <Button
              variant={showCloud ? "primary" : "ghost"}
              onClick={() => setShowCloud((v) => !v)}
            >
              <CloudArrowUp size={15} />
              Cloud
            </Button>
          )}
          <Button onClick={doExport} disabled={scoped.length === 0}>
            <DownloadSimple size={15} />
            Export
          </Button>
          {isLibrary && !canEditLibrary ? (
            <Button
              onClick={async () => {
                await restoreSeeds();
                setNotice("Bundled cases restored.");
                onChanged();
              }}
            >
              <ArrowCounterClockwise size={15} />
              Restore bundled
            </Button>
          ) : !isLibrary ? (
            <Button variant="primary" onClick={onNew}>
              <FilePlus size={15} />
              New case
            </Button>
          ) : null}
        </div>
      </div>
      <p className="mb-6 text-sm text-ink-dim">
        {description ?? (isLibrary
          ? "Curated, openly licensed teaching cases. Play or study them; they stay put."
          : "Your own uploads for personalised study. They stay on this device, and signed-in cases sync privately to your account.")}
      </p>
      <input
        ref={importInput}
        type="file"
        accept="application/json"
        className="hidden"
        onChange={(e) => {
          doImport(e.target.files?.[0]);
          e.target.value = "";
        }}
      />

      {!isLibrary && showCloud && (
        <CloudPanel cases={scoped} onImported={onChanged} onClose={() => setShowCloud(false)} />
      )}

      {scoped.length > 0 && (
        <div className="mb-6 rounded-(--radius-panel) border border-line bg-surface p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-ink-faint">
              Subspecialty
            </p>
            {filtersActive && (
              <button
                type="button"
                onClick={() => {
                  setPickedSubs([]);
                  setModality("all");
                  setDifficulty("all");
                  setQuery("");
                }}
                className="cursor-pointer text-xs text-ink-faint transition-colors hover:text-ink"
              >
                Clear filters
              </button>
            )}
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {subspecialties.map((s) => (
              <Chip
                key={s}
                active={pickedSubs.includes(s)}
                onClick={() =>
                  setPickedSubs((cur) =>
                    cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s],
                  )
                }
              >
                {s}
              </Chip>
            ))}
          </div>

          <div className="mt-4 grid gap-2 border-t border-line pt-4 sm:grid-cols-2 xl:grid-cols-[minmax(10rem,0.8fr)_minmax(10rem,0.8fr)_minmax(16rem,1.4fr)]">
            <Select value={modality} onChange={(e) => setModality(e.target.value)} aria-label="Filter by modality">
              <option value="all">All modalities</option>
              {MODALITIES.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </Select>
            <Select value={difficulty} onChange={(e) => setDifficulty(e.target.value)} aria-label="Filter by difficulty">
              <option value="all">All difficulties</option>
              {DIFFICULTIES.map((d) => (
                <option key={d}>{d}</option>
              ))}
            </Select>
            <div className="relative sm:col-span-2 xl:col-span-1">
              <MagnifyingGlass size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search findings"
                aria-label="Search cases by finding"
                className={inputClass + " w-full !pl-8"}
              />
            </div>
          </div>
        </div>
      )}

      {scoped.length === 0 ? (
        isLibrary ? (
          <EmptyState
            icon={<FilmStrip size={40} />}
            title="The library is empty"
            body="Restore the bundled teaching set to bring the curated cases back."
            action={
              <Button
                variant="primary"
                onClick={async () => {
                  await restoreSeeds();
                  onChanged();
                }}
              >
                <ArrowCounterClockwise size={15} />
                Restore bundled
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={<FilmStrip size={40} />}
            title="No personal cases yet"
            body="Upload de-identified DICOM, PNG, JPG, or WebP files to build a personalised study set. Select several files for a scrollable CT/MRI stack."
            action={
              <Button variant="primary" onClick={onNew}>
                <FilePlus size={15} />
                New case
              </Button>
            }
          />
        )
      ) : visible.length === 0 ? (
        <EmptyState
          icon={<FilmStrip size={40} />}
          title="Nothing matches these filters"
          body="Loosen the subspecialty, modality, or difficulty filters, or clear the search."
          action={
            filtersActive ? (
              <Button
                onClick={() => {
                  setPickedSubs([]);
                  setModality("all");
                  setDifficulty("all");
                  setQuery("");
                }}
              >
                Clear filters
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((c) => (
            <Panel key={c.id} className="group flex flex-col overflow-hidden">
              <button
                type="button"
                onClick={() => onStudy(c)}
                className="cursor-pointer text-left"
                aria-label={`Study ${c.title}`}
              >
                <CaseThumb radCase={c} />
              </button>
              <div className="flex flex-1 flex-col gap-1.5 p-4">
                <div className="flex items-center gap-2">
                  <h2 className="min-w-0 truncate font-medium">{c.title}</h2>
                  <span
                    className="ml-auto shrink-0 text-xs font-medium capitalize"
                    style={{ color: DIFF_COLOR[c.difficulty] }}
                  >
                    {c.difficulty}
                  </span>
                </div>
                <p className="text-xs text-ink-faint">
                  {c.modality} · {c.subspecialty} · {c.regions.length}{" "}
                  {c.regions.length === 1 ? "region" : "regions"}
                  {c.seed && " · bundled"}
                  {c.cloud && " · synced"}
                </p>
                <div className="mt-2 flex items-center gap-1 border-t border-line pt-2.5">
                  <Button className="!px-2.5 !py-1 !text-xs" onClick={() => onStudy(c)}>
                    Study
                  </Button>
                  {(!isLibrary || canEditLibrary) && (
                    <Button className="!px-2.5 !py-1 !text-xs" onClick={() => onEdit(c)}>
                      <PencilSimple size={13} />
                      Edit
                    </Button>
                  )}
                  {!isLibrary &&
                    (confirming === c.id ? (
                      <span className="ml-auto flex items-center gap-1">
                        <Button variant="danger" className="!px-2.5 !py-1 !text-xs" onClick={() => onDelete(c)}>
                          Confirm delete
                        </Button>
                        <Button className="!px-2.5 !py-1 !text-xs" onClick={() => setConfirming(null)}>
                          Keep
                        </Button>
                      </span>
                    ) : (
                      <Button
                        variant="danger"
                        className="ml-auto !border-transparent !px-2.5 !py-1 !text-xs opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                        onClick={() => setConfirming(c.id)}
                      >
                        <Trash size={13} />
                      </Button>
                    ))}
                </div>
              </div>
            </Panel>
          ))}
        </div>
      )}
    </div>
  );
}
