import type { NormalizedLandmark } from '@mediapipe/tasks-vision';

/** Shared mutable store decoupling detection from rendering.
 *
 *  - `target`: latest One-Euro-filtered landmarks from the detection loop.
 *    Trackers (rep detection) read THIS — freshest filtered signal, no
 *    interpolation lag.
 *  - `display`: what the render loop draws. Lerped toward `target` every
 *    animation frame; cosmetic only, never fed to trackers.
 *  - `lastUpdateTs`: performance.now() of the last successful detection, so
 *    the render loop can fade the skeleton when tracking is lost instead of
 *    freezing a stale one.
 *
 *  Plain refs on a plain object — never React state; a detection write must
 *  not schedule a re-render. */

export interface DisplayLandmark {
  x: number;
  y: number;
  visibility: number;
}

export interface LandmarkStore {
  target: NormalizedLandmark[] | null;
  display: DisplayLandmark[] | null;
  /** unfiltered model output — drawn only in debug mode, to separate "the
   *  model is wrong" from "the filter/interpolation pipeline is wrong" */
  raw: NormalizedLandmark[] | null;
  lastUpdateTs: number;
  setTarget(
    landmarks: NormalizedLandmark[],
    raw: NormalizedLandmark[],
    tsMs: number
  ): void;
}

export function createLandmarkStore(): LandmarkStore {
  return {
    target: null,
    display: null,
    raw: null,
    lastUpdateTs: 0,
    setTarget(landmarks, raw, tsMs) {
      this.target = landmarks;
      this.raw = raw;
      this.lastUpdateTs = tsMs;
    },
  };
}
