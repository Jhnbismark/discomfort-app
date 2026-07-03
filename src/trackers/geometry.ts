import type { NormalizedLandmark } from '@mediapipe/tasks-vision';

/** Shared pose math. Pure functions only — no state, no tracker imports. */

/** Interior angle at vertex B formed by A-B-C, in degrees (0–180). */
export function angleABC(
  a: NormalizedLandmark,
  b: NormalizedLandmark,
  c: NormalizedLandmark
): number {
  const abx = a.x - b.x;
  const aby = a.y - b.y;
  const cbx = c.x - b.x;
  const cby = c.y - b.y;
  const dot = abx * cbx + aby * cby;
  const magAb = Math.hypot(abx, aby);
  const magCb = Math.hypot(cbx, cby);
  if (magAb === 0 || magCb === 0) return 180;
  let cos = dot / (magAb * magCb);
  cos = Math.max(-1, Math.min(1, cos));
  return (Math.acos(cos) * 180) / Math.PI;
}

/** MediaPipe marks landmark confidence on `visibility` (0–1). Missing => 0. */
export function vis(lm: NormalizedLandmark | undefined): number {
  return lm?.visibility ?? 0;
}

/** True when every listed landmark clears the visibility floor. */
export function allVisible(
  landmarks: NormalizedLandmark[],
  indices: number[],
  floor: number
): boolean {
  return indices.every((i) => vis(landmarks[i]) >= floor);
}

/** Linear map of v from [inMin,inMax] onto [outMin,outMax], clamped. */
export function mapClamp(
  v: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number
): number {
  if (inMax === inMin) return outMin;
  const t = (v - inMin) / (inMax - inMin);
  const c = Math.max(0, Math.min(1, t));
  return outMin + c * (outMax - outMin);
}
