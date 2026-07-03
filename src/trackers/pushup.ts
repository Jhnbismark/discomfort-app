import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import type { ExerciseTracker, TrackerState, TrackerEvent } from './types';
import { angleABC, vis, mapClamp } from './geometry';
import { LM } from '../pose/landmarks';

/** Push-ups — side-on camera.
 *  Elbow angle = angle(shoulder, elbow, wrist), side with higher visibility.
 *  UP (>160°) -> DOWN (<90°) -> UP = 1 rep, counted at return to UP. 5° hyst.
 *  HARD RULE: a rep that doesn't reach <100° is NOT counted at all (not a
 *  reduced score) — fault flash "SHALLOW — NOT COUNTED". */

const UP_ANGLE = 160; // top of a rep
const VALID_DEPTH = 100; // must break below this to count
const ATTEMPT_ENTER = 130; // below this = user is descending into an attempt
const VIS_FLOOR = 0.6; // per-joint visibility floor -> else "MOVE INTO FRAME"

interface BottomSample {
  minElbow: number; // deepest elbow angle reached this attempt
  bodyLine: number; // shoulder-hip-ankle angle at the bottom
  symmetryDelta: number | null; // |L-R elbow| at bottom when both visible
}

export class PushupTracker implements ExerciseTracker {
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

    // Pick the more-visible side for the elbow angle.
    const left = this.sideAngle(landmarks, 'L');
    const right = this.sideAngle(landmarks, 'R');
    const best = (left?.v ?? -1) >= (right?.v ?? -1) ? left : right;

    if (!best) {
      // Can't see an arm well enough to judge anything.
      return this.state('invalid', ['MOVE INTO FRAME'], events, {});
    }

    const elbow = best.angle;

    // ── rep state machine ──────────────────────────────────────────────
    if (!this.attempting && elbow < ATTEMPT_ENTER) {
      // begin an attempt
      this.attempting = true;
      this.attemptStartMs = timestampMs;
      this.bottom = {
        minElbow: elbow,
        bodyLine: this.bodyLine(landmarks, best.side),
        symmetryDelta: this.symmetry(left, right),
      };
    }

    if (this.attempting && this.bottom) {
      // track the deepest point of the descent
      if (elbow < this.bottom.minElbow) {
        this.bottom.minElbow = elbow;
        this.bottom.bodyLine = this.bodyLine(landmarks, best.side);
        this.bottom.symmetryDelta = this.symmetry(left, right);
      }

      // returned to the top (>160°) -> resolve. The 30° gap between UP_ANGLE
      // and ATTEMPT_ENTER is the hysteresis band that prevents re-trigger jitter.
      if (elbow >= UP_ANGLE) {
        const durationMs = timestampMs - this.attemptStartMs;
        if (this.bottom.minElbow < VALID_DEPTH) {
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

    // phase for the overlay
    this.phase = this.attempting ? 'down' : 'up';

    const faults: string[] = [];
    const rejected = events.find((e) => e.type === 'rep-rejected');
    if (rejected && rejected.type === 'rep-rejected') faults.push(rejected.reason);

    return this.state(this.phase, faults, events, {
      elbow: Math.round(elbow),
      minElbow: this.bottom ? Math.round(this.bottom.minElbow) : NaN,
      side: best.side === 'L' ? 0 : 1,
    });
  }

  // ── helpers ──────────────────────────────────────────────────────────

  private sideAngle(
    landmarks: NormalizedLandmark[],
    side: 'L' | 'R'
  ): { side: 'L' | 'R'; angle: number; v: number } | null {
    const [s, e, w] =
      side === 'L'
        ? [LM.LEFT_SHOULDER, LM.LEFT_ELBOW, LM.LEFT_WRIST]
        : [LM.RIGHT_SHOULDER, LM.RIGHT_ELBOW, LM.RIGHT_WRIST];
    const shoulder = landmarks[s];
    const elbow = landmarks[e];
    const wrist = landmarks[w];
    const v = Math.min(vis(shoulder), vis(elbow), vis(wrist));
    if (v < VIS_FLOOR) return null;
    return { side, angle: angleABC(shoulder, elbow, wrist), v };
  }

  /** shoulder-hip-ankle angle on the chosen side; 180° = a straight body line. */
  private bodyLine(landmarks: NormalizedLandmark[], side: 'L' | 'R'): number {
    const [s, h, a] =
      side === 'L'
        ? [LM.LEFT_SHOULDER, LM.LEFT_HIP, LM.LEFT_ANKLE]
        : [LM.RIGHT_SHOULDER, LM.RIGHT_HIP, LM.RIGHT_ANKLE];
    return angleABC(landmarks[s], landmarks[h], landmarks[a]);
  }

  private symmetry(
    left: { angle: number } | null,
    right: { angle: number } | null
  ): number | null {
    if (!left || !right) return null;
    return Math.abs(left.angle - right.angle);
  }

  /** Rep quality 0-100: depth 35% (90°->100, 100°->0), body line 35%
   *  (180° ideal), symmetry 15% (L/R elbow delta when both visible),
   *  tempo 15% (1–4s full marks). */
  private repScore(b: BottomSample, durationMs: number): number {
    const depth = mapClamp(b.minElbow, 100, 90, 0, 100);

    const lineDev = Math.abs(180 - b.bodyLine);
    const line = mapClamp(lineDev, 0, 40, 100, 0);

    // symmetry: 0° delta = 100, >=30° = 0. When one arm is hidden, don't
    // penalize — redistribute its weight proportionally into the other terms.
    let symmetry: number | null =
      b.symmetryDelta === null ? null : mapClamp(b.symmetryDelta, 0, 30, 100, 0);

    const s = durationMs / 1000;
    const tempo = s >= 1 && s <= 4 ? 100 : s < 1 ? mapClamp(s, 0, 1, 0, 100) : mapClamp(s, 4, 8, 100, 0);

    if (symmetry === null) {
      // weights: depth .35, line .35, tempo .15 -> renormalize to sum 1
      const w = 0.35 + 0.35 + 0.15;
      return Math.round((depth * 0.35 + line * 0.35 + tempo * 0.15) / w);
    }
    return Math.round(
      depth * 0.35 + line * 0.35 + symmetry * 0.15 + tempo * 0.15
    );
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
