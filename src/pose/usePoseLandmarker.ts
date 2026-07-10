import { useCallback, useEffect, useRef, useState } from 'react';
import type { PoseLandmarker, NormalizedLandmark } from '@mediapipe/tasks-vision';

/** Lazy-load the MediaPipe Pose model on session start. All pose processing is
 *  client-side — frames never leave the device; only numeric results are used.
 *  'full' model: 'lite' misplaced limbs at body-across-the-room distance, and
 *  since rendering is decoupled from detection (tracking/renderLoop.ts) the
 *  overlay stays smooth even when detection fps drops. */

const WASM_BASE =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm';
const MODEL_URLS = {
  full: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task',
  // ~29MB, slowest, best accuracy — viable since rendering no longer waits
  // on detection; promoted to default if it wins the phone test
  heavy:
    'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task',
} as const;

export type PoseStatus = 'idle' | 'loading' | 'ready' | 'error';
export type PoseDelegate = 'GPU' | 'CPU';
export type PoseModel = keyof typeof MODEL_URLS;

/** delegate: some phone GPUs run MediaPipe's GPU path with garbage output —
 *  the CPU toggle in the session debug panel is the diagnostic for that. */
export function usePoseLandmarker(
  active: boolean,
  delegate: PoseDelegate = 'GPU',
  model: PoseModel = 'full'
) {
  const [status, setStatus] = useState<PoseStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const landmarkerRef = useRef<PoseLandmarker | null>(null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;

    (async () => {
      try {
        setStatus('loading');
        // dynamic import: the ~MB mediapipe chunk only downloads when a
        // session actually starts, not on app load
        const mp = await import('@mediapipe/tasks-vision');
        const vision = await mp.FilesetResolver.forVisionTasks(WASM_BASE);
        if (cancelled) return;
        const landmarker = await mp.PoseLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: MODEL_URLS[model], delegate },
          runningMode: 'VIDEO',
          numPoses: 1,
        });
        if (cancelled) {
          landmarker.close();
          return;
        }
        landmarkerRef.current = landmarker;
        setStatus('ready');
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
      landmarkerRef.current?.close();
      landmarkerRef.current = null;
      setStatus('idle');
    };
  }, [active, delegate, model]);

  /** Run detection and return the first pose's landmarks (or null). Stable
   *  identity (reads through a ref) so consumers can list it in effect deps
   *  without re-running their loop every render. */
  const detect = useCallback(
    (
      video: HTMLVideoElement,
      timestampMs: number
    ): NormalizedLandmark[] | null => {
      const lm = landmarkerRef.current;
      if (!lm) return null;
      return lm.detectForVideo(video, timestampMs).landmarks?.[0] ?? null;
    },
    []
  );

  return { status, error, detect };
}
