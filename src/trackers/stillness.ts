import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import type { ExerciseTracker, TrackerState } from './types';
import { vis, mapClamp } from './geometry';

/** STILLNESS — front-on, seated or standing, upper body in frame. Pose only.
 *  Signal: mean per-frame displacement of visible landmarks (normalized
 *  coords) AFTER subtracting the common-mode translation — the whole frame
 *  shifting together is camera shake (hand-held phone) or breathing, not
 *  fidgeting, so only relative movement between points counts. EMA smoothed.
 *  Valid = residual below the micro-movement threshold (breathing must pass,
 *  fidgeting must not — tune with the debug overlay). Clock runs only while
 *  valid; 600ms grace for tracking jitter. Movement -> red pause, fault
 *  "MOVEMENT — CLOCK PAUSED." Quality: inverse of mean movement during valid
 *  time. */

const STILL_THRESHOLD = 0.008; // mean residual displacement/frame; tune live
const EMA_ALPHA = 0.3;
const GRACE_MS = 600;
const DT_CAP_MS = 100;
const VIS_FLOOR = 0.5;
const MIN_POINTS = 6; // need at least this many tracked points to judge

export class StillnessTracker implements ExerciseTracker {
  private holdMs = 0;
  private lastTs = 0;
  private started = false;
  private lastValidTs = -Infinity;
  private prev: NormalizedLandmark[] | null = null;
  private ema: number | null = null;
  private dispSum = 0;
  private dispN = 0;

  reset(): void {
    this.holdMs = 0;
    this.lastTs = 0;
    this.started = false;
    this.lastValidTs = -Infinity;
    this.prev = null;
    this.ema = null;
    this.dispSum = 0;
    this.dispN = 0;
  }

  processFrame(
    landmarks: NormalizedLandmark[],
    timestampMs: number
  ): TrackerState {
    let dt = 0;
    if (this.started) dt = Math.min(timestampMs - this.lastTs, DT_CAP_MS);
    this.lastTs = timestampMs;
    this.started = true;

    const disp = this.displacement(landmarks);
    this.prev = landmarks;

    // Not enough visible points to judge -> pause, ask to get in frame.
    if (disp === null) {
      return this.state('paused', ['MOVE INTO FRAME'], NaN);
    }

    // EMA smooth the per-frame displacement
    this.ema =
      this.ema === null ? disp : EMA_ALPHA * disp + (1 - EMA_ALPHA) * this.ema;
    const smooth = this.ema;

    const still = smooth < STILL_THRESHOLD;

    let phase: string;
    let faults: string[] = [];

    if (still) {
      this.lastValidTs = timestampMs;
      this.holdMs += dt;
      this.dispSum += smooth;
      this.dispN += 1;
      phase = 'holding';
    } else if (timestampMs - this.lastValidTs <= GRACE_MS) {
      // transient tracking jitter — keep the clock running
      this.holdMs += dt;
      phase = 'holding';
    } else {
      phase = 'paused';
      faults = ['MOVEMENT — CLOCK PAUSED'];
    }

    return this.state(phase, faults, smooth);
  }

  /** Mean residual displacement of points visible in BOTH frames, after
   *  removing the mean translation (camera shake / whole-body drift moves
   *  every point identically and cancels out; a fidgeting hand does not).
   *  Null on the first frame or when too few points are trackable. */
  private displacement(cur: NormalizedLandmark[]): number | null {
    if (!this.prev) return null;
    const dx: number[] = [];
    const dy: number[] = [];
    for (let i = 0; i < cur.length; i++) {
      const a = this.prev[i];
      const b = cur[i];
      if (!a || !b) continue;
      if (vis(a) < VIS_FLOOR || vis(b) < VIS_FLOOR) continue;
      dx.push(b.x - a.x);
      dy.push(b.y - a.y);
    }
    const n = dx.length;
    if (n < MIN_POINTS) return null;
    const mx = dx.reduce((a, b) => a + b, 0) / n;
    const my = dy.reduce((a, b) => a + b, 0) / n;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      sum += Math.hypot(dx[i] - mx, dy[i] - my);
    }
    return sum / n;
  }

  private quality(): number {
    if (this.dispN === 0) return 0;
    const mean = this.dispSum / this.dispN;
    // perfectly still = 100, at-threshold movement = 0
    return Math.round(mapClamp(mean, 0, STILL_THRESHOLD, 100, 0));
  }

  private state(
    phase: string,
    faults: string[],
    smoothDisp: number
  ): TrackerState {
    return {
      holdTimeMs: this.holdMs,
      formScore: this.quality(),
      phase,
      faults,
      debug: {
        disp: Number.isNaN(smoothDisp) ? NaN : Math.round(smoothDisp * 10000),
        thresh: Math.round(STILL_THRESHOLD * 10000),
        holdS: Math.round(this.holdMs / 100) / 10,
      },
    };
  }
}
