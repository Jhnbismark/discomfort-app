/** MediaPipe BlazePose 33-point landmark indices (subset we use). */
export const LM = {
  NOSE: 0,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
} as const;

/** Bone pairs for the skeleton overlay (upper body + legs, torso). */
export const POSE_CONNECTIONS: [number, number][] = [
  // arms
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  // shoulders + torso
  [11, 12],
  [11, 23],
  [12, 24],
  [23, 24],
  // legs
  [23, 25],
  [25, 27],
  [24, 26],
  [26, 28],
];
