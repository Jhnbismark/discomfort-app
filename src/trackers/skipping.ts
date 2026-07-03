import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import type { ExerciseTracker, TrackerState, TrackerEvent } from './types';
import { vis, mapClamp } from './geometry';
import { LM } from '../pose/landmarks';

/** Skipping — front-on camera, full body.
 *  Signal: mean ankle Y (fallback hip Y), EMA smoothed (alpha 0.3).
 *  Jump = local max of upward displacement where it clears
 *  max(0.5 × rolling stddev, absolute floor). 200ms refractory after a count.
 *  Quality: rhythm 60% (CV of inter-jump intervals, last 10), height
 *  consistency 40%. */

const EMA_ALPHA = 0.3;
const REFRACTORY_MS = 200;
const FLOOR = 0.018; // absolute displacement floor (normalized units)
const WINDOW = 30; // rolling window for baseline + stddev
const VIS_FLOOR = 0.5;
const RECENT = 10; // intervals/heights kept for quality

export class SkippingTracker implements ExerciseTracker {
  private count = 0;
  private ema: number | null = null;
  private buffer: number[] = []; // recent smoothed signal, for baseline + std
  private prevHeight = 0;
  private rising = false;
  private peakHeight = 0;
  private lastJumpTs = -Infinity;
  private lastJumpForInterval = -Infinity;
  private intervals: number[] = [];
  private heights: number[] = [];

  reset(): void {
    this.count = 0;
    this.ema = null;
    this.buffer = [];
    this.prevHeight = 0;
    this.rising = false;
    this.peakHeight = 0;
    this.lastJumpTs = -Infinity;
    this.lastJumpForInterval = -Infinity;
    this.intervals = [];
    this.heights = [];
  }

  processFrame(
    landmarks: NormalizedLandmark[],
    timestampMs: number
  ): TrackerState {
    const events: TrackerEvent[] = [];
    const signal = this.readSignal(landmarks);

    if (signal === null) {
      return {
        count: this.count,
        formScore: this.quality(),
        phase: 'invalid',
        faults: ['MOVE INTO FRAME'],
        debug: { count: this.count },
      };
    }

    // EMA smooth
    this.ema = this.ema === null ? signal : EMA_ALPHA * signal + (1 - EMA_ALPHA) * this.ema;
    const y = this.ema;

    // rolling baseline + stddev over the window
    this.buffer.push(y);
    if (this.buffer.length > WINDOW) this.buffer.shift();
    const mean = this.buffer.reduce((a, b) => a + b, 0) / this.buffer.length;
    const variance =
      this.buffer.reduce((a, b) => a + (b - mean) * (b - mean), 0) /
      this.buffer.length;
    const std = Math.sqrt(variance);

    // height = how far the body has risen above baseline (Y grows downward,
    // so rising up = smaller Y = larger (mean - y))
    const height = mean - y;
    const threshold = Math.max(0.5 * std, FLOOR);

    // peak detection: count on the frame the rise turns over into a fall
    if (height > this.prevHeight) {
      this.rising = true;
      this.peakHeight = Math.max(this.peakHeight, height);
    } else if (height < this.prevHeight && this.rising) {
      // just passed a local max at prevHeight/peakHeight
      if (
        this.peakHeight > threshold &&
        timestampMs - this.lastJumpTs > REFRACTORY_MS
      ) {
        this.count += 1;
        this.lastJumpTs = timestampMs;
        this.heights.push(this.peakHeight);
        if (this.heights.length > RECENT) this.heights.shift();
        if (this.lastJumpForInterval > -Infinity) {
          this.intervals.push(timestampMs - this.lastJumpForInterval);
          if (this.intervals.length > RECENT) this.intervals.shift();
        }
        this.lastJumpForInterval = timestampMs;
        events.push({ type: 'rep-counted', score: this.quality() });
      }
      this.rising = false;
      this.peakHeight = 0;
    }
    this.prevHeight = height;

    return {
      count: this.count,
      formScore: this.quality(),
      phase: height > threshold ? 'airborne' : 'ground',
      faults: [],
      events,
      debug: {
        count: this.count,
        height: Math.round(height * 1000),
        thresh: Math.round(threshold * 1000),
        std: Math.round(std * 1000),
      },
    };
  }

  /** mean ankle Y (needs both ankles visible), else fallback to mean hip Y. */
  private readSignal(landmarks: NormalizedLandmark[]): number | null {
    const la = landmarks[LM.LEFT_ANKLE];
    const ra = landmarks[LM.RIGHT_ANKLE];
    if (vis(la) >= VIS_FLOOR && vis(ra) >= VIS_FLOOR) {
      return (la.y + ra.y) / 2;
    }
    const lh = landmarks[LM.LEFT_HIP];
    const rh = landmarks[LM.RIGHT_HIP];
    if (vis(lh) >= VIS_FLOOR && vis(rh) >= VIS_FLOOR) {
      return (lh.y + rh.y) / 2;
    }
    return null;
  }

  /** rhythm 60% (CV of inter-jump intervals) + height consistency 40%
   *  (CV of peak heights). Lower CV -> higher score. */
  private quality(): number {
    const rhythm = this.intervals.length >= 3 ? this.cvScore(this.intervals) : 0;
    const height = this.heights.length >= 3 ? this.cvScore(this.heights) : 0;
    if (this.intervals.length < 3) return 0;
    return Math.round(rhythm * 0.6 + height * 0.4);
  }

  /** coefficient of variation mapped to 0-100 (CV 0 -> 100, CV 0.5 -> 0). */
  private cvScore(xs: number[]): number {
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    if (mean === 0) return 0;
    const variance =
      xs.reduce((a, b) => a + (b - mean) * (b - mean), 0) / xs.length;
    const cv = Math.sqrt(variance) / mean;
    return mapClamp(cv, 0, 0.5, 100, 0);
  }
}
