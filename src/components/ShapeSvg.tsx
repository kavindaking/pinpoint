import type { Shape } from "../types";

/**
 * Renders one normalized shape into an SVG whose viewBox matches the image's
 * natural pixel size. Strokes use vector-effect so they stay hairline at any
 * rendered size.
 */
export function ShapeSvg({
  shape,
  w,
  h,
  stroke,
  fill = "none",
  className,
  dashed = false,
  fillOpacity,
}: {
  shape: Shape;
  w: number;
  h: number;
  stroke: string;
  fill?: string;
  className?: string;
  dashed?: boolean;
  fillOpacity?: number;
}) {
  const common = {
    stroke,
    fill,
    strokeWidth: 2,
    vectorEffect: "non-scaling-stroke" as const,
    className,
    fillOpacity,
    strokeDasharray: dashed ? "6 5" : undefined,
    // Perimeter budget for the draw-in animation (CSS custom property).
    style: { "--dash-len": 2000 } as React.CSSProperties,
  };

  switch (shape.kind) {
    case "point": {
      const x = shape.x * w;
      const y = shape.y * h;
      const r = 0.02 * Math.hypot(w, h);
      return (
        <g>
          <circle cx={x} cy={y} r={r} {...common} />
          <circle cx={x} cy={y} r={2.5} fill={stroke} stroke="none" className={className} />
        </g>
      );
    }
    case "ellipse":
      return <ellipse cx={shape.cx * w} cy={shape.cy * h} rx={shape.rx * w} ry={shape.ry * h} {...common} />;
    case "rect":
      return <rect x={shape.x * w} y={shape.y * h} width={shape.w * w} height={shape.h * h} {...common} />;
    case "polygon":
      return <polygon points={shape.points.map(([x, y]) => `${x * w},${y * h}`).join(" ")} {...common} />;
  }
}
