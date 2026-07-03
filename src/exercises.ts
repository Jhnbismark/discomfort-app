import type { ExerciseTracker } from './trackers/types';
import { PushupTracker } from './trackers/pushup';
import { PlankTracker } from './trackers/plank';
import { SkippingTracker } from './trackers/skipping';

export type ExerciseId = 'pushup' | 'plank' | 'skipping';

/** How the giant readout renders and what the metric means. */
export type Metric = 'count' | 'clock';

export interface PlacementStep {
  n: string;
  text: string;
}

export interface ExerciseConfig {
  id: ExerciseId;
  title: string;
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

export const EXERCISES: Record<ExerciseId, ExerciseConfig> = {
  pushup: {
    id: 'pushup',
    title: 'PUSH-UPS',
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
    metric: 'count',
    readoutLabel: 'JUMPS',
    makeTracker: () => new SkippingTracker(),
    placement: FRONT_ON,
  },
};
