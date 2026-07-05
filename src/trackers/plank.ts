import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import type { ExerciseTracker, TrackerState } from './types';
import { angleABC, vis, mapClamp } from './geometry';
import { LM } from '../pose/landmarks';

/** Plank — side-on camera. THE CLOCK ONLY RUNS WHEN YOU'RE PLANKING.
 *  Body line = shoulder-hip-ankle angle; when the ankle isn't visible enough
 *  (MediaPipe's weakest landmark, especially on toes near the floor) the knee
 *  stands in — legs are straight in a plank, so the line reads the same.
 *  Frame presence is judged on shoulder+hip only. Timer accumulates only while
 *  valid; 500ms grace for transient jitter, then pause. Paused -> red timer +
 *  full-width fault reason ("HIPS SAGGING" / "HIPS TOO HIGH" / "MOVE INTO
 *  FRAME"), resumes green when fixed.
 *  Quality: 100 − scaled mean |deviation from 180°| (0°=100, ≥15°=0). */

const ANGLE_MIN = 163; // below this the body line is broken (small allowance for forearm-plank pike)
const VIS_FLOOR = 0.5; // shoulder + hip must clear this
const LOWER_VIS_FLOOR = 0.35; // ankle (or knee fallback) must clear this
const GRACE_MS = 400; // transient jitter tolerated before the clock pauses
const DT_CAP_MS = 100; // clamp per-frame dt so a tab-away can't inflate the hold
const DEV_ZERO = 15; // deviation (deg) at which quality hits 0

interface Eval {
  valid: boolean;
  fault: string | null;
  dev: number; // |180 - bodyLine| in degrees
  visSH: number; // min(shoulder, hip) visibility on the chosen side
  visLower: number; // visibility of the lower point actually used
  usedKnee: boolean; // true when the knee stood in for the ankle
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
        visSH: Math.round(e.visSH * 100) / 100,
        visLow: Math.round(e.visLower * 100) / 100,
        knee: e.usedKnee ? 1 : 0,
      },
    };
  }

  private evaluate(landmarks: NormalizedLandmark[]): Eval {
    // pick the side whose shoulder+hip read best; the lower point is chosen after
    const l = this.sideVisibility(landmarks, 'L');
    const r = this.sideVisibility(landmarks, 'R');
    const side = r > l ? 'R' : 'L';
    const visSH = Math.max(l, r);

    if (visSH < VIS_FLOOR) {
      return { valid: false, fault: 'MOVE INTO FRAME', dev: 90, visSH, visLower: 0, usedKnee: false };
    }

    const [s, h, k, a] =
      side === 'L'
        ? [LM.LEFT_SHOULDER, LM.LEFT_HIP, LM.LEFT_KNEE, LM.LEFT_ANKLE]
        : [LM.RIGHT_SHOULDER, LM.RIGHT_HIP, LM.RIGHT_KNEE, LM.RIGHT_ANKLE];
    const shoulder = landmarks[s];
    const hip = landmarks[h];

    // ankle preferred; knee stands in when the ankle reads poorly
    const ankle = landmarks[a];
    const knee = landmarks[k];
    let lower = ankle;
    let visLower = vis(ankle);
    let usedKnee = false;
    if (visLower < LOWER_VIS_FLOOR && vis(knee) > visLower) {
      lower = knee;
      visLower = vis(knee);
      usedKnee = true;
    }
    if (visLower < LOWER_VIS_FLOOR) {
      return { valid: false, fault: 'MOVE INTO FRAME', dev: 90, visSH, visLower, usedKnee };
    }

    const bodyLine = angleABC(shoulder, hip, lower);
    const dev = Math.abs(180 - bodyLine);

    if (bodyLine >= ANGLE_MIN) {
      return { valid: true, fault: null, dev, visSH, visLower, usedKnee };
    }

    // broken line — sag vs pike by where the hip sits relative to the
    // shoulder-lower midline. Y grows downward, so a lower hip (bigger Y) sags.
    const midY = (shoulder.y + lower.y) / 2;
    const fault = hip.y > midY ? 'HIPS SAGGING' : 'HIPS TOO HIGH';
    return { valid: false, fault, dev, visSH, visLower, usedKnee };
  }

  private sideVisibility(
    landmarks: NormalizedLandmark[],
    side: 'L' | 'R'
  ): number {
    const [s, h] =
      side === 'L'
        ? [LM.LEFT_SHOULDER, LM.LEFT_HIP]
        : [LM.RIGHT_SHOULDER, LM.RIGHT_HIP];
    return Math.min(vis(landmarks[s]), vis(landmarks[h]));
  }

  private quality(): number {
    if (this.devN === 0) return 0;
    const meanDev = this.devSum / this.devN;
    return Math.round(mapClamp(meanDev, 0, DEV_ZERO, 100, 0));
  }
}
