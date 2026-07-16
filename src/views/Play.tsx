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

function overallResult(outcome: CaseOutcome): "hit" | "near" | "miss" {
  if (outcome.timedOut || outcome.outcomes.some((item) => item.result === "miss")) return "miss";
  if (outcome.outcomes.some((item) => item.result === "near")) return "near";
  return "hit";
}

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
  const [scoreBumpKey, setScoreBumpKey] = useState(0);
  const [revealSlice, setRevealSlice] = useState<number | null>(null);
  const [reviewIndex, setReviewIndex] = useState<number | null>(null);

  const current = cases[index];
  const timed = settings.timerSeconds > 0;
  const stack = isStack(current);
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
    if (reviewIndex != null) {
      setReviewIndex(null);
      return;
    }
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
    setRevealSlice(null);
    setReviewIndex(null);
  }, [phase, reviewIndex, finished, index, cases.length, onFinish, settings.timerSeconds]);

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
  const reviewing = phase === "reveal" && reviewIndex != null && reviewIndex < index;
  const displayIndex = reviewing ? reviewIndex : index;
  const displayCase = cases[displayIndex];
  const displayResult = reviewing ? finished[displayIndex] : caseResult;
  const displayOutcomes = reviewing ? (finished[displayIndex]?.outcomes ?? []) : outcomes;
  const displayFoundIds = new Set(displayOutcomes.map((outcome) => outcome.regionId));
  const displayMissedRegions = displayCase.regions.filter((region) => !displayFoundIds.has(region.id));
  const DisplayImageViewer = isDicom(displayCase) ? DicomCaseViewer : ImageViewer;
  const displayStack = isStack(displayCase);
  const displayJumpSlice = reviewing
    ? (displayCase.regions[0]?.slice ?? 0)
    : revealSlice;

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-5">
      {/* Round status strip */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" onClick={onExit} aria-label="Exit round" className="!px-3">
          <ArrowLeft size={16} weight="bold" />
        </Button>
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-sm text-ink-dim">
            {String(displayIndex + 1).padStart(2, "0")} / {String(cases.length).padStart(2, "0")}
          </span>
          <span className="hidden text-sm text-ink-faint sm:inline">
            {displayCase.modality} · {displayCase.bodyRegion}
          </span>
          {reviewing && (
            <span className="rounded-(--radius-ctl) bg-accent-soft px-2 py-0.5 text-xs text-accent">
              Review
            </span>
          )}
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
        {displayCase.stem ?? "No history provided. Where is the abnormality?"}
        {phase === "aim" && current.regions.length > 1 && (
          <span className="ml-2 text-ink-faint">
            {current.regions.length} findings, {current.regions.length - outcomes.length} clicks left
          </span>
        )}
      </p>

      <div className={phase === "reveal" ? "grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]" : ""}>
        <div className="flex min-w-0 flex-col gap-4">
          <DisplayImageViewer
            radCase={displayCase}
            onImageSize={reviewing ? undefined : (w, h) => setImageSize({ w, h })}
            onTap={reviewing ? undefined : handleTap}
            jumpTo={phase === "reveal" ? displayJumpSlice : null}
            pacs={displayStack}
            cursor={phase === "aim" ? "crosshair" : "default"}
            overlay={(w, h, viewSlice) => (
              <>
                {phase === "reveal" &&
                  displayCase.regions
                    .filter((region) => (region.slice ?? 0) === viewSlice)
                    .map((region) => {
                      const found = displayOutcomes.find((outcome) => outcome.regionId === region.id);
                      const color = found ? RESULT_COLOR[found.result] : "var(--miss)";
                      const center = shapeCenter(region.shape);
                      return (
                        <g key={region.id}>
                          <ShapeSvg
                            shape={region.shape}
                            w={w}
                            h={h}
                            stroke={color}
                            fill={color}
                            className="region-reveal"
                          />
                          {region.label && (
                            <text
                              x={center.x * w}
                              y={(center.y + (region.shape.kind === "point" ? 0.035 : 0)) * h}
                              fill={color}
                              fontSize={Math.max(13, 0.016 * Math.hypot(w, h))}
                              textAnchor="middle"
                              className="rise-in"
                              style={{ fontFamily: "Geist Variable, sans-serif", paintOrder: "stroke", stroke: "rgba(0,0,0,0.65)", strokeWidth: 3 }}
                            >
                              {region.label}
                            </text>
                          )}
                        </g>
                      );
                    })}
                {displayOutcomes.map((outcome, outcomeIndex) => {
                  if (outcome.slice !== viewSlice) return null;
                  const color = phase === "reveal" ? RESULT_COLOR[outcome.result] : "var(--accent)";
                  const x = outcome.click.x * w;
                  const y = outcome.click.y * h;
                  const radius = 0.008 * Math.hypot(w, h);
                  return (
                    <g key={outcomeIndex}>
                      {outcomeIndex === displayOutcomes.length - 1 && (
                        <circle cx={x} cy={y} r={radius * 2} fill="none" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" className="ring-pulse" />
                      )}
                      <g className="marker-pop">
                        <circle cx={x} cy={y} r={radius} fill={color} fillOpacity={0.25} stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" />
                        <circle cx={x} cy={y} r={1.5} fill={color} />
                      </g>
                    </g>
                  );
                })}
              </>
            )}
          />

          {phase === "aim" && (
            <p className="flex items-center justify-center gap-2 text-sm text-ink-faint">
              <Crosshair size={16} />
              {stack
                ? "Scroll the slices and click the abnormality. Right-drag to window, ctrl+scroll to zoom, drag to pan while zoomed."
                : "Click where you think the abnormality is"}
            </p>
          )}
        </div>

        {phase === "reveal" && displayResult && (
          <aside className="rise-in flex flex-col gap-4 lg:sticky lg:top-20">
          <div className="rounded-(--radius-panel) border border-line bg-surface p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold tracking-tight">{displayCase.title}</h2>
                <p className="mt-1 text-sm leading-relaxed text-ink-dim">
                  {displayCase.explanation}
                </p>
              </div>
              <div className="flex items-baseline justify-end gap-2 whitespace-nowrap text-right">
                <p className="font-mono text-2xl tabular-nums">
                  +{displayResult.baseScore + displayResult.timeBonus}
                </p>
                {displayResult.timeBonus > 0 && (
                  <p className="font-mono text-xs text-accent">includes +{displayResult.timeBonus} speed</p>
                )}
                {displayResult.timedOut && <p className="text-xs text-miss">Time ran out</p>}
              </div>
            </div>

            <ul className="mt-3 flex flex-wrap gap-2">
              {displayResult.outcomes.map((outcome, outcomeIndex) => {
                const region = displayCase.regions.find((item) => item.id === outcome.regionId);
                return (
                  <li
                    key={outcomeIndex}
                    className="rounded-(--radius-ctl) px-2.5 py-1 text-xs font-medium"
                    style={{ color: RESULT_COLOR[outcome.result], background: `var(--${outcome.result}-soft)` }}
                  >
                    {region?.label ?? "Finding"}: {RESULT_LABEL[outcome.result]}
                    {outcome.result !== "miss" && ` (+${outcome.points})`}
                  </li>
                );
              })}
              {displayMissedRegions.map((region) => (
                <li
                  key={region.id}
                  className="rounded-(--radius-ctl) px-2.5 py-1 text-xs font-medium"
                  style={{ color: "var(--miss)", background: "var(--miss-soft)" }}
                >
                  {region.label ?? "Finding"}: Not found
                </li>
              ))}
            </ul>

            <div className="mt-4 flex flex-col items-stretch gap-3">
              {displayCase.credit ? (
                <p className="text-xs text-ink-faint">
                  Image:{" "}
                  {displayCase.creditUrl ? (
                    <a
                      href={displayCase.creditUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="underline decoration-transparent underline-offset-2 transition-colors hover:text-ink hover:decoration-current"
                    >
                      {displayCase.credit}
                    </a>
                  ) : (
                    displayCase.credit
                  )}
                </p>
              ) : null}
              <Button variant="primary" onClick={advance} autoFocus={!reviewing} className="w-full justify-center">
                {reviewing
                  ? `Back to question ${index + 1}`
                  : index + 1 >= cases.length
                    ? "Finish round"
                    : "Next case"}
                <span className="font-mono text-xs opacity-70">Enter</span>
              </Button>
            </div>
          </div>

          <div className="rounded-(--radius-panel) border border-line bg-surface p-4">
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.14em] text-ink-faint">Session</p>
                <p className="mt-1 text-sm text-ink-dim">
                  <span className="font-mono text-lg text-ink">{index + 1}</span> answered of {cases.length}
                </p>
              </div>
              <p className="font-mono text-sm text-accent">
                {Math.round(((index + 1) / cases.length) * 100)}%
              </p>
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-2">
              <div
                className="h-full rounded-full bg-accent transition-[width]"
                style={{ width: `${((index + 1) / cases.length) * 100}%` }}
              />
            </div>

            <div className="mt-4 grid max-h-56 grid-cols-6 gap-2 overflow-y-auto pr-1">
              {Array.from({ length: index + 1 }, (_, questionIndex) => {
                const result = questionIndex === index ? caseResult : finished[questionIndex];
                if (!result) return null;
                const status = overallResult(result);
                const selected = questionIndex === displayIndex;
                return (
                  <button
                    key={result.caseId}
                    type="button"
                    onClick={() => setReviewIndex(questionIndex === index ? null : questionIndex)}
                    aria-label={`Review question ${questionIndex + 1}, ${RESULT_LABEL[status]}`}
                    aria-current={selected ? "true" : undefined}
                    className={`relative aspect-square cursor-pointer rounded-full border text-sm font-medium transition-colors hover:border-line-strong ${
                      selected ? "border-accent" : "border-transparent"
                    }`}
                    style={{ color: RESULT_COLOR[status], background: `var(--${status}-soft)` }}
                  >
                    <span className="absolute left-1.5 top-0.5 text-[10px]">{status === "hit" ? "✓" : status === "near" ? "~" : "×"}</span>
                    {questionIndex + 1}
                  </button>
                );
              })}
              {index + 1 < cases.length && (
                <div className="flex aspect-square items-center justify-center rounded-full border border-dashed border-line text-sm text-ink-faint">
                  {index + 2}
                </div>
              )}
            </div>
            <p className="mt-3 text-xs leading-relaxed text-ink-faint">
              Select an answered question to review its image, result and explanation.
            </p>
          </div>
          </aside>
        )}
      </div>
    </div>
  );
}
