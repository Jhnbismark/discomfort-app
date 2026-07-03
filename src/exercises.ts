import type { ExerciseTracker } from './trackers/types';
import { PushupTracker } from './trackers/pushup';
import { PlankTracker } from './trackers/plank';
import { SkippingTracker } from './trackers/skipping';
import { StillnessTracker } from './trackers/stillness';
import { StareTracker } from './trackers/stare';

export type ExerciseId =
  | 'pushup'
  | 'plank'
  | 'skipping'
  | 'stillness'
  | 'stare';

/** How the giant readout renders and what the metric means. */
export type Metric = 'count' | 'clock';

/** FAR: phone 2–3m away, untouchable, giant readout, audio-primary. NEAR: phone
 *  at arm's length, calm, dim clock only, no visible buttons, hold-to-end. */
export type Mode = 'far' | 'near';

/** Which MediaPipe model this test needs. Only the selected one is loaded. */
export type Landmarker = 'pose' | 'face';

export interface PlacementStep {
  n: string;
  text: string;
}

export interface ExerciseConfig {
  id: ExerciseId;
  title: string;
  mode: Mode;
  landmarker: Landmarker;
  metric: Metric;
  /** unit label under the giant readout ("VERIFIED", "HOLD", "JUMPS") */
  readoutLabel: string;
  makeTracker: () => ExerciseTracker;
  placement: PlacementStep[];
  /** optional on-brand hard-rule warning shown on the pre-session screen */
  hardRule?: string;
}

const SIDE_ON: PlacementStep[] = [
  { n: '01', text: 'CAMERA SIDE-ON TO YOUR BODY.' },
  { n: '02', text: 'PHONE 2–3 METRES AWAY, ON THE FLOOR.' },
  { n: '03', text: 'FULL BODY IN FRAME: HANDS TO FEET.' },
  { n: '04', text: 'AUDIO IS PRIMARY. TURN UP THE VOLUME.' },
];

const FRONT_ON: PlacementStep[] = [
  { n: '01', text: 'CAMERA FRONT-ON, FACING YOU.' },
  { n: '02', text: 'PHONE 2–3 METRES AWAY, PROPPED UP.' },
  { n: '03', text: 'WHOLE BODY IN FRAME: HEAD TO FEET.' },
  { n: '04', text: 'AUDIO IS PRIMARY. TURN UP THE VOLUME.' },
];

const NEAR_UPPER: PlacementStep[] = [
  { n: '01', text: "PHONE AT ARM'S LENGTH, PROPPED OR HELD." },
  { n: '02', text: 'FRONT-ON. HEAD AND SHOULDERS IN FRAME.' },
  { n: '03', text: 'SIT OR STAND. GET SETTLED FIRST.' },
  { n: '04', text: 'CLOSE YOUR EYES IF YOU LIKE — AUDIO GUIDES YOU.' },
];

const NEAR_FACE: PlacementStep[] = [
  { n: '01', text: "PHONE AT ARM'S LENGTH, FACE FILLING THE FRAME." },
  { n: '02', text: 'FRONT-ON. GOOD, EVEN LIGHT ON YOUR FACE.' },
  { n: '03', text: 'FIRST SECOND CALIBRATES — KEEP EYES OPEN.' },
  { n: '04', text: 'THEN HOLD. THE CLOCK ENDS ON YOUR FIRST BLINK.' },
];

export const EXERCISES: Record<ExerciseId, ExerciseConfig> = {
  pushup: {
    id: 'pushup',
    title: 'PUSH-UPS',
    mode: 'far',
    landmarker: 'pose',
    metric: 'count',
    readoutLabel: 'VERIFIED',
    makeTracker: () => new PushupTracker(),
    placement: SIDE_ON,
    hardRule:
      "A REP THAT DOESN'T BREAK 100° AT THE ELBOW IS NOT COUNTED. NO PARTIAL CREDIT.",
  },
  plank: {
    id: 'plank',
    title: 'PLANK',
    mode: 'far',
    landmarker: 'pose',
    metric: 'clock',
    readoutLabel: 'HOLD',
    makeTracker: () => new PlankTracker(),
    placement: SIDE_ON,
    hardRule:
      'THE CLOCK ONLY RUNS WHILE YOUR BODY LINE IS STRAIGHT. BREAK FORM, IT PAUSES.',
  },
  skipping: {
    id: 'skipping',
    title: 'SKIPPING',
    mode: 'far',
    landmarker: 'pose',
    metric: 'count',
    readoutLabel: 'JUMPS',
    makeTracker: () => new SkippingTracker(),
    placement: FRONT_ON,
  },
  stillness: {
    id: 'stillness',
    title: 'STILLNESS',
    mode: 'near',
    landmarker: 'pose',
    metric: 'clock',
    readoutLabel: 'STILL',
    makeTracker: () => new StillnessTracker(),
    placement: NEAR_UPPER,
    hardRule:
      "THE CLOCK ONLY RUNS WHILE YOU'RE STILL. ANY MOVEMENT PAUSES IT.",
  },
  stare: {
    id: 'stare',
    title: 'STARE',
    mode: 'near',
    landmarker: 'face',
    metric: 'clock',
    readoutLabel: "DON'T BLINK",
    makeTracker: () => new StareTracker(),
    placement: NEAR_FACE,
    hardRule:
      'THE CLOCK RUNS UNTIL YOUR FIRST BLINK. HOLD YOUR EYES OPEN.',
  },
};
