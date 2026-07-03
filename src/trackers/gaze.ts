import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import type { ExerciseTracker, TrackerState } from './types';
import { mapClamp } from './geometry';
import { meanEAR, gazeVector, facePresent } from '../pose/faceMath';

/** GAZE — front-on, face filling the upper frame; a dot is rendered on screen.
 *  Iris landmarks -> gaze estimate. Calibrate 2s at start ("LOOK AT THE DOT")
 *  to set the user's neutral gaze vector. Valid = gaze within the tolerance cone
 *  of the target AND eyes open AND face detected. Look away / eyes closed / head
 *  drop -> pause with "EYES OFF TARGET" / "EYES CLOSED" / "FACE LOST".
 *  Quality: mean gaze deviation during valid time, inverted to 0-100. */

const CALIBRATION_MS = 2000;
const TOLERANCE = 0.16; // gaze deviation cone (normalized eye-box units)
const EYES_OPEN_EAR = 0.15; // EAR above this = eyes open
const GRACE_MS = 300;
const DT_CAP_MS = 100;

export class GazeTracker implements ExerciseTracker {
  private phase: 'calibrating' | 'holding' | 'paused' = 'calibrating';
  private firstFaceTs = -1;
  private lastTs = 0;
  private started = false;
  private lastValidTs = -Infinity;
  private calib: { x: number; y: number }[] = [];
  private neutral = { x: 0.5, y: 0.5 };
  private holdMs = 0;
  private devSum = 0;
  private devN = 0;

  reset(): void {
    this.phase = 'calibrating';
    this.firstFaceTs = -1;
    this.lastTs = 0;
    this.started = false;
    this.lastValidTs = -Infinity;
    this.calib = [];
    this.neutral = { x: 0.5, y: 0.5 };
    this.holdMs = 0;
    this.devSum = 0;
    this.devN = 0;
  }

  processFrame(
    landmarks: NormalizedLandmark[],
    timestampMs: number
  ): TrackerState {
    let dt = 0;
    if (this.started) dt = Math.min(timestampMs - this.lastTs, DT_CAP_MS);
    this.lastTs = timestampMs;
    this.started = true;

    const gaze = facePresent(landmarks) ? gazeVector(landmarks) : null;

    // no face / no iris -> can't judge
    if (!gaze) {
      return this.faultOrGrace(timestampMs, 'FACE LOST', NaN, NaN);
    }

    const ear = meanEAR(landmarks);

    // calibration: average the neutral gaze while the user looks at the dot
    if (this.phase === 'calibrating') {
      if (this.firstFaceTs < 0) this.firstFaceTs = timestampMs;
      this.calib.push(gaze);
      if (timestampMs - this.firstFaceTs >= CALIBRATION_MS) {
        const n = this.calib.length;
        this.neutral = {
          x: this.calib.reduce((a, b) => a + b.x, 0) / n,
          y: this.calib.reduce((a, b) => a + b.y, 0) / n,
        };
        this.phase = 'holding';
        this.lastValidTs = timestampMs;
      }
      return this.state('calibrating', [], NaN, ear);
    }

    const dev = Math.hypot(gaze.x - this.neutral.x, gaze.y - this.neutral.y);
    const eyesOpen = ear > EYES_OPEN_EAR;
    const onTarget = dev < TOLERANCE;

    if (eyesOpen && onTarget) {
      this.lastValidTs = timestampMs;
      this.holdMs += dt;
      this.devSum += dev;
      this.devN += 1;
      return this.state('holding', [], dev, ear);
    }

    const fault = !eyesOpen ? 'EYES CLOSED' : 'EYES OFF TARGET';
    return this.faultOrGrace(timestampMs, fault, dev, ear);
  }

  /** Within the jitter grace window, hold the clock steady and don't flash a
   *  fault; past it, pause with the reason. (The tiny paused time during grace
   *  is deliberately not credited — only clearly-valid frames add to the hold.) */
  private faultOrGrace(
    ts: number,
    fault: string,
    dev: number,
    ear: number
  ): TrackerState {
    if (this.phase !== 'calibrating' && ts - this.lastValidTs <= GRACE_MS) {
      return this.state('holding', [], dev, ear);
    }
    return this.state('paused', [fault], dev, ear);
  }

  private quality(): number {
    if (this.devN === 0) return 0;
    const meanDev = this.devSum / this.devN;
    return Math.round(mapClamp(meanDev, 0, TOLERANCE, 100, 0));
  }

  private state(
    phase: 'calibrating' | 'holding' | 'paused',
    faults: string[],
    dev: number,
    ear: number
  ): TrackerState {
    this.phase = phase;
    return {
      holdTimeMs: this.holdMs,
      formScore: this.quality(),
      phase,
      faults,
      debug: {
        dev: Number.isNaN(dev) ? NaN : Math.round(dev * 1000),
        tol: Math.round(TOLERANCE * 1000),
        ear: Number.isNaN(ear) ? NaN : Math.round(ear * 1000),
        holdS: Math.round(this.holdMs / 100) / 10,
      },
    };
  }
}
