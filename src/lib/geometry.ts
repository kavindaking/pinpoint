import type { Shape } from "../types";

export interface Pt {
  x: number;
  y: number;
}

/**
 * Distance from a point to a shape, both given in the same pixel space.
 * Returns 0 when the point is inside the shape; otherwise the distance
 * to the nearest boundary. Shapes arrive normalized (0..1) and are scaled
 * by the image's natural width/height so distances are true pixels.
 */
export function distanceToShape(p: Pt, shape: Shape, w: number, h: number, pointRadiusPx: number): number {
  switch (shape.kind) {
    case "point": {
      const d = Math.hypot(p.x - shape.x * w, p.y - shape.y * h);
      return Math.max(0, d - pointRadiusPx);
    }
    case "ellipse": {
      const cx = shape.cx * w;
      const cy = shape.cy * h;
      const rx = shape.rx * w;
      const ry = shape.ry * h;
      const dx = p.x - cx;
      const dy = p.y - cy;
      if (rx <= 0 || ry <= 0) return Math.hypot(dx, dy);
      // t <= 1 means inside. Outside, measure along the ray to the boundary;
      // exact enough for scoring without an iterative ellipse solver.
      const t = Math.hypot(dx / rx, dy / ry);
      if (t <= 1) return 0;
      return Math.hypot(dx, dy) * (1 - 1 / t);
    }
    case "rect": {
      const x0 = shape.x * w;
      const y0 = shape.y * h;
      const x1 = x0 + shape.w * w;
      const y1 = y0 + shape.h * h;
      const dx = Math.max(x0 - p.x, 0, p.x - x1);
      const dy = Math.max(y0 - p.y, 0, p.y - y1);
      return Math.hypot(dx, dy);
    }
    case "polygon": {
      const pts = shape.points.map(([x, y]) => ({ x: x * w, y: y * h }));
      if (pointInPolygon(p, pts)) return 0;
      let min = Infinity;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        min = Math.min(min, distanceToSegment(p, a, b));
      }
      return min;
    }
  }
}

export function pointInPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

function distanceToSegment(p: Pt, a: Pt, b: Pt): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lenSq = abx * abx + aby * aby;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq));
  return Math.hypot(p.x - (a.x + t * abx), p.y - (a.y + t * aby));
}

/** Centroid of a shape in normalized coordinates, used to label reveals. */
export function shapeCenter(shape: Shape): Pt {
  switch (shape.kind) {
    case "point":
      return { x: shape.x, y: shape.y };
    case "ellipse":
      return { x: shape.cx, y: shape.cy };
    case "rect":
      return { x: shape.x + shape.w / 2, y: shape.y + shape.h / 2 };
    case "polygon": {
      const n = shape.points.length;
      const sum = shape.points.reduce((acc, [x, y]) => ({ x: acc.x + x, y: acc.y + y }), { x: 0, y: 0 });
      return { x: sum.x / n, y: sum.y / n };
    }
  }
}
