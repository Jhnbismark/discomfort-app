import { useCallback, useEffect, useRef, useState } from 'react';
import type { FaceLandmarker, NormalizedLandmark } from '@mediapipe/tasks-vision';

/** Lazy-load the MediaPipe Face Landmarker (iris + eye landmarks) on demand.
 *  Only loaded for tests that need it (STARE, later GAZE/VIGILANCE). All
 *  processing client-side — frames never leave the device. */

const WASM_BASE =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm';
const MODEL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

export type FaceStatus = 'idle' | 'loading' | 'ready' | 'error';

export function useFaceLandmarker(active: boolean) {
  const [status, setStatus] = useState<FaceStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const landmarkerRef = useRef<FaceLandmarker | null>(null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;

    (async () => {
      try {
        setStatus('loading');
        // dynamic import: mediapipe chunk only downloads when a session starts
        const mp = await import('@mediapipe/tasks-vision');
        const vision = await mp.FilesetResolver.forVisionTasks(WASM_BASE);
        if (cancelled) return;
        const landmarker = await mp.FaceLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: MODEL, delegate: 'GPU' },
          runningMode: 'VIDEO',
          numFaces: 1,
          // landmarks are enough for EAR; blendshapes/matrix off to stay light
          outputFaceBlendshapes: false,
          outputFacialTransformationMatrixes: false,
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
  }, [active]);

  /** Run detection and return the first face's landmarks (or null). */
  const detect = useCallback(
    (
      video: HTMLVideoElement,
      timestampMs: number
    ): NormalizedLandmark[] | null => {
      const lm = landmarkerRef.current;
      if (!lm) return null;
      return lm.detectForVideo(video, timestampMs).faceLandmarks?.[0] ?? null;
    },
    []
  );

  return { status, error, detect };
}
