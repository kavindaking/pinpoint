import { useMemo, useState } from "react";
import { ChartBar, Trash } from "../components/icons";
import type { RoundRecord } from "../types";
import { Button, EmptyState, Panel } from "../components/ui";

export function Stats({
  history,
  onClear,
}: {
  history: RoundRecord[];
  onClear: () => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [clearing, setClearing] = useState(false);

  const agg = useMemo(() => {
    const attempts = history.reduce((a, r) => a + r.hits + r.nears + r.misses, 0);
    const hits = history.reduce((a, r) => a + r.hits, 0);
    const nears = history.reduce((a, r) => a + r.nears, 0);
    const byModality = new Map<string, { hits: number; total: number }>();
    for (const r of history) {
      for (const [m, v] of Object.entries(r.byModality)) {
        const cur = byModality.get(m) ?? { hits: 0, total: 0 };
        cur.hits += v.hits;
        cur.total += v.total;
        byModality.set(m, cur);
      }
    }
    return { attempts, hits, nears, byModality: [...byModality.entries()] };
  }, [history]);

  if (history.length === 0) {
    return (
      <div className="mx-auto w-full max-w-4xl px-4 py-8">
        <EmptyState
          icon={<ChartBar size={40} />}
          title="No rounds played yet"
          body="Finish a round in play mode and your accuracy will start accumulating here."
        />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8">
      <div className="mb-6 flex items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Score history</h1>
        <div className="ml-auto">
          {confirming ? (
            <span className="flex items-center gap-2">
              <Button
                variant="danger"
                disabled={clearing}
                onClick={async () => {
                  setClearing(true);
                  try {
                    await onClear();
                    setConfirming(false);
                  } finally {
                    setClearing(false);
                  }
                }}
              >
                {clearing ? "Clearing…" : "Clear all history"}
              </Button>
              <Button onClick={() => setConfirming(false)}>Keep</Button>
            </span>
          ) : (
            <Button onClick={() => setConfirming(true)}>
              <Trash size={15} />
              Clear
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Panel className="p-4">
          <p className="font-mono text-2xl tabular-nums">{history.length}</p>
          <p className="mt-0.5 text-xs text-ink-dim">Rounds played</p>
        </Panel>
        <Panel className="p-4">
          <p className="font-mono text-2xl tabular-nums">{agg.attempts}</p>
          <p className="mt-0.5 text-xs text-ink-dim">Findings attempted</p>
        </Panel>
        <Panel className="p-4">
          <p className="font-mono text-2xl tabular-nums" style={{ color: "var(--hit)" }}>
            {agg.attempts ? Math.round((agg.hits / agg.attempts) * 100) : 0}%
          </p>
          <p className="mt-0.5 text-xs text-ink-dim">Direct hits</p>
        </Panel>
        <Panel className="p-4">
          <p className="font-mono text-2xl tabular-nums" style={{ color: "var(--near)" }}>
            {agg.attempts ? Math.round(((agg.hits + agg.nears) / agg.attempts) * 100) : 0}%
          </p>
          <p className="mt-0.5 text-xs text-ink-dim">On or near target</p>
        </Panel>
      </div>

      {agg.byModality.length > 0 && (
        <Panel className="mt-6 p-5">
          <p className="mb-4 text-sm text-ink-dim">Hit rate by modality</p>
          <div className="flex flex-col gap-3">
            {agg.byModality.map(([m, v]) => {
              const pct = v.total ? Math.round((v.hits / v.total) * 100) : 0;
              return (
                <div key={m} className="grid grid-cols-[7rem_1fr_3.5rem] items-center gap-3">
                  <span className="text-sm text-ink">{m}</span>
                  <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                    <div
                      className="h-full rounded-full bg-accent transition-[width] duration-500"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-right font-mono text-sm tabular-nums text-ink-dim">
                    {pct}%
                  </span>
                </div>
              );
            })}
          </div>
        </Panel>
      )}

      <Panel className="mt-6 divide-y divide-(--border)">
        {[...history].reverse().slice(0, 30).map((r) => (
          <div key={r.id} className="flex items-center gap-4 px-4 py-3">
            <div>
              <p className="font-mono text-sm tabular-nums">
                {r.totalScore}
                <span className="text-ink-faint"> / {r.maxScore}</span>
              </p>
              <p className="text-xs text-ink-faint">
                {new Date(r.finishedAt).toLocaleString(undefined, {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </p>
            </div>
            <p className="ml-auto text-right text-xs text-ink-dim">
              {r.caseCount} cases ·{" "}
              <span style={{ color: "var(--hit)" }}>{r.hits} hit</span> ·{" "}
              <span style={{ color: "var(--near)" }}>{r.nears} close</span> ·{" "}
              <span style={{ color: "var(--miss)" }}>{r.misses} missed</span>
            </p>
          </div>
        ))}
      </Panel>
    </div>
  );
}
