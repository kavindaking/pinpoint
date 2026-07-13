import { useState } from "react";
import { ArrowRight, Crosshair, Play as PlayIcon } from "../components/icons";
import type { RegionOutcome } from "../types";
import { DEFAULT_SCORING } from "../types";
import { SEED_CASES } from "../data/seedCases";
import { evaluateClick } from "../lib/scoring";
import { shapeCenter } from "../lib/geometry";
import { ImageViewer, type ViewerPoint } from "../components/ImageViewer";
import { ShapeSvg } from "../components/ShapeSvg";
import { Button } from "../components/ui";

const RESULT_COLOR: Record<string, string> = {
  hit: "var(--hit)",
  near: "var(--near)",
  miss: "var(--miss)",
};

const RESULT_LINE: Record<string, string> = {
  hit: "Direct hit. Full marks.",
  near: "Close. Partial credit for proximity.",
  miss: "Missed. The region lights up so you learn it anyway.",
};

/**
 * One-click demo on the hero: the real viewer, the real scoring engine,
 * one bundled case. Not a mockup.
 */
function HeroDemo() {
  const demoCase = SEED_CASES[0];
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [outcome, setOutcome] = useState<RegionOutcome | null>(null);

  const handleTap = (p: ViewerPoint) => {
    if (outcome || !size) return;
    const evaluation = evaluateClick(p, demoCase.regions, DEFAULT_SCORING, size.w, size.h);
    setOutcome({ ...evaluation, click: p, slice: 0 });
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-ink-dim">
        <span className="font-medium text-ink">Try it.</span> {demoCase.stem} Click where the
        problem is.
      </p>
      <ImageViewer
        radCase={demoCase}
        onImageSize={(w, h) => setSize({ w, h })}
        onTap={handleTap}
        cursor={outcome ? "default" : "crosshair"}
        maxHeight="52vh"
        overlay={(w, h) =>
          outcome && (
            <>
              {demoCase.regions.map((r) => {
                const c = shapeCenter(r.shape);
                const color = RESULT_COLOR[outcome.result];
                return (
                  <g key={r.id}>
                    <ShapeSvg shape={r.shape} w={w} h={h} stroke={color} fill={color} className="region-reveal" />
                    <text
                      x={c.x * w}
                      y={c.y * h}
                      fill={color}
                      fontSize={Math.max(13, 0.016 * Math.hypot(w, h))}
                      textAnchor="middle"
                      style={{ fontFamily: "Geist Variable, sans-serif", paintOrder: "stroke", stroke: "rgba(0,0,0,0.65)", strokeWidth: 3 }}
                    >
                      {demoCase.title}
                    </text>
                  </g>
                );
              })}
              <g className="marker-pop">
                <circle
                  cx={outcome.click.x * w}
                  cy={outcome.click.y * h}
                  r={0.008 * Math.hypot(w, h)}
                  fill={RESULT_COLOR[outcome.result]}
                  fillOpacity={0.25}
                  stroke={RESULT_COLOR[outcome.result]}
                  strokeWidth={2}
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            </>
          )
        }
      />
      <div className="flex min-h-6 items-center justify-between gap-3 text-sm">
        {outcome ? (
          <>
            <span className="rise-in" style={{ color: RESULT_COLOR[outcome.result] }}>
              {RESULT_LINE[outcome.result]}
              {outcome.points > 0 && (
                <span className="ml-1.5 font-mono">+{outcome.points}</span>
              )}
            </span>
            <button
              type="button"
              onClick={() => setOutcome(null)}
              className="cursor-pointer text-ink-faint transition-colors hover:text-ink"
            >
              Reset
            </button>
          </>
        ) : (
          <span className="flex items-center gap-1.5 text-ink-faint">
            <Crosshair size={15} />
            Scored live by the same engine as the game
          </span>
        )}
      </div>
    </div>
  );
}

/** Static multi-region preview for the case-builder section. */
function BuilderPreview() {
  const colles = SEED_CASES.find((c) => c.id === "seed-colles") ?? SEED_CASES[0];
  return (
    <ImageViewer
      radCase={colles}
      maxHeight="44vh"
      overlay={(w, h) =>
        colles.regions.map((r) => (
          <ShapeSvg
            key={r.id}
            shape={r.shape}
            w={w}
            h={h}
            stroke="var(--accent)"
            fill="var(--accent)"
            fillOpacity={0.12}
          />
        ))
      }
    />
  );
}

export function Landing({
  onPlay,
  onBrowse,
}: {
  onPlay: () => void;
  onBrowse: () => void;
}) {
  return (
    <div className="mx-auto w-full max-w-6xl px-4">
      {/* Hero: copy left, live demo right */}
      <section className="grid items-center gap-10 py-14 lg:grid-cols-[1fr_1.1fr] lg:gap-16 lg:py-20">
        <div>
          <h1 className="text-4xl font-semibold tracking-tighter md:text-5xl">
            Read the film.
            <br />
            Call the finding.
          </h1>
          <p className="mt-4 max-w-[40ch] text-base leading-relaxed text-ink-dim">
            Pinpoint is a radiology training game. Each case is one image; you click where the
            pathology is and get scored on precision.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Button variant="primary" className="!px-6 !py-3 !text-base" onClick={onPlay}>
              <PlayIcon size={18} weight="fill" />
              Start training
            </Button>
            <Button className="!px-5 !py-3 !text-base" onClick={onBrowse}>
              Browse the cases
            </Button>
          </div>
          <p className="mt-5 text-xs text-ink-faint">
            Free, runs in your browser, nothing leaves your machine.
          </p>
        </div>
        <HeroDemo />
      </section>

      {/* How a round works */}
      <section className="border-t border-line py-14 lg:py-16">
        <h2 className="text-2xl font-semibold tracking-tight">A round takes two minutes.</h2>
        <div className="mt-8 flex flex-col divide-y divide-(--border)">
          {(
            [
              [
                "Aim",
                "A film and a one-line history. Click where you think the abnormality is; multi-finding cases give you one click per finding.",
              ],
              [
                "Score",
                "Inside the ground-truth region scores full points. Near misses earn partial credit that falls off with distance. A timer adds a speed bonus if you want the pressure.",
              ],
              [
                "Learn",
                "The region draws itself on the image with the diagnosis and a one-line teaching point. End of round, you get the damage report.",
              ],
            ] as const
          ).map(([title, body]) => (
            <div key={title} className="grid gap-2 py-5 sm:grid-cols-[10rem_1fr] sm:gap-6">
              <h3 className="font-medium text-accent">{title}</h3>
              <p className="max-w-[65ch] text-sm leading-relaxed text-ink-dim">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Case builder */}
      <section className="grid items-center gap-10 border-t border-line py-14 lg:grid-cols-[1fr_1.1fr] lg:gap-16 lg:py-16">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">
            Build the case set you wish you had.
          </h2>
          <p className="mt-3 max-w-[46ch] text-sm leading-relaxed text-ink-dim">
            Drop in de-identified DICOM, PNG, JPG, or WebP files and mark the ground truth directly on the image
            with ellipse, box, freehand, or point tools. Tag cases by subspecialty, modality, and
            difficulty, then filter your rounds to what you are revising: MSK before the on-call
            shift, neuro before the exam.
          </p>
          <ul className="mt-5 flex flex-col gap-2 text-sm text-ink-dim">
            {[
              "Multiple regions per case for multi-finding films",
              "Everything stored locally in your browser",
              "Share case sets as a single JSON export",
            ].map((line) => (
              <li key={line} className="flex items-start gap-2.5">
                <ArrowRight size={15} className="mt-0.5 shrink-0 text-accent" />
                {line}
              </li>
            ))}
          </ul>
        </div>
        <BuilderPreview />
      </section>

      {/* Closing CTA */}
      <section className="flex flex-col items-start gap-4 border-t border-line py-14 lg:py-16">
        <h2 className="text-2xl font-semibold tracking-tight">
          Six teaching cases are loaded and waiting.
        </h2>
        <p className="max-w-[52ch] text-sm leading-relaxed text-ink-dim">
          Pneumothorax to epidural hematoma, all de-identified and openly licensed. For education
          only, not for clinical use.
        </p>
        <Button variant="primary" className="mt-1 !px-6 !py-3 !text-base" onClick={onPlay}>
          <PlayIcon size={18} weight="fill" />
          Start training
        </Button>
      </section>
    </div>
  );
}
