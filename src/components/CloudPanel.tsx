import { useState } from "react";
import { Check, CircleNotch, CloudArrowDown, CloudArrowUp, Copy, LinkSimple } from "./icons";
import type { RadCase } from "../types";
import { importFromCloud, parseCasesFromCloud, publishCases, shareLink, type Shared } from "../lib/cloud";
import { Button, inputClass } from "./ui";

/**
 * Publish the current personal case set to the cloud and pull shared sets
 * back by code. Uploads stream straight to the Blob CDN, so a shared set is
 * a short code anyone can import from anywhere.
 */
export function CloudPanel({
  cases,
  onImported,
  onImportCases,
  onClose,
}: {
  cases: RadCase[];
  onImported: () => void;
  onImportCases?: (cases: RadCase[]) => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState<"share" | "import" | null>(null);
  const [shared, setShared] = useState<Shared | null>(null);
  const [copied, setCopied] = useState(false);
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const doShare = async () => {
    setBusy("share");
    setError(null);
    setMsg(null);
    try {
      setShared(await publishCases(cases));
    } catch (e) {
      setError((e as Error).message || "Sharing failed. Is the cloud configured?");
    } finally {
      setBusy(null);
    }
  };

  const doImport = async () => {
    setBusy("import");
    setError(null);
    setMsg(null);
    try {
      let n: number;
      if (onImportCases) {
        const imported = await parseCasesFromCloud(code);
        await onImportCases(imported);
        n = imported.length;
      } else {
        n = await importFromCloud(code);
      }
      setMsg(`Imported ${n} ${n === 1 ? "case" : "cases"} into My cases.`);
      setCode("");
      onImported();
    } catch (e) {
      setError((e as Error).message || "Import failed.");
    } finally {
      setBusy(null);
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked; the field is selectable */
    }
  };

  return (
    <div className="rise-in mb-6 grid gap-5 rounded-(--radius-panel) border border-line bg-surface p-5 sm:grid-cols-2">
      {/* Share */}
      <div className="flex flex-col gap-3 sm:border-r sm:border-line sm:pr-5">
        <div className="flex items-center gap-2">
          <CloudArrowUp size={18} className="text-accent" />
          <h2 className="font-medium">Share your cases</h2>
        </div>
        <p className="text-sm text-ink-dim">
          Upload your {cases.length} personal {cases.length === 1 ? "case" : "cases"} to the cloud
          and get a short code others can import.
        </p>
        {shared ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-ink-faint">Code</span>
              <code className="rounded-(--radius-ctl) bg-surface-2 px-2 py-1 font-mono text-sm text-accent">
                {shared.id}
              </code>
              <Button className="!px-2.5 !py-1 !text-xs" onClick={() => copy(shared.id)}>
                {copied ? <Check size={13} /> : <Copy size={13} />}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <Button className="!px-2.5 !py-1 !text-xs !justify-start" onClick={() => copy(shareLink(shared.id))}>
              <LinkSimple size={13} />
              Copy share link
            </Button>
          </div>
        ) : (
          <Button variant="primary" onClick={doShare} disabled={busy !== null || cases.length === 0}>
            {busy === "share" ? <CircleNotch size={15} className="animate-spin" /> : <CloudArrowUp size={15} />}
            {busy === "share" ? "Uploading" : "Share to cloud"}
          </Button>
        )}
      </div>

      {/* Import */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <CloudArrowDown size={18} className="text-accent" />
          <h2 className="font-medium">Import a shared set</h2>
        </div>
        <p className="text-sm text-ink-dim">Paste a share code or link to add someone else's cases.</p>
        <div className="flex gap-2">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="e.g. k7m2p9qx"
            className={inputClass + " flex-1"}
            onKeyDown={(e) => e.key === "Enter" && code.trim() && doImport()}
          />
          <Button variant="primary" onClick={doImport} disabled={busy !== null || !code.trim()}>
            {busy === "import" ? <CircleNotch size={15} className="animate-spin" /> : <CloudArrowDown size={15} />}
            Import
          </Button>
        </div>
        {msg && <p className="text-sm text-hit">{msg}</p>}
      </div>

      {error && <p className="text-sm text-miss sm:col-span-2">{error}</p>}
      <div className="sm:col-span-2">
        <button type="button" onClick={onClose} className="cursor-pointer text-xs text-ink-faint hover:text-ink">
          Close
        </button>
      </div>
    </div>
  );
}
