import type { CaseRegion, ClickResult, RegionOutcome, ScoringSettings } from "../types";
import { distanceToShape } from "./geometry";

export interface ClickEvaluation {
  regionId: string;
  result: ClickResult;
  points: number;
  distance: number;
}

/**
 * Score a click (normalized coords) against the regions not yet found.
 * The click is matched to the closest remaining region on the SAME slice:
 *   inside the region -> full points,
 *   within nearThreshold of its edge -> partial points scaled by distance,
 *   beyond -> miss.
 * In a multi-slice stack, a click on a slice that has no remaining region is
 * a miss with no matched region (the finding is on another slice), so the
 * player has to scroll to it. Distances are computed in natural-pixel space
 * and normalized by the image diagonal, so scoring is display-independent.
 */
export function evaluateClick(
  click: { x: number; y: number },
  remaining: CaseRegion[],
  cfg: ScoringSettings,
  naturalW: number,
  naturalH: number,
  slice = 0,
): ClickEvaluation {
  const diag = Math.hypot(naturalW, naturalH);
  const px = { x: click.x * naturalW, y: click.y * naturalH };
  const pointRadiusPx = cfg.pointTolerance * diag;

  let best: { region: CaseRegion; frac: number } | null = null;
  for (const region of remaining) {
    if ((region.slice ?? 0) !== slice) continue;
    const d = distanceToShape(px, region.shape, naturalW, naturalH, pointRadiusPx);
    const frac = d / diag;
    if (!best || frac < best.frac) best = { region, frac };
  }

  // No candidate on this slice: a wasted click, matched to no region.
  if (!best) return { regionId: "", result: "miss", points: 0, distance: 1 };

  const { region, frac } = best;
  let result: ClickResult;
  let points: number;
  if (frac === 0) {
    result = "hit";
    points = cfg.hitPoints;
  } else if (frac <= cfg.nearThreshold) {
    result = "near";
    points = Math.round(cfg.nearMaxPoints * (1 - frac / cfg.nearThreshold));
  } else {
    result = "miss";
    points = 0;
  }
  return { regionId: region.id, result, points, distance: frac };
}

/** Mean of per-region points, so multi-finding cases still top out at hitPoints. */
export function caseBaseScore(outcomes: RegionOutcome[], regionCount: number, cfg: ScoringSettings): number {
  if (regionCount === 0) return 0;
  const sum = outcomes.reduce((acc, o) => acc + o.points, 0);
  return Math.round(Math.min(sum / regionCount, cfg.hitPoints));
}

/** Speed bonus: proportional to time left and to how well the case went. */
export function timeBonus(baseScore: number, timeLeft: number, cfg: ScoringSettings): number {
  if (cfg.timerSeconds <= 0 || timeLeft <= 0) return 0;
  const quality = baseScore / cfg.hitPoints;
  return Math.round(cfg.timerBonusMax * (timeLeft / cfg.timerSeconds) * quality);
}
