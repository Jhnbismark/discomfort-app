import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import type { ExerciseTracker, TrackerState } from './types';

/** STARE — front-on, face in frame. Face Landmarker (eye landmarks).
 *  Blink detection via eye aspect ratio (both eyes) with per-user open-eye
 *  calibration in the first second. Clock runs from start until the first
 *  detected blink, then ends the attempt: "BLINK. [time] VERIFIED."
 *  Face lost = attempt void, not a blink. Quality: n/a (time is the result). */

// FaceMesh EAR landmark indices (6 per eye): outer, top×2, inner, bottom×2.
const LEFT_EYE = [33, 160, 158, 133, 153, 144];
const RIGHT_EYE = [362, 385, 387, 263, 373, 380];

const CALIBRATION_MS = 1000; // gather the open-eye baseline
const BLINK_RATIO = 0.6; // blink when EAR drops below baseline × this
const FACE_LOST_GRACE_MS = 500; // brief tracking dropouts don't void the attempt
const DT_CAP_MS = 100;

export class StareTracker implements ExerciseTracker {
  private phase: 'calibrating' | 'staring' | 'ended' = 'calibrating';
  private firstFaceTs = -1;
  private lastTs = 0;
  private lastFaceTs = -Infinity;
  private started = false;
  private calibSamples: number[] = [];
  private baseline = 0;
  private holdMs = 0;
  private ended = false;
  private voided = false;

  reset(): void {
    this.phase = 'calibrating';
    this.firstFaceTs = -1;
    this.lastTs = 0;
    this.lastFaceTs = -Infinity;
    this.started = false;
    this.calibSamples = [];
    this.baseline = 0;
    this.holdMs = 0;
    this.ended = false;
    this.voided = false;
  }

  processFrame(
    landmarks: NormalizedLandmark[],
    timestampMs: number
  ): TrackerState {
    if (this.ended) return this.state([]);

    let dt = 0;
    if (this.started) dt = Math.min(timestampMs - this.lastTs, DT_CAP_MS);
    this.lastTs = timestampMs;
    this.started = true;

    const faceLost = landmarks.length < 468;

    if (faceLost) {
      // brief dropout tolerated; sustained loss voids the attempt (not a blink)
      if (this.phase === 'staring' && timestampMs - this.lastFaceTs > FACE_LOST_GRACE_MS) {
        this.phase = 'ended';
        this.ended = true;
        this.voided = true;
        return this.state([], 'FACE LOST');
      }
      // during calibration, a missing face just stalls calibration
      return this.state([], this.phase === 'staring' ? 'FACE LOST' : 'SHOW YOUR FACE');
    }

    this.lastFaceTs = timestampMs;
    const ear = this.meanEAR(landmarks);

    if (this.phase === 'calibrating') {
      if (this.firstFaceTs < 0) this.firstFaceTs = timestampMs;
      this.calibSamples.push(ear);
      if (timestampMs - this.firstFaceTs >= CALIBRATION_MS) {
        // baseline = mean of open-eye samples
        this.baseline =
          this.calibSamples.reduce((a, b) => a + b, 0) /
          this.calibSamples.length;
        this.phase = 'staring';
      }
      return this.state([], undefined, ear);
    }

    // staring
    this.holdMs += dt;
    if (ear < this.baseline * BLINK_RATIO) {
      this.phase = 'ended';
      this.ended = true;
      this.voided = false;
      return this.state([], undefined, ear);
    }
    return this.state([], undefined, ear);
  }

  /** EAR = (‖p2-p6‖ + ‖p3-p5‖) / (2‖p1-p4‖); averaged over both eyes. */
  private meanEAR(lm: NormalizedLandmark[]): number {
    return (this.eyeEAR(lm, LEFT_EYE) + this.eyeEAR(lm, RIGHT_EYE)) / 2;
  }

  private eyeEAR(lm: NormalizedLandmark[], idx: number[]): number {
    const [p1, p2, p3, p4, p5, p6] = idx.map((i) => lm[i]);
    const v1 = this.dist(p2, p6);
    const v2 = this.dist(p3, p5);
    const h = this.dist(p1, p4);
    if (h === 0) return 0;
    return (v1 + v2) / (2 * h);
  }

  private dist(a: NormalizedLandmark, b: NormalizedLandmark): number {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  private state(
    _unused: never[],
    fault?: string,
    ear?: number
  ): TrackerState {
    return {
      holdTimeMs: this.holdMs,
      formScore: 0, // n/a — time is the whole result
      phase: this.phase,
      faults: fault ? [fault] : [],
      ended: this.ended,
      voided: this.voided,
      debug: {
        ear: ear === undefined ? NaN : Math.round(ear * 1000),
        baseline: Math.round(this.baseline * 1000),
        blinkAt: Math.round(this.baseline * BLINK_RATIO * 1000),
        holdS: Math.round(this.holdMs / 100) / 10,
      },
    };
  }
}
