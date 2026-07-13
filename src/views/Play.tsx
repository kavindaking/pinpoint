import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Crosshair, Timer } from "../components/icons";
import type { CaseOutcome, RadCase, RegionOutcome, ScoringSettings } from "../types";
import { isDicom, isStack } from "../types";
import { caseBaseScore, evaluateClick, timeBonus } from "../lib/scoring";
import { shapeCenter } from "../lib/geometry";
import { ImageViewer, type ViewerPoint } from "../components/ImageViewer";
import { DicomCaseViewer } from "../components/DicomStudyViewer";
import { ShapeSvg } from "../components/ShapeSvg";
import { Button } from "../components/ui";

type Phase = "aim" | "reveal";

const RESULT_COLOR: Record<string, string> = {
  hit: "var(--hit)",
  near: "var(--near)",
  miss: "var(--miss)",
};

const RESULT_LABEL: Record<string, string> = {
  hit: "Direct hit",
  near: "Close",
  miss: "Missed",
};

export function Play({
  cases,
  settings,
  onFinish,
  onExit,
}: {
  cases: RadCase[];
  settings: ScoringSettings;
  onFinish: (outcomes: CaseOutcome[]) => void;
  onExit: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>("aim");
  const [outcomes, setOutcomes] = useState<RegionOutcome[]>([]);
  const [finished, setFinished] = useState<CaseOutcome[]>([]);
  const [imageSize, setImageSize] = useState<{ w: number; h: number } | null>(null);
  const [timeLeft, setTimeLeft] = useState(settings.timerSeconds);
  const [timedOut, setTimedOut] = useState(false);
  const [scoreBumpKey, setScoreBumpKey] = useState(0);
  const [revealSlice, setRevealSlice] = useState<number | null>(null);

  const current = cases[index];
  const timed = settings.timerSeconds > 0;
  const stack = isStack(current);
  const CaseImageViewer = isDicom(current) ? DicomCaseViewer : ImageViewer;
  const foundIds = useMemo(() => new Set(outcomes.map((o) => o.regionId)), [outcomes]);
  const remaining = useMemo(
    () => current.regions.filter((r) => !foundIds.has(r.id)),
    [current, foundIds],
  );

  const totalSoFar = useMemo(
    () => finished.reduce((acc, c) => acc + c.baseScore + c.timeBonus, 0),
    [finished],
  );

  // Freeze the outcome of the case at reveal time.
  const revealOutcome = useRef<CaseOutcome | null>(null);

  const reveal = useCallback(
    (finalOutcomes: RegionOutcome[], didTimeOut: boolean) => {
      const base = caseBaseScore(finalOutcomes, current.regions.length, settings);
      const bonus = didTimeOut ? 0 : timeBonus(base, timeLeft, settings);
      revealOutcome.current = {
        caseId: current.id,
        title: current.title,
        modality: current.modality,
        bodyRegion: current.bodyRegion,
        outcomes: finalOutcomes,
        baseScore: base,
        timeBonus: bonus,
        timedOut: didTimeOut,
      };
      setTimedOut(didTimeOut);
      setPhase("reveal");
      setScoreBumpKey((k) => k + 1);
      // Jump the stack to the first finding so the reveal is visible.
      const firstFound = finalOutcomes.find((o) => o.regionId);
      const target =
        current.regions.find((r) => r.id === firstFound?.regionId) ?? current.regions[0];
      setRevealSlice(target?.slice ?? 0);
    },
    [current, settings, timeLeft],
  );

  // Per-case countdown.
  useEffect(() => {
    if (!timed || phase !== "aim") return;
    const started = Date.now();
    const startValue = timeLeft;
    const id = setInterval(() => {
      const left = startValue - (Date.now() - started) / 1000;
      if (left <= 0) {
        clearInterval(id);
        setTimeLeft(0);
      } else {
        setTimeLeft(left);
      }
    }, 100);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timed, phase, index]);

  // Timeout ends the case.
  useEffect(() => {
    if (timed && phase === "aim" && timeLeft <= 0) reveal(outcomes, true);
  }, [timed, phase, timeLeft, outcomes, reveal]);

  const handleTap = (p: ViewerPoint, slice: number) => {
    if (phase !== "aim" || !imageSize) return;
    const evaluation = evaluateClick(p, remaining, settings, imageSize.w, imageSize.h, slice);
    const outcome: RegionOutcome = { ...evaluation, click: p, slice };
    const next = [...outcomes, outcome];
    setOutcomes(next);
    if (next.length >= current.regions.length) reveal(next, false);
  };

  const advance = useCallback(() => {
    if (phase !== "reveal" || !revealOutcome.current) return;
    const done = [...finished, revealOutcome.current];
    revealOutcome.current = null;
    if (index + 1 >= cases.length) {
      onFinish(done);
      return;
    }
    setFinished(done);
    setIndex(index + 1);
    setOutcomes([]);
    setPhase("aim");
    setImageSize(null);
    setTimeLeft(settings.timerSeconds);
    setTimedOut(false);
    setRevealSlice(null);
  }, [phase, finished, index, cases.length, onFinish, settings.timerSeconds]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        advance();
      } else if (e.key === "Escape") {
        onExit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [advance, onExit]);

  const caseResult = revealOutcome.current;
  const missedRegions = current.regions.filter((r) => !foundIds.has(r.id));

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-5">
      {/* Round status strip */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" onClick={onExit} aria-label="Exit round" className="!px-3">
          <ArrowLeft size={16} weight="bold" />
        </Button>
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-sm text-ink-dim">
            {String(index + 1).padStart(2, "0")} / {String(cases.length).padStart(2, "0")}
          </span>
          <span className="hidden text-sm text-ink-faint sm:inline">
            {current.modality} · {current.bodyRegion}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-4">
          {timed && phase === "aim" && (
            <span
              className={`flex items-center gap-1.5 font-mono text-sm tabular-nums ${
                timeLeft < 6 ? "text-miss" : "text-ink-dim"
              }`}
            >
              <Timer size={16} />
              {Math.ceil(timeLeft)}s
            </span>
          )}
          <span key={scoreBumpKey} className="score-bump font-mono text-lg tabular-nums text-ink">
            {totalSoFar + (caseResult ? caseResult.baseScore + caseResult.timeBonus : 0)}
            <span className="ml-1 text-xs text-ink-faint">pts</span>
          </span>
        </div>
      </div>

      {/* Clinical stem */}
      <p className="text-sm text-ink-dim">
        {current.stem ?? "No history provided. Where is the abnormality?"}
        {phase === "aim" && current.regions.length > 1 && (
          <span className="ml-2 text-ink-faint">
            {current.regions.length} findings, {current.regions.length - outcomes.length} clicks left
          </span>
        )}
      </p>

      <CaseImageViewer
        radCase={current}
        onImageSize={(w, h) => setImageSize({ w, h })}
        onTap={handleTap}
        jumpTo={phase === "reveal" ? revealSlice : null}
        pacs={stack}
        cursor={phase === "aim" ? "crosshair" : "default"}
        overlay={(w, h, viewSlice) => (
          <>
            {/* Revealed ground truth on the current slice */}
            {phase === "reveal" &&
              current.regions
                .filter((r) => (r.slice ?? 0) === viewSlice)
                .map((r) => {
                  const found = outcomes.find((o) => o.regionId === r.id);
                  const color = found ? RESULT_COLOR[found.result] : "var(--miss)";
                  const c = shapeCenter(r.shape);
                  return (
                    <g key={r.id}>
                      <ShapeSvg
                        shape={r.shape}
                        w={w}
                        h={h}
                        stroke={color}
                        fill={color}
                        className="region-reveal"
                      />
                      {r.label && (
                        <text
                          x={c.x * w}
                          y={(c.y + (r.shape.kind === "point" ? 0.035 : 0)) * h}
                          fill={color}
                          fontSize={Math.max(13, 0.016 * Math.hypot(w, h))}
                          textAnchor="middle"
                          className="rise-in"
                          style={{ fontFamily: "Geist Variable, sans-serif", paintOrder: "stroke", stroke: "rgba(0,0,0,0.65)", strokeWidth: 3 }}
                        >
                          {r.label}
                        </text>
                      )}
                    </g>
                  );
                })}
            {/* Click markers placed on their own slice */}
            {outcomes.map((o, i) => {
              if (o.slice !== viewSlice) return null;
              const color = phase === "reveal" ? RESULT_COLOR[o.result] : "var(--accent)";
              const x = o.click.x * w;
              const y = o.click.y * h;
              const r = 0.008 * Math.hypot(w, h);
              return (
                <g key={i}>
                  {i === outcomes.length - 1 && (
                    <circle cx={x} cy={y} r={r * 2} fill="none" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" className="ring-pulse" />
                  )}
                  <g className="marker-pop">
                    <circle cx={x} cy={y} r={r} fill={color} fillOpacity={0.25} stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" />
                    <circle cx={x} cy={y} r={1.5} fill={color} />
                  </g>
                </g>
              );
            })}
          </>
        )}
      />

      {/* Aim hint / feedback card */}
      {phase === "aim" ? (
        <p className="flex items-center justify-center gap-2 text-sm text-ink-faint">
          <Crosshair size={16} />
          {stack
            ? "Scroll the slices and click the abnormality. Right-drag to window, ctrl+scroll to zoom, drag to pan while zoomed."
            : "Click where you think the abnormality is"}
        </p>
      ) : (
        caseResult && (
          <div className="rise-in rounded-(--radius-panel) border border-line bg-surface p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold tracking-tight">{current.title}</h2>
                <p className="mt-1 max-w-[65ch] text-sm leading-relaxed text-ink-dim">
                  {current.explanation}
                </p>
              </div>
              <div className="text-right">
                <p className="font-mono text-2xl tabular-nums">
                  +{caseResult.baseScore + caseResult.timeBonus}
                </p>
                {caseResult.timeBonus > 0 && (
                  <p className="font-mono text-xs text-accent">includes +{caseResult.timeBonus} speed</p>
                )}
                {timedOut && <p className="text-xs text-miss">Time ran out</p>}
              </div>
            </div>

            <ul className="mt-3 flex flex-wrap gap-2">
              {caseResult.outcomes.map((o, i) => {
                const region = current.regions.find((r) => r.id === o.regionId);
                return (
                  <li
                    key={i}
                    className="rounded-(--radius-ctl) px-2.5 py-1 text-xs font-medium"
                    style={{ color: RESULT_COLOR[o.result], background: `var(--${o.result}-soft)` }}
                  >
                    {region?.label ?? "Finding"}: {RESULT_LABEL[o.result]}
                    {o.result !== "miss" && ` (+${o.points})`}
                  </li>
                );
              })}
              {missedRegions.map((r) => (
                <li
                  key={r.id}
                  className="rounded-(--radius-ctl) px-2.5 py-1 text-xs font-medium"
                  style={{ color: "var(--miss)", background: "var(--miss-soft)" }}
                >
                  {r.label ?? "Finding"}: Not found
                </li>
              ))}
            </ul>

            <div className="mt-4 flex items-center justify-between gap-3">
              {current.credit ? (
                <p className="text-xs text-ink-faint">Image: {current.credit}</p>
              ) : (
                <span />
              )}
              <Button variant="primary" onClick={advance} autoFocus>
                {index + 1 >= cases.length ? "Finish round" : "Next case"}
                <span className="font-mono text-xs opacity-70">Enter</span>
              </Button>
            </div>
          </div>
        )
      )}
    </div>
  );
}
