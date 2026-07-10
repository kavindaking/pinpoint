import { useEffect, useState } from "react";
import { ArrowLeft, CaretLeft, CaretRight, Eye, EyeSlash } from "../components/icons";
import type { RadCase } from "../types";
import { ImageViewer } from "../components/ImageViewer";
import { ShapeSvg } from "../components/ShapeSvg";
import { shapeCenter } from "../lib/geometry";
import { Button } from "../components/ui";

/** Browse cases with the answers on: no clicks, no scoring, just the teaching. */
export function Study({
  cases,
  startAt,
  onExit,
}: {
  cases: RadCase[];
  startAt: number;
  onExit: () => void;
}) {
  const [index, setIndex] = useState(startAt);
  const [showRegions, setShowRegions] = useState(true);
  const current = cases[index];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") setIndex((i) => Math.min(i + 1, cases.length - 1));
      else if (e.key === "ArrowLeft") setIndex((i) => Math.max(i - 1, 0));
      else if (e.key === "Escape") onExit();
      else if (e.key.toLowerCase() === "r") setShowRegions((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cases.length, onExit]);

  if (!current) return null;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-5">
      <div className="flex items-center gap-3">
        <Button variant="ghost" onClick={onExit} className="!px-3" aria-label="Back to cases">
          <ArrowLeft size={16} weight="bold" />
        </Button>
        <div>
          <h1 className="font-medium leading-tight">{current.title}</h1>
          <p className="text-xs text-ink-faint">
            {current.modality} · {current.bodyRegion} · {current.difficulty}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button onClick={() => setShowRegions((v) => !v)} className="!px-3">
            {showRegions ? <EyeSlash size={16} /> : <Eye size={16} />}
            <span className="hidden sm:inline">{showRegions ? "Hide answer" : "Show answer"}</span>
          </Button>
          <span className="font-mono text-sm text-ink-faint">
            {index + 1}/{cases.length}
          </span>
          <Button
            className="!px-2.5"
            disabled={index === 0}
            onClick={() => setIndex(index - 1)}
            aria-label="Previous case"
          >
            <CaretLeft size={16} />
          </Button>
          <Button
            className="!px-2.5"
            disabled={index === cases.length - 1}
            onClick={() => setIndex(index + 1)}
            aria-label="Next case"
          >
            <CaretRight size={16} />
          </Button>
        </div>
      </div>

      {current.stem && <p className="text-sm text-ink-dim">{current.stem}</p>}

      <ImageViewer
        radCase={current}
        overlay={(w, h, viewSlice) =>
          showRegions &&
          current.regions
            .filter((r) => (r.slice ?? 0) === viewSlice)
            .map((r) => {
            const c = shapeCenter(r.shape);
            return (
              <g key={r.id}>
                <ShapeSvg
                  shape={r.shape}
                  w={w}
                  h={h}
                  stroke="var(--accent)"
                  fill="var(--accent)"
                  className="region-reveal"
                />
                {r.label && (
                  <text
                    x={c.x * w}
                    y={(c.y + (r.shape.kind === "point" ? 0.035 : 0)) * h}
                    fill="var(--accent)"
                    fontSize={Math.max(13, 0.016 * Math.hypot(w, h))}
                    textAnchor="middle"
                    style={{
                      fontFamily: "Geist Variable, sans-serif",
                      paintOrder: "stroke",
                      stroke: "rgba(0,0,0,0.65)",
                      strokeWidth: 3,
                    }}
                  >
                    {r.label}
                  </text>
                )}
              </g>
            );
          })
        }
      />

      <div className="rounded-(--radius-panel) border border-line bg-surface p-4">
        <p className="max-w-[70ch] text-sm leading-relaxed text-ink-dim">{current.explanation}</p>
        {current.credit && <p className="mt-2 text-xs text-ink-faint">Image: {current.credit}</p>}
      </div>
    </div>
  );
}
