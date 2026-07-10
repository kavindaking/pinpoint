import { useMemo } from "react";
import { ArrowCounterClockwise, House } from "../components/icons";
import type { CaseOutcome, ScoringSettings } from "../types";
import { Button, Panel } from "../components/ui";

export function Summary({
  outcomes,
  settings,
  onReplay,
  onHome,
}: {
  outcomes: CaseOutcome[];
  settings: ScoringSettings;
  onReplay: () => void;
  onHome: () => void;
}) {
  const stats = useMemo(() => {
    const total = outcomes.reduce((a, c) => a + c.baseScore + c.timeBonus, 0);
    const max = outcomes.length * (settings.hitPoints + (settings.timerSeconds > 0 ? settings.timerBonusMax : 0));
    const flat = outcomes.flatMap((c) => c.outcomes);
    return {
      total,
      max,
      hits: flat.filter((o) => o.result === "hit").length,
      nears: flat.filter((o) => o.result === "near").length,
      misses: flat.filter((o) => o.result === "miss").length,
    };
  }, [outcomes, settings]);

  const grade =
    stats.total >= stats.max * 0.85
      ? "Sharp eyes. Consultant material."
      : stats.total >= stats.max * 0.6
        ? "Solid read. A few findings got away."
        : stats.total >= stats.max * 0.3
          ? "Getting there. Review the misses below."
          : "Tough round. Study mode is your friend.";

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10">
      <p className="text-sm text-ink-dim">Round complete</p>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="font-mono text-5xl font-medium tabular-nums tracking-tight">
          {stats.total}
          <span className="text-xl text-ink-faint"> / {stats.max}</span>
        </h1>
        <p className="text-sm text-ink-dim">{grade}</p>
      </div>

      <div className="mt-6 grid grid-cols-3 gap-3">
        {(
          [
            ["Hits", stats.hits, "var(--hit)"],
            ["Close", stats.nears, "var(--near)"],
            ["Misses", stats.misses, "var(--miss)"],
          ] as const
        ).map(([label, value, color]) => (
          <Panel key={label} className="p-4">
            <p className="font-mono text-2xl tabular-nums" style={{ color }}>
              {value}
            </p>
            <p className="mt-0.5 text-xs text-ink-dim">{label}</p>
          </Panel>
        ))}
      </div>

      <Panel className="mt-6 divide-y divide-(--border)">
        {outcomes.map((c, i) => {
          const best = c.outcomes.every((o) => o.result === "hit") && c.outcomes.length > 0;
          const worst = c.outcomes.every((o) => o.result === "miss");
          const color = best ? "var(--hit)" : worst ? "var(--miss)" : "var(--near)";
          return (
            <div key={i} className="flex items-center gap-3 px-4 py-3">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
              <div className="min-w-0">
                <p className="truncate text-sm text-ink">{c.title}</p>
                <p className="text-xs text-ink-faint">
                  {c.modality} · {c.bodyRegion}
                  {c.timedOut && " · timed out"}
                </p>
              </div>
              <span className="ml-auto font-mono text-sm tabular-nums text-ink-dim">
                +{c.baseScore + c.timeBonus}
              </span>
            </div>
          );
        })}
      </Panel>

      <div className="mt-6 flex gap-3">
        <Button variant="primary" onClick={onReplay}>
          <ArrowCounterClockwise size={16} />
          Play again
        </Button>
        <Button onClick={onHome}>
          <House size={16} />
          Back to setup
        </Button>
      </div>
    </div>
  );
}
