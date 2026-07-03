import type { NormalizedLandmark } from '@mediapipe/tasks-vision';

/** Shared FaceMesh math for the eye-based tests (STARE, GAZE, VIGILANCE).
 *  The face_landmarker model emits 478 points (468 mesh + 10 iris). */

export const FACE_MESH_COUNT = 468; // presence floor
export const FACE_IRIS_COUNT = 478; // needed for gaze (iris present)

// EAR landmark indices (6 per eye): outer, top×2, inner, bottom×2.
const LEFT_EYE_EAR = [33, 160, 158, 133, 153, 144];
const RIGHT_EYE_EAR = [362, 385, 387, 263, 373, 380];

// Iris centre + eye box for the gaze ratio.
const LEFT_GAZE = { iris: 468, inner: 133, outer: 33, top: 159, bottom: 145 };
const RIGHT_GAZE = { iris: 473, inner: 362, outer: 263, top: 386, bottom: 374 };

export function dist(a: NormalizedLandmark, b: NormalizedLandmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function facePresent(lm: NormalizedLandmark[]): boolean {
  return lm.length >= FACE_MESH_COUNT;
}

function eyeEAR(lm: NormalizedLandmark[], idx: number[]): number {
  const [p1, p2, p3, p4, p5, p6] = idx.map((i) => lm[i]);
  const h = dist(p1, p4);
  if (h === 0) return 0;
  return (dist(p2, p6) + dist(p3, p5)) / (2 * h);
}

/** Mean eye aspect ratio over both eyes. High = open, low = closed. */
export function meanEAR(lm: NormalizedLandmark[]): number {
  return (eyeEAR(lm, LEFT_EYE_EAR) + eyeEAR(lm, RIGHT_EYE_EAR)) / 2;
}

interface GazePoint {
  iris: number;
  inner: number;
  outer: number;
  top: number;
  bottom: number;
}

function eyeGaze(
  lm: NormalizedLandmark[],
  e: GazePoint
): { x: number; y: number } {
  const iris = lm[e.iris];
  const wx = lm[e.inner].x - lm[e.outer].x;
  const hy = lm[e.bottom].y - lm[e.top].y;
  const x = wx === 0 ? 0.5 : (iris.x - lm[e.outer].x) / wx;
  const y = hy === 0 ? 0.5 : (iris.y - lm[e.top].y) / hy;
  return { x, y };
}

/** Normalised gaze position (0–1 within the eye box), averaged over both eyes.
 *  Null when iris landmarks aren't present. Absolute value is meaningless — the
 *  tracker calibrates a neutral and measures deviation from it. */
export function gazeVector(
  lm: NormalizedLandmark[]
): { x: number; y: number } | null {
  if (lm.length < FACE_IRIS_COUNT) return null;
  const l = eyeGaze(lm, LEFT_GAZE);
  const r = eyeGaze(lm, RIGHT_GAZE);
  return { x: (l.x + r.x) / 2, y: (l.y + r.y) / 2 };
}
