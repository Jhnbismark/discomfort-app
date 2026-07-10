import type { NormalizedLandmark } from '@mediapipe/tasks-vision';

/** One Euro filter (Casiez, Roussel & Vogel, CHI 2012). Adaptive low-pass:
 *  heavy smoothing at low speeds (kills landmark jitter), light smoothing at
 *  high speeds (keeps fast reps responsive). Applied to the detection signal
 *  BEFORE it reaches the store or the trackers — interpolation for drawing is
 *  a separate, cosmetic-only layer (renderLoop.ts).
 *
 *  Beta note: the paper-typical 0.007 assumes pixel-scale units. Our inputs
 *  are NORMALIZED coords (speeds ~0.5 units/s), so 0.007 never lifts the
 *  cutoff and the filter degenerates to a fixed 1 Hz low-pass — a synthetic
 *  rep sweep (raw vs filtered through the real trackers) showed 1 s pushups
 *  damped ~13° at the bottom, rejecting every rep. beta 10 restored exact
 *  count parity across 15/24/30 fps and 1–3 s reps while keeping ~3× jitter
 *  reduction on a static pose. Tune UPWARD if reps still lag on a phone. */

const MIN_CUTOFF = 1.0;
const BETA = 10;
const D_CUTOFF = 1.0;

/** exponential-smoothing factor for a given cutoff frequency and timestep */
function smoothingAlpha(cutoffHz: number, dtS: number): number {
  const tau = 1 / (2 * Math.PI * cutoffHz);
  return 1 / (1 + tau / dtS);
}

export class OneEuroFilter {
  private xPrev = 0;
  private dxPrev = 0;
  private tPrevMs = -1;

  constructor(
    private minCutoff = MIN_CUTOFF,
    private beta = BETA,
    private dCutoff = D_CUTOFF
  ) {}

  reset(): void {
    this.tPrevMs = -1;
  }

  filter(x: number, tsMs: number): number {
    if (this.tPrevMs < 0 || tsMs <= this.tPrevMs) {
      // first sample (or non-monotonic timestamp): pass through, prime state
      this.xPrev = x;
      this.dxPrev = 0;
      this.tPrevMs = tsMs;
      return x;
    }
    const dtS = (tsMs - this.tPrevMs) / 1000;
    this.tPrevMs = tsMs;

    const dx = (x - this.xPrev) / dtS;
    const aD = smoothingAlpha(this.dCutoff, dtS);
    this.dxPrev = aD * dx + (1 - aD) * this.dxPrev;

    const cutoff = this.minCutoff + this.beta * Math.abs(this.dxPrev);
    const a = smoothingAlpha(cutoff, dtS);
    this.xPrev = a * x + (1 - a) * this.xPrev;
    return this.xPrev;
  }
}

/** If detection goes dark longer than this, the filters re-prime on the next
 *  sample instead of dragging the skeleton from a stale position. */
const GAP_RESET_MS = 500;

/** One filter per landmark axis (33 pose landmarks × x/y/z). Visibility is a
 *  confidence, not a position — passed through unfiltered. */
export class LandmarkFilterBank {
  private filters: OneEuroFilter[] = [];
  private lastTsMs = -1;

  constructor(
    private minCutoff = MIN_CUTOFF,
    private beta = BETA,
    private dCutoff = D_CUTOFF
  ) {}

  apply(landmarks: NormalizedLandmark[], tsMs: number): NormalizedLandmark[] {
    if (this.lastTsMs >= 0 && tsMs - this.lastTsMs > GAP_RESET_MS) this.reset();
    this.lastTsMs = tsMs;

    const needed = landmarks.length * 3;
    while (this.filters.length < needed) {
      this.filters.push(
        new OneEuroFilter(this.minCutoff, this.beta, this.dCutoff)
      );
    }
    return landmarks.map((lm, i) => ({
      ...lm,
      x: this.filters[i * 3].filter(lm.x, tsMs),
      y: this.filters[i * 3 + 1].filter(lm.y, tsMs),
      z: this.filters[i * 3 + 2].filter(lm.z, tsMs),
    }));
  }

  reset(): void {
    for (const f of this.filters) f.reset();
  }
}
