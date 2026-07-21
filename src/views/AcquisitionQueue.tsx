import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  CircleNotch,
  DownloadSimple,
  FilePlus,
  FloppyDisk,
  LinkSimple,
  SignOut,
  Trash,
  UploadSimple,
  Warning,
} from "../components/icons";
import { Button, Field, Panel, Select, inputClass } from "../components/ui";
import {
  ACQUISITION_LICENCES,
  ACQUISITION_STATUSES,
  EMPTY_ACQUISITION_CHECKS,
  completedCheckCount,
  authoringReady,
  deleteAcquisition,
  loadAcquisitions,
  loadAcquisitionHistory,
  publicationReady,
  saveAcquisition,
  saveAcquisitionBatch,
  type AcquisitionDraft,
  type AcquisitionRecord,
  type AcquisitionStatus,
} from "../lib/acquisition";
import { DIFFICULTIES, MODALITIES, SUBSPECIALTIES } from "../types";
import { acquisitionTemplateCsv, parseAcquisitionImport } from "../lib/acquisitionImport";
import { HIGH_YIELD_TARGETS } from "../data/curriculumTargets";

const STATUS_LABEL: Record<AcquisitionStatus, string> = {
  candidate: "Candidate",
  "licence-cleared": "Licence cleared",
  "image-qc": "Image QC",
  "clinical-review": "Clinical review",
  pilot: "Pilot",
  approved: "Approved",
  rejected: "Rejected",
};

const CHECK_LABELS = {
  licenceConfirmed: "Exact licence confirmed",
  redistributionAllowed: "Redistribution is permitted",
  attributionComplete: "Attribution is complete",
  deidentified: "Image and metadata are de-identified",
  originalQuality: "Original-quality file obtained",
  noTeachingAnnotations: "No arrows, circles or teaching labels",
  clinicalFindingConfirmed: "Finding confirmed by clinical reviewer",
  regionReviewed: "Pinpoint marking reviewed",
} as const;

const emptyDraft = (): AcquisitionDraft => ({
  finding: "",
  status: "candidate",
  repository: "",
  sourceUrl: "",
  licence: "unverified",
  modality: "X-ray",
  subspecialty: "Chest",
  targetDifficulty: "medium",
  checks: { ...EMPTY_ACQUISITION_CHECKS },
});

function downloadText(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a"); link.href = url; link.download = name; link.click();
  URL.revokeObjectURL(url);
}

function sourcingPlanCsv() {
  const header = acquisitionTemplateCsv().trimEnd();
  const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
  const rows = HIGH_YIELD_TARGETS.map((target) => [
    target.finding, "", "", "", "", "unverified", "", "", target.modality,
    target.subspecialty, target.difficulty, "Pinpoint high-yield curriculum", "", "", "",
  ].map((value) => quote(value)).join(","));
  return `${header}\n${rows.join("\n")}\n`;
}

function CandidateEditor({
  initial,
  onSaved,
  onCancel,
  onBuildCase,
  onPrepareCase,
  onPublishCase,
}: {
  initial: AcquisitionRecord | null;
  onSaved: (record: AcquisitionRecord) => void;
  onCancel: () => void;
  onBuildCase: (record: AcquisitionRecord) => void;
  onPrepareCase: (record: AcquisitionRecord) => Promise<AcquisitionRecord>;
  onPublishCase: (record: AcquisitionRecord) => Promise<AcquisitionRecord>;
}) {
  const [draft, setDraft] = useState<AcquisitionDraft | AcquisitionRecord>(() =>
    initial ? { ...initial, checks: { ...initial.checks } } : emptyDraft(),
  );
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [history, setHistory] = useState<AcquisitionRecord[]>([]);
  const checked = Object.values(draft.checks).filter(Boolean).length;
  const ready = checked === Object.keys(draft.checks).length;

  useEffect(() => {
    if (!initial) return;
    void loadAcquisitionHistory(initial.id).then(setHistory).catch(() => setHistory([]));
  }, [initial]);

  const update = <K extends keyof AcquisitionDraft>(key: K, value: AcquisitionDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const submit = async () => {
    if (draft.status === "approved" && !ready) {
      setError("Complete every publication gate before approving this candidate.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      onSaved(await saveAcquisition(draft));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save this candidate.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Panel className="h-fit p-5 lg:sticky lg:top-20">
      <div className="mb-5 flex items-center gap-3">
        <div>
          <h2 className="font-semibold">{initial ? "Review candidate" : "Add candidate"}</h2>
          <p className="mt-0.5 text-xs text-ink-faint">Metadata only—do not enter patient information.</p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="ml-auto cursor-pointer text-sm text-ink-dim hover:text-ink"
        >
          Close
        </button>
      </div>

      <div className="flex flex-col gap-4">
        <Field label="Finding / learning objective">
          <input
            value={draft.finding}
            onChange={(event) => update("finding", event.target.value)}
            placeholder="e.g. Small apical pneumothorax"
            className={inputClass}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Status">
            <Select
              value={draft.status}
              onChange={(event) => update("status", event.target.value as AcquisitionStatus)}
            >
              {ACQUISITION_STATUSES.map((status) => (
                <option key={status} value={status} disabled={status === "approved" && !ready}>
                  {STATUS_LABEL[status]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Target difficulty">
            <Select
              value={draft.targetDifficulty}
              onChange={(event) =>
                update("targetDifficulty", event.target.value as AcquisitionDraft["targetDifficulty"])
              }
            >
              {DIFFICULTIES.map((difficulty) => (
                <option key={difficulty}>{difficulty}</option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Modality">
            <Select
              value={draft.modality}
              onChange={(event) =>
                update("modality", event.target.value as AcquisitionDraft["modality"])
              }
            >
              {MODALITIES.map((modality) => (
                <option key={modality}>{modality}</option>
              ))}
            </Select>
          </Field>
          <Field label="Subspecialty">
            <Select
              value={draft.subspecialty}
              onChange={(event) =>
                update("subspecialty", event.target.value as AcquisitionDraft["subspecialty"])
              }
            >
              {SUBSPECIALTIES.map((subspecialty) => (
                <option key={subspecialty}>{subspecialty}</option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="border-t border-line pt-4">
          <p className="mb-3 text-xs font-medium uppercase tracking-[0.14em] text-ink-faint">Provenance</p>
          <div className="flex flex-col gap-4">
            <Field label="Repository">
              <input
                value={draft.repository}
                onChange={(event) => update("repository", event.target.value)}
                placeholder="TCIA, IDC, Wikimedia Commons…"
                className={inputClass}
              />
            </Field>
            <Field label="Source page URL">
              <input
                type="url"
                value={draft.sourceUrl}
                onChange={(event) => update("sourceUrl", event.target.value)}
                placeholder="https://…"
                className={inputClass}
              />
            </Field>
            <Field label="Direct original-file URL (optional)">
              <input
                type="url"
                value={draft.assetUrl ?? ""}
                onChange={(event) => update("assetUrl", event.target.value || undefined)}
                placeholder="https://…"
                className={inputClass}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Collection">
                <input
                  value={draft.collection ?? ""}
                  onChange={(event) => update("collection", event.target.value || undefined)}
                  className={inputClass}
                />
              </Field>
              <Field label="Collection DOI">
                <input
                  value={draft.collectionDoi ?? ""}
                  onChange={(event) => update("collectionDoi", event.target.value || undefined)}
                  className={inputClass}
                />
              </Field>
            </div>
            <Field label="Author / institution">
              <input
                value={draft.author ?? ""}
                onChange={(event) => update("author", event.target.value || undefined)}
                className={inputClass}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Licence">
                <Select
                  value={draft.licence}
                  onChange={(event) =>
                    update("licence", event.target.value as AcquisitionDraft["licence"])
                  }
                >
                  {ACQUISITION_LICENCES.map((licence) => (
                    <option key={licence}>{licence}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Licence URL">
                <input
                  type="url"
                  value={draft.licenceUrl ?? ""}
                  onChange={(event) => update("licenceUrl", event.target.value || undefined)}
                  className={inputClass}
                />
              </Field>
            </div>
            <Field label="Required attribution">
              <textarea
                value={draft.attribution ?? ""}
                onChange={(event) => update("attribution", event.target.value || undefined)}
                rows={2}
                className={inputClass + " resize-y"}
              />
            </Field>
          </div>
        </div>

        <div className="border-t border-line pt-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-ink-faint">Publication gates</p>
            <span className={`font-mono text-xs ${ready ? "text-hit" : "text-ink-faint"}`}>
              {checked}/8
            </span>
          </div>
          <div className="flex flex-col gap-2">
            {(Object.keys(CHECK_LABELS) as (keyof typeof CHECK_LABELS)[]).map((key) => (
              <label
                key={key}
                className="flex cursor-pointer items-start gap-2 rounded-(--radius-ctl) border border-line px-3 py-2 text-sm text-ink-dim hover:border-line-strong"
              >
                <input
                  type="checkbox"
                  checked={draft.checks[key]}
                  onChange={(event) =>
                    update("checks", { ...draft.checks, [key]: event.target.checked })
                  }
                  className="mt-0.5 accent-(--accent)"
                />
                {CHECK_LABELS[key]}
              </label>
            ))}
          </div>
        </div>

        <Field label="Reviewer">
          <input
            value={draft.reviewer ?? ""}
            onChange={(event) => update("reviewer", event.target.value || undefined)}
            placeholder="Name or initials"
            className={inputClass}
          />
        </Field>
        <Field label="Internal notes">
          <textarea
            value={draft.notes ?? ""}
            onChange={(event) => update("notes", event.target.value || undefined)}
            rows={4}
            placeholder="Why this is high yield, concerns, next review step…"
            className={inputClass + " resize-y"}
          />
        </Field>

        {draft.preparedMedia && (
          <div className="rounded-(--radius-ctl) border border-line bg-surface-2 px-3 py-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium">Image prepared in Pinpoint</p>
              <span className={`font-mono text-xs ${draft.preparedMedia.mediaQa.status === "warning" ? "text-[#d6a03d]" : "text-hit"}`}>
                {draft.preparedMedia.mediaQa.status.toUpperCase()}
              </span>
            </div>
            <p className="mt-1 text-xs text-ink-dim">
              {(draft.preparedMedia.mediaQa.totalBytes / 1024 / 1024).toFixed(1)} MB
              {draft.preparedMedia.mediaQa.minWidth && draft.preparedMedia.mediaQa.minHeight
                ? ` · ${draft.preparedMedia.mediaQa.minWidth}×${draft.preparedMedia.mediaQa.minHeight}px`
                : ""}
            </p>
            {draft.preparedMedia.mediaQa.warnings.map((message) => (
              <p key={message} className="mt-1 text-xs text-[#d6a03d]">{message}</p>
            ))}
          </div>
        )}

        {initial && (
          <div className="border-t border-line pt-4">
            <p className="mb-3 text-xs font-medium uppercase tracking-[0.14em] text-ink-faint">Audit history</p>
            <div className="flex max-h-40 flex-col gap-2 overflow-y-auto">
              {history.length === 0 ? <p className="text-xs text-ink-faint">No earlier versions.</p> : history.map((version, index) => (
                <div key={`${version.updatedAt}-${index}`} className="rounded-(--radius-ctl) border border-line px-3 py-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-ink-dim">{STATUS_LABEL[version.status]}</span>
                    <span className="font-mono text-ink-faint">{new Date(version.updatedAt).toLocaleString()}</span>
                  </div>
                  <p className="mt-1 text-ink-faint">
                    {completedCheckCount(version)}/8 gates · {version.draftCase ? "case draft saved" : version.preparedMedia ? "image prepared" : "no case draft"}{version.libraryCaseId ? " · published" : ""}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {draft.status === "approved" && ready && (
          <p className="flex items-center gap-2 rounded-(--radius-ctl) bg-hit/10 px-3 py-2 text-sm text-hit">
            <Check size={16} /> Ready for case authoring.
          </p>
        )}
        {error && <p className="text-sm text-miss">{error}</p>}
        <div className="flex items-center gap-2 border-t border-line pt-4">
          <Button variant="primary" onClick={() => void submit()} disabled={saving}>
            {saving ? <CircleNotch size={15} className="animate-spin" /> : <FloppyDisk size={15} />}
            {saving ? "Saving…" : "Save candidate"}
          </Button>
          {initial && !initial.draftCase && !initial.preparedMedia && initial.assetUrl && initial.status !== "rejected" && (
            <Button
              disabled={preparing}
              onClick={async () => {
                setPreparing(true);
                setError(null);
                try {
                  const prepared = await onPrepareCase(initial);
                  onSaved(prepared);
                  onBuildCase(prepared);
                } catch (cause) {
                  setError(cause instanceof Error ? cause.message : "Could not prepare this image.");
                } finally {
                  setPreparing(false);
                }
              }}
            >
              {preparing ? <CircleNotch size={15} className="animate-spin" /> : <DownloadSimple size={15} />}
              {preparing ? "Preparing…" : "Prepare in Pinpoint"}
            </Button>
          )}
          {initial && (initial.draftCase || initial.preparedMedia || (authoringReady(initial) && !initial.assetUrl)) && (
            <Button onClick={() => onBuildCase(initial)}>
              <FilePlus size={15} /> {initial.draftCase ? "Edit case draft" : initial.preparedMedia ? "Mark and finalise" : "Prepare case draft"}
            </Button>
          )}
          {initial && initial.status === "approved" && publicationReady(initial) && initial.draftCase && (
            <Button
              variant="primary"
              disabled={publishing}
              onClick={async () => {
                setPublishing(true);
                setError(null);
                try { onSaved(await onPublishCase(initial)); }
                catch (cause) { setError(cause instanceof Error ? cause.message : "Could not publish this case."); }
                finally { setPublishing(false); }
              }}
            >
              {publishing ? <CircleNotch size={15} className="animate-spin" /> : <FloppyDisk size={15} />}
              {initial.libraryCaseId ? "Republish library case" : "Publish to library"}
            </Button>
          )}
          {initial &&
            (confirmDelete ? (
              <>
                <Button
                  variant="danger"
                  disabled={deleting}
                  onClick={async () => {
                    setDeleting(true);
                    try {
                      await deleteAcquisition(initial.id);
                      onCancel();
                    } catch (cause) {
                      setError(cause instanceof Error ? cause.message : "Could not delete candidate.");
                      setDeleting(false);
                    }
                  }}
                >
                  Delete permanently
                </Button>
                <Button onClick={() => setConfirmDelete(false)}>Keep</Button>
              </>
            ) : (
              <Button className="ml-auto" onClick={() => setConfirmDelete(true)}>
                <Trash size={15} /> Delete
              </Button>
            ))}
        </div>
      </div>
    </Panel>
  );
}

export function AcquisitionQueue({
  onLibrary,
  onSignOut,
  onBuildCase,
  onPrepareCase,
  onPublishCase,
}: {
  onLibrary: () => void;
  onSignOut: () => void | Promise<void>;
  onBuildCase: (record: AcquisitionRecord) => void;
  onPrepareCase: (record: AcquisitionRecord) => Promise<AcquisitionRecord>;
  onPublishCase: (record: AcquisitionRecord) => Promise<AcquisitionRecord>;
}) {
  const [records, setRecords] = useState<AcquisitionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<AcquisitionStatus | "all">("all");
  const [editing, setEditing] = useState<AcquisitionRecord | "new" | null>(null);
  const [batchPreview, setBatchPreview] = useState<AcquisitionDraft[]>([]);
  const [batchError, setBatchError] = useState<string | null>(null);
  const [batchBusy, setBatchBusy] = useState(false);
  const importInput = useRef<HTMLInputElement>(null);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      setRecords(await loadAcquisitions());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load candidates.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const visible = useMemo(
    () => records.filter((record) => filter === "all" || record.status === filter),
    [filter, records],
  );
  const readyCount = records.filter(publicationReady).length;
  const coveredTargets = HIGH_YIELD_TARGETS.filter((target) =>
    records.some((record) => record.status !== "rejected" && record.finding.toLowerCase() === target.finding.toLowerCase()),
  ).length;

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Image acquisition</h1>
          <p className="mt-1 text-sm text-ink-dim">
            Licence, image-quality and clinical gates for prospective teaching cases.
          </p>
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button onClick={onLibrary}>
            <ArrowLeft size={15} /> Library editor
          </Button>
          <Button variant="primary" onClick={() => setEditing("new")}>
            <FilePlus size={15} /> Add candidate
          </Button>
          <Button onClick={() => importInput.current?.click()}>
            <UploadSimple size={15} /> Batch import
          </Button>
          <Button onClick={() => downloadText("pinpoint-acquisition-template.csv", acquisitionTemplateCsv())}>
            <DownloadSimple size={15} /> CSV template
          </Button>
          <input
            ref={importInput}
            type="file"
            accept=".csv,.json,text/csv,application/json"
            className="hidden"
            onChange={async (event) => {
              const file = event.currentTarget.files?.[0]; event.currentTarget.value = "";
              if (!file) return;
              setBatchError(null);
              try { setBatchPreview(parseAcquisitionImport(await file.text(), file.name)); }
              catch (cause) { setBatchPreview([]); setBatchError(cause instanceof Error ? cause.message : "Could not read this import."); }
            }}
          />
          <Button onClick={() => void onSignOut()}>
            <SignOut size={15} /> Sign out
          </Button>
        </div>
      </div>

      {(batchPreview.length > 0 || batchError) && (
        <Panel className="mb-5 p-5">
          <div className="flex flex-wrap items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="font-medium">Batch import preview</p>
              {batchError ? <p className="mt-1 text-sm text-miss">{batchError}</p> : (
                <>
                  <p className="mt-1 text-sm text-ink-dim">{batchPreview.length} validated candidates are ready to enter the acquisition queue.</p>
                  <p className="mt-2 truncate text-xs text-ink-faint">{batchPreview.slice(0, 5).map((item) => item.finding).join(" · ")}{batchPreview.length > 5 ? " …" : ""}</p>
                </>
              )}
            </div>
            {batchPreview.length > 0 && (
              <Button
                variant="primary"
                disabled={batchBusy}
                onClick={async () => {
                  setBatchBusy(true); setBatchError(null);
                  try {
                    const imported = await saveAcquisitionBatch(batchPreview);
                    setRecords((current) => [...imported, ...current]); setBatchPreview([]);
                  } catch (cause) { setBatchError(cause instanceof Error ? cause.message : "Could not import candidates."); }
                  finally { setBatchBusy(false); }
                }}
              >
                {batchBusy ? <CircleNotch size={15} className="animate-spin" /> : <UploadSimple size={15} />}
                Import candidates
              </Button>
            )}
            <Button onClick={() => { setBatchPreview([]); setBatchError(null); }}>Cancel</Button>
          </div>
        </Panel>
      )}

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Panel className="p-4">
          <p className="font-mono text-xl">{records.length}</p>
          <p className="text-xs text-ink-faint">Total candidates</p>
        </Panel>
        <Panel className="p-4">
          <p className="font-mono text-xl text-hit">{readyCount}</p>
          <p className="text-xs text-ink-faint">All gates complete</p>
        </Panel>
        <Panel className="p-4">
          <p className="font-mono text-xl">
            {records.filter((record) => record.status === "clinical-review").length}
          </p>
          <p className="text-xs text-ink-faint">Clinical review</p>
        </Panel>
        <Panel className="p-4">
          <p className="font-mono text-xl text-miss">
            {records.filter((record) => record.status === "rejected").length}
          </p>
          <p className="text-xs text-ink-faint">Rejected</p>
        </Panel>
      </div>

      <Panel className="mb-5 p-5">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <p className="font-medium">High-yield curriculum coverage</p>
            <p className="mt-1 text-sm text-ink-dim">{coveredTargets}/{HIGH_YIELD_TARGETS.length} target findings have active acquisition records.</p>
          </div>
          <Button className="ml-auto" onClick={() => downloadText("pinpoint-high-yield-sourcing-plan.csv", sourcingPlanCsv())}>
            <DownloadSimple size={15} /> Download sourcing plan
          </Button>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
          {SUBSPECIALTIES.map((subspecialty) => {
            const targets = HIGH_YIELD_TARGETS.filter((target) => target.subspecialty === subspecialty);
            const covered = targets.filter((target) => records.some((record) => record.status !== "rejected" && record.finding.toLowerCase() === target.finding.toLowerCase())).length;
            return <div key={subspecialty} className="rounded-(--radius-ctl) border border-line px-3 py-2"><p className="text-xs text-ink-dim">{subspecialty}</p><p className="mt-1 font-mono text-sm">{covered}/{targets.length}</p></div>;
          })}
        </div>
      </Panel>

      <div className="mb-5 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setFilter("all")}
          className={`cursor-pointer rounded-(--radius-ctl) border px-3 py-1.5 text-sm ${
            filter === "all" ? "border-accent bg-accent-soft text-ink" : "border-line text-ink-dim"
          }`}
        >
          All
        </button>
        {ACQUISITION_STATUSES.map((status) => (
          <button
            key={status}
            type="button"
            onClick={() => setFilter(status)}
            className={`cursor-pointer rounded-(--radius-ctl) border px-3 py-1.5 text-sm ${
              filter === status
                ? "border-accent bg-accent-soft text-ink"
                : "border-line text-ink-dim"
            }`}
          >
            {STATUS_LABEL[status]}
          </button>
        ))}
      </div>

      <div className={`grid gap-5 ${editing ? "lg:grid-cols-[minmax(0,1fr)_430px]" : ""}`}>
        <div className="flex min-w-0 flex-col gap-3">
          {loading ? (
            <Panel className="flex min-h-48 items-center justify-center text-ink-faint">
              <CircleNotch size={22} className="animate-spin" />
            </Panel>
          ) : error ? (
            <Panel className="p-5 text-sm text-miss">{error}</Panel>
          ) : visible.length === 0 ? (
            <Panel className="flex min-h-48 flex-col items-center justify-center gap-2 p-6 text-center">
              <Warning size={24} className="text-ink-faint" />
              <p className="font-medium">No candidates in this stage</p>
              <p className="max-w-md text-sm text-ink-dim">
                Add a source record before downloading or preparing an image. This keeps licence and
                provenance checks ahead of publication.
              </p>
            </Panel>
          ) : (
            visible.map((record) => {
              const complete = completedCheckCount(record);
              return (
                <button
                  key={record.id}
                  type="button"
                  onClick={() => setEditing(record)}
                  className="cursor-pointer rounded-(--radius-panel) border border-line bg-surface p-4 text-left transition-colors hover:border-line-strong"
                >
                  <div className="flex flex-wrap items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="font-medium text-ink">{record.finding}</h2>
                        <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs text-ink-dim">
                          {STATUS_LABEL[record.status]}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-ink-dim">
                        {record.modality} · {record.subspecialty} · {record.targetDifficulty} · {record.repository}
                      </p>
                      <p className="mt-2 truncate text-xs text-ink-faint">{record.sourceUrl}</p>
                    </div>
                    <div className="text-right">
                      <p className={`font-mono text-sm ${complete === 8 ? "text-hit" : "text-ink-dim"}`}>
                        {complete}/8
                      </p>
                      <p className="text-xs text-ink-faint">gates</p>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center gap-2 border-t border-line pt-3 text-xs text-ink-faint">
                    <LinkSimple size={13} /> {record.licence}
                    {record.draftCase ? <span className="text-hit">Marked draft saved</span>
                      : record.preparedMedia ? <span className="text-accent">Image ready to mark</span>
                        : null}
                    {record.reviewer && <span className="ml-auto">Reviewer: {record.reviewer}</span>}
                  </div>
                </button>
              );
            })
          )}
        </div>

        {editing && (
          <CandidateEditor
            key={editing === "new" ? "new" : `${editing.id}-${editing.updatedAt}`}
            initial={editing === "new" ? null : editing}
            onCancel={() => {
              setEditing(null);
              void refresh();
            }}
            onSaved={(saved) => {
              setRecords((current) => {
                const next = current.filter((record) => record.id !== saved.id);
                return [saved, ...next];
              });
              setEditing(saved);
            }}
            onBuildCase={onBuildCase}
            onPrepareCase={onPrepareCase}
            onPublishCase={onPublishCase}
          />
        )}
      </div>
    </div>
  );
}
