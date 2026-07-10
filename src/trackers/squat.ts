import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import type { ExerciseTracker, TrackerState, TrackerEvent } from './types';
import { angleABC, vis, mapClamp } from './geometry';
import { LM } from '../pose/landmarks';

/** Squats — side-on camera, standing.
 *  Knee angle = angle(hip, knee, ankle), side with higher visibility.
 *  UP (>162°) -> DOWN -> UP = 1 rep, counted at return to UP.
 *  HARD RULE: a rep that doesn't break below 107° at the knee (thigh near
 *  parallel) is NOT counted at all — fault flash "SHALLOW — NOT COUNTED". */

// Landmarks arrive One-Euro filtered (tracking/oneEuro.ts), which damps peak
// angles at rep extremes by ~1-2° worst case; UP_ANGLE/VALID_DEPTH carry that
// margin so filtered counts match unfiltered ones.
const UP_ANGLE = 162; // standing tall
const VALID_DEPTH = 107; // must break below this to count
const ATTEMPT_ENTER = 140; // below this = user is descending into an attempt
const VIS_FLOOR = 0.5; // per-joint visibility floor -> else "MOVE INTO FRAME"

interface BottomSample {
  minKnee: number; // deepest knee angle reached this attempt
  symmetryDelta: number | null; // |L-R knee| at bottom when both visible
}

export class SquatTracker implements ExerciseTracker {
  private count = 0;
  private phase: 'up' | 'down' = 'up';
  private attempting = false;
  private attemptStartMs = 0;
  private bottom: BottomSample | null = null;
  private scoreSum = 0;
  private scoreN = 0;
  private lastRepScore: number | undefined;

  reset(): void {
    this.count = 0;
    this.phase = 'up';
    this.attempting = false;
    this.attemptStartMs = 0;
    this.bottom = null;
    this.scoreSum = 0;
    this.scoreN = 0;
    this.lastRepScore = undefined;
  }

  processFrame(
    landmarks: NormalizedLandmark[],
    timestampMs: number
  ): TrackerState {
    const events: TrackerEvent[] = [];

    const left = this.sideAngle(landmarks, 'L');
    const right = this.sideAngle(landmarks, 'R');
    const best = (left?.v ?? -1) >= (right?.v ?? -1) ? left : right;

    if (!best) {
      return this.state('invalid', ['MOVE INTO FRAME'], events, {});
    }

    const knee = best.angle;

    // ── rep state machine ──────────────────────────────────────────────
    if (!this.attempting && knee < ATTEMPT_ENTER) {
      this.attempting = true;
      this.attemptStartMs = timestampMs;
      this.bottom = {
        minKnee: knee,
        symmetryDelta: this.symmetry(left, right),
      };
    }

    if (this.attempting && this.bottom) {
      if (knee < this.bottom.minKnee) {
        this.bottom.minKnee = knee;
        this.bottom.symmetryDelta = this.symmetry(left, right);
      }

      // back to standing (>165°) -> resolve. The 25° gap between UP_ANGLE
      // and ATTEMPT_ENTER is the hysteresis band that prevents re-trigger jitter.
      if (knee >= UP_ANGLE) {
        const durationMs = timestampMs - this.attemptStartMs;
        if (this.bottom.minKnee < VALID_DEPTH) {
          const score = this.repScore(this.bottom, durationMs);
          this.count += 1;
          this.scoreSum += score;
          this.scoreN += 1;
          this.lastRepScore = score;
          events.push({ type: 'rep-counted', score });
        } else {
          // HARD RULE: shallow attempts are not counted at all.
          events.push({
            type: 'rep-rejected',
            reason: 'SHALLOW — NOT COUNTED',
          });
        }
        this.attempting = false;
        this.bottom = null;
      }
    }

    this.phase = this.attempting ? 'down' : 'up';

    const faults: string[] = [];
    const rejected = events.find((e) => e.type === 'rep-rejected');
    if (rejected && rejected.type === 'rep-rejected') faults.push(rejected.reason);

    return this.state(this.phase, faults, events, {
      knee: Math.round(knee),
      minKnee: this.bottom ? Math.round(this.bottom.minKnee) : NaN,
      side: best.side === 'L' ? 0 : 1,
    });
  }

  // ── helpers ──────────────────────────────────────────────────────────

  private sideAngle(
    landmarks: NormalizedLandmark[],
    side: 'L' | 'R'
  ): { side: 'L' | 'R'; angle: number; v: number } | null {
    const [h, k, a] =
      side === 'L'
        ? [LM.LEFT_HIP, LM.LEFT_KNEE, LM.LEFT_ANKLE]
        : [LM.RIGHT_HIP, LM.RIGHT_KNEE, LM.RIGHT_ANKLE];
    const hip = landmarks[h];
    const knee = landmarks[k];
    const ankle = landmarks[a];
    const v = Math.min(vis(hip), vis(knee), vis(ankle));
    if (v < VIS_FLOOR) return null;
    return { side, angle: angleABC(hip, knee, ankle), v };
  }

  private symmetry(
    left: { angle: number } | null,
    right: { angle: number } | null
  ): number | null {
    if (!left || !right) return null;
    return Math.abs(left.angle - right.angle);
  }

  /** Rep quality 0-100: depth 45% (105°->0, 90°->100), symmetry 25%
   *  (L/R knee delta when both visible), tempo 30% (1–4s full marks). */
  private repScore(b: BottomSample, durationMs: number): number {
    const depth = mapClamp(b.minKnee, VALID_DEPTH, 90, 0, 100);

    let symmetry: number | null =
      b.symmetryDelta === null ? null : mapClamp(b.symmetryDelta, 0, 30, 100, 0);

    const s = durationMs / 1000;
    const tempo =
      s >= 1 && s <= 4 ? 100 : s < 1 ? mapClamp(s, 0, 1, 0, 100) : mapClamp(s, 4, 8, 100, 0);

    if (symmetry === null) {
      // weights: depth .45, tempo .30 -> renormalize to sum 1
      const w = 0.45 + 0.3;
      return Math.round((depth * 0.45 + tempo * 0.3) / w);
    }
    return Math.round(depth * 0.45 + symmetry * 0.25 + tempo * 0.3);
  }

  private state(
    phase: string,
    faults: string[],
    events: TrackerEvent[],
    debug: Record<string, number>
  ): TrackerState {
    return {
      count: this.count,
      formScore: this.scoreN ? Math.round(this.scoreSum / this.scoreN) : 0,
      lastRepScore: this.lastRepScore,
      phase,
      faults,
      events,
      debug,
    };
  }
}
