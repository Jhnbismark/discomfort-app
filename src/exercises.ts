import type { ExerciseTracker } from './trackers/types';
import { PushupTracker } from './trackers/pushup';
import { PlankTracker } from './trackers/plank';
import { SquatTracker } from './trackers/squat';
import { StillnessTracker } from './trackers/stillness';
import { StareTracker } from './trackers/stare';
import { GazeTracker } from './trackers/gaze';

export type ExerciseId =
  | 'pushup'
  | 'plank'
  | 'squat'
  | 'stillness'
  | 'stare'
  | 'gaze'
  | 'vigilance';

/** How the giant readout renders and what the metric means. 'rt' = median
 *  reaction time (PVT), lower wins. */
export type Metric = 'count' | 'clock' | 'rt';

/** FAR: phone 2–3m away, untouchable, giant readout, audio-primary. NEAR: phone
 *  at arm's length, calm, dim clock only, no visible buttons, hold-to-end. */
export type Mode = 'far' | 'near';

/** Which MediaPipe model this test needs. Only the selected one is loaded. */
export type Landmarker = 'pose' | 'face';

export interface PlacementStep {
  n: string;
  text: string;
}

/** which placement diagram the pre-session screen draws */
export type Diagram = 'side' | 'sideStand' | 'front' | 'near' | 'face';

export interface ExerciseConfig {
  id: ExerciseId;
  title: string;
  mode: Mode;
  landmarker: Landmarker;
  metric: Metric;
  /** unit label under the giant readout ("VERIFIED", "HOLD", "JUMPS") */
  readoutLabel: string;
  /** tracker-based tests supply this; the PVT (vigilance) has no tracker */
  makeTracker?: () => ExerciseTracker;
  placement: PlacementStep[];
  diagram: Diagram;
  /** optional on-brand hard-rule warning shown on the pre-session screen */
  hardRule?: string;
  /** NEAR MODE: render a gaze target dot + tiny clock instead of a big clock */
  target?: boolean;
  /** bespoke interaction screen instead of the tracker/hold-clock session */
  interaction?: 'pvt';
}

const SIDE_ON: PlacementStep[] = [
  { n: '01', text: 'CAMERA SIDE-ON TO YOUR BODY.' },
  { n: '02', text: 'PHONE SIDEWAYS (LANDSCAPE), 2–3 METRES AWAY, ON THE FLOOR.' },
  { n: '03', text: 'FULL BODY IN FRAME: HANDS TO FEET.' },
  { n: '04', text: 'AUDIO IS PRIMARY. TURN UP THE VOLUME.' },
];

const SIDE_STAND: PlacementStep[] = [
  { n: '01', text: 'CAMERA SIDE-ON TO YOUR BODY.' },
  { n: '02', text: 'PHONE SIDEWAYS (LANDSCAPE), 2–3 METRES AWAY, PROPPED UP.' },
  { n: '03', text: 'FULL BODY IN FRAME: HEAD TO FEET.' },
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

const NEAR_GAZE: PlacementStep[] = [
  { n: '01', text: "PHONE AT ARM'S LENGTH, FACE FILLING THE FRAME." },
  { n: '02', text: 'FRONT-ON. GOOD, EVEN LIGHT ON YOUR FACE.' },
  { n: '03', text: 'FIRST 2 SECONDS CALIBRATE — LOOK AT THE DOT.' },
  { n: '04', text: 'THEN HOLD YOUR GAZE. LOOK AWAY, IT PAUSES.' },
];

const NEAR_PVT: PlacementStep[] = [
  { n: '01', text: "PHONE AT ARM'S LENGTH, FACE IN FRAME." },
  { n: '02', text: 'SCREEN IS BLACK. WHEN A NUMBER APPEARS, TAP FAST.' },
  { n: '03', text: 'TAP BEFORE IT APPEARS = FALSE START. DO NOT GUESS.' },
  { n: '04', text: 'CAMERA VERIFIES EYES OPEN. 3 MINUTES.' },
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
    diagram: 'side',
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
    diagram: 'side',
    hardRule:
      'THE CLOCK ONLY RUNS WHILE YOUR BODY LINE IS STRAIGHT. BREAK FORM, IT PAUSES.',
  },
  squat: {
    id: 'squat',
    title: 'SQUATS',
    mode: 'far',
    landmarker: 'pose',
    metric: 'count',
    readoutLabel: 'VERIFIED',
    makeTracker: () => new SquatTracker(),
    placement: SIDE_STAND,
    diagram: 'sideStand',
    hardRule:
      "A REP THAT DOESN'T BREAK 105° AT THE KNEE IS NOT COUNTED. NO PARTIAL CREDIT.",
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
    diagram: 'near',
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
    diagram: 'face',
    hardRule:
      'THE CLOCK RUNS UNTIL YOUR FIRST BLINK. HOLD YOUR EYES OPEN.',
  },
  gaze: {
    id: 'gaze',
    title: 'GAZE',
    mode: 'near',
    landmarker: 'face',
    metric: 'clock',
    readoutLabel: 'ON TARGET',
    makeTracker: () => new GazeTracker(),
    placement: NEAR_GAZE,
    diagram: 'face',
    target: true,
    hardRule:
      'THE CLOCK ONLY RUNS WHILE YOUR EYES HOLD THE DOT. LOOK AWAY, IT PAUSES.',
  },
  vigilance: {
    id: 'vigilance',
    title: 'VIGILANCE',
    mode: 'near',
    landmarker: 'face',
    metric: 'rt',
    readoutLabel: 'MEDIAN RT',
    placement: NEAR_PVT,
    diagram: 'face',
    interaction: 'pvt',
    hardRule:
      'TAP THE INSTANT THE NUMBER APPEARS. LAPSES AND FALSE STARTS COST YOU.',
  },
};
