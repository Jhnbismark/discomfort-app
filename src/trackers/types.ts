import type { NormalizedLandmark } from '@mediapipe/tasks-vision';

/** A tracker is pure: (landmarks, timestamp) in -> state out. No tracker
 *  imports another. Unit-test state machines with synthetic landmark sequences. */
export interface ExerciseTracker {
  processFrame(
    landmarks: NormalizedLandmark[],
    timestampMs: number
  ): TrackerState;
  reset(): void;
}

export interface TrackerState {
  count?: number; // pushups, skipping
  holdTimeMs?: number; // plank
  formScore: number; // 0-100 running session average
  lastRepScore?: number;
  phase: string; // 'up'|'down'|'airborne'|'holding'|'invalid'
  faults: string[]; // 'HIPS SAGGING', 'SHALLOW — NOT COUNTED', 'MOVE INTO FRAME'
  /** transient, one-frame events the UI/audio consume then discard */
  events?: TrackerEvent[];
  /** debug telemetry surfaced by the angle overlay toggle */
  debug?: Record<string, number>;
}

export type TrackerEvent =
  | { type: 'rep-counted'; score: number }
  | { type: 'rep-rejected'; reason: string };
