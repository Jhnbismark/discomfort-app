import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import type { ExerciseTracker, TrackerState } from './types';
import { angleABC, vis, mapClamp } from './geometry';
import { LM } from '../pose/landmarks';

/** Plank — side-on camera. THE CLOCK ONLY RUNS WHEN YOU'RE PLANKING.
 *  Valid = shoulder-hip-ankle angle 165°–185° AND visibility > 0.6 on
 *  shoulder/hip/ankle. Timer accumulates only while valid; 500ms grace for
 *  transient jitter, then pause. Paused -> red timer + full-width fault reason
 *  ("HIPS SAGGING" / "HIPS TOO HIGH" / "MOVE INTO FRAME"), resumes green when
 *  fixed. Quality: 100 − scaled mean |deviation from 180°| (0°=100, ≥15°=0). */

const ANGLE_MIN = 165; // below this the body line is broken
const VIS_FLOOR = 0.6;
const GRACE_MS = 500; // transient jitter tolerated before the clock pauses
const DT_CAP_MS = 100; // clamp per-frame dt so a tab-away can't inflate the hold
const DEV_ZERO = 15; // deviation (deg) at which quality hits 0

interface Eval {
  valid: boolean;
  fault: string | null;
  dev: number; // |180 - bodyLine| in degrees
}

export class PlankTracker implements ExerciseTracker {
  private holdMs = 0;
  private lastTs = 0;
  private started = false;
  private lastValidTs = -Infinity;
  private devSum = 0;
  private devN = 0;

  reset(): void {
    this.holdMs = 0;
    this.lastTs = 0;
    this.started = false;
    this.lastValidTs = -Infinity;
    this.devSum = 0;
    this.devN = 0;
  }

  processFrame(
    landmarks: NormalizedLandmark[],
    timestampMs: number
  ): TrackerState {
    // dt since last frame, clamped. First frame contributes no time.
    let dt = 0;
    if (this.started) dt = Math.min(timestampMs - this.lastTs, DT_CAP_MS);
    this.lastTs = timestampMs;
    this.started = true;

    const e = this.evaluate(landmarks);

    let phase: string;
    let faults: string[] = [];

    if (e.valid) {
      this.lastValidTs = timestampMs;
      this.holdMs += dt;
      this.devSum += e.dev;
      this.devN += 1;
      phase = 'holding';
    } else if (timestampMs - this.lastValidTs <= GRACE_MS) {
      // transient jitter — keep the clock running, don't flash a fault yet
      this.holdMs += dt;
      phase = 'holding';
    } else {
      // pause the clock, surface the reason
      phase = 'paused';
      faults = e.fault ? [e.fault] : ['MOVE INTO FRAME'];
    }

    return {
      holdTimeMs: this.holdMs,
      formScore: this.quality(),
      phase,
      faults,
      debug: {
        bodyLine: Math.round(180 - e.dev),
        dev: Math.round(e.dev),
        holdS: Math.round(this.holdMs / 100) / 10,
      },
    };
  }

  private evaluate(landmarks: NormalizedLandmark[]): Eval {
    // pick the more-visible side for the body line
    const l = this.sideVisibility(landmarks, 'L');
    const r = this.sideVisibility(landmarks, 'R');
    const side = r > l ? 'R' : 'L';
    const bestVis = Math.max(l, r);

    if (bestVis < VIS_FLOOR) {
      return { valid: false, fault: 'MOVE INTO FRAME', dev: 90 };
    }

    const [s, h, a] =
      side === 'L'
        ? [LM.LEFT_SHOULDER, LM.LEFT_HIP, LM.LEFT_ANKLE]
        : [LM.RIGHT_SHOULDER, LM.RIGHT_HIP, LM.RIGHT_ANKLE];
    const shoulder = landmarks[s];
    const hip = landmarks[h];
    const ankle = landmarks[a];

    const bodyLine = angleABC(shoulder, hip, ankle);
    const dev = Math.abs(180 - bodyLine);

    if (bodyLine >= ANGLE_MIN) {
      return { valid: true, fault: null, dev };
    }

    // broken line — sag vs pike by where the hip sits relative to the
    // shoulder-ankle midline. Y grows downward, so a lower hip (bigger Y) sags.
    const midY = (shoulder.y + ankle.y) / 2;
    const fault = hip.y > midY ? 'HIPS SAGGING' : 'HIPS TOO HIGH';
    return { valid: false, fault, dev };
  }

  private sideVisibility(
    landmarks: NormalizedLandmark[],
    side: 'L' | 'R'
  ): number {
    const [s, h, a] =
      side === 'L'
        ? [LM.LEFT_SHOULDER, LM.LEFT_HIP, LM.LEFT_ANKLE]
        : [LM.RIGHT_SHOULDER, LM.RIGHT_HIP, LM.RIGHT_ANKLE];
    return Math.min(vis(landmarks[s]), vis(landmarks[h]), vis(landmarks[a]));
  }

  private quality(): number {
    if (this.devN === 0) return 0;
    const meanDev = this.devSum / this.devN;
    return Math.round(mapClamp(meanDev, 0, DEV_ZERO, 100, 0));
  }
}
