import { useEffect, useRef, useState, useCallback } from 'react';
import { usePoseLandmarker } from '../pose/usePoseLandmarker';
import type { TrackerState, ExerciseTracker } from '../trackers/types';
import { audioSignals } from '../audio/AudioSignals';
import type { ExerciseConfig } from '../exercises';
import { formatClock, type SessionResult } from './Session';

/** NEAR MODE — phone at arm's length, user calm. The screen must not stimulate:
 *  near-black, a dim mono clock only, no bright camera feed, no visible buttons
 *  during the test. STILLNESS allows eyes closed, so audio carries state (soft
 *  chime = paused, low tone = resumed). End = press-and-hold anywhere 2s. */

const HOLD_TO_END_MS = 2000;
const DIM_EARN = '#5f8a3d'; // dimmed acid-green, non-stimulating
const DIM_FAULT = '#8a3436'; // dimmed blood-red

interface Props {
  config: ExerciseConfig;
  onExit: (result: SessionResult) => void;
}

export function NearSession({ config, onExit }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const trackerRef = useRef<ExerciseTracker>(config.makeTracker());
  const rafRef = useRef<number>(0);
  const lastTsRef = useRef(0);
  const lastGoodRef = useRef({ holdTimeMs: 0, formScore: 0 });
  const pausedRef = useRef(false);
  const fpsRef = useRef({ frames: 0, windowStart: 0, fps: 0 });

  // press-and-hold-to-end
  const endTimerRef = useRef<number | null>(null);
  const [ending, setEnding] = useState(false);

  const [camError, setCamError] = useState<string | null>(null);
  const [debug, setDebug] = useState(false);
  const [live, setLive] = useState<TrackerState>({
    holdTimeMs: 0,
    formScore: 0,
    phase: 'holding',
    faults: [],
  });

  const { status, error: poseError, detect } = usePoseLandmarker(true);

  // ── camera (feed stays hidden; only landmarks are used) ────────────────
  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    (async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'user' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        const v = videoRef.current;
        if (!v) return;
        v.srcObject = s;
        await v.play();
      } catch (e) {
        if (!cancelled) setCamError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // ── main loop (no canvas draw — screen must stay dark) ─────────────────
  useEffect(() => {
    if (status !== 'ready') return;
    const video = videoRef.current;
    if (!video) return;

    const loop = () => {
      rafRef.current = requestAnimationFrame(loop);
      if (video.readyState < 2 || video.videoWidth === 0) return;

      let ts = performance.now();
      if (ts <= lastTsRef.current) ts = lastTsRef.current + 1;
      lastTsRef.current = ts;

      const result = detect(video, ts);

      const f = fpsRef.current;
      f.frames += 1;
      if (ts - f.windowStart >= 1000) {
        f.fps = Math.round((f.frames * 1000) / (ts - f.windowStart));
        f.frames = 0;
        f.windowStart = ts;
      }

      const lms = result?.landmarks?.[0];
      let state: TrackerState;
      if (lms && lms.length) {
        state = trackerRef.current.processFrame(lms, ts);
        lastGoodRef.current = {
          holdTimeMs: state.holdTimeMs ?? 0,
          formScore: state.formScore,
        };
      } else {
        state = {
          ...lastGoodRef.current,
          phase: 'paused',
          faults: ['MOVE INTO FRAME'],
        };
      }

      // audio carries the state change (eyes may be closed)
      const isPaused = state.phase === 'paused' || state.phase === 'invalid';
      if (isPaused && !pausedRef.current) {
        audioSignals.pausedCue();
        pausedRef.current = true;
      } else if (!isPaused && pausedRef.current) {
        audioSignals.resumedCue();
        pausedRef.current = false;
      }

      setLive(state);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [status, detect]);

  // ── press-and-hold anywhere for 2s to end ──────────────────────────────
  const beginHold = useCallback(() => {
    void audioSignals.unlock(); // idempotent
    if (endTimerRef.current !== null) return;
    setEnding(true);
    endTimerRef.current = window.setTimeout(() => {
      onExit({
        exerciseId: config.id,
        title: config.title,
        metric: config.metric,
        value: live.holdTimeMs ?? 0,
        avgForm: live.formScore,
      });
    }, HOLD_TO_END_MS);
  }, [onExit, config, live.holdTimeMs, live.formScore]);

  const cancelHold = useCallback(() => {
    if (endTimerRef.current !== null) {
      clearTimeout(endTimerRef.current);
      endTimerRef.current = null;
    }
    setEnding(false);
  }, []);

  useEffect(() => {
    return () => {
      if (endTimerRef.current !== null) clearTimeout(endTimerRef.current);
    };
  }, []);

  const isPaused = live.phase === 'paused' || live.phase === 'invalid';
  const stateWord = isPaused
    ? (live.faults[0] ?? 'PAUSED')
    : 'COUNTING';

  return (
    <div
      className="relative flex h-full w-full select-none flex-col items-center justify-center overflow-hidden bg-void"
      onPointerDown={beginHold}
      onPointerUp={cancelHold}
      onPointerLeave={cancelHold}
      onPointerCancel={cancelHold}
    >
      <video ref={videoRef} className="hidden" playsInline muted />

      {status === 'loading' && (
        <p className="numerals text-sm tracking-widest text-bone/40">
          PREPARING…
        </p>
      )}
      {status === 'error' && (
        <p className="max-w-xs px-8 text-center text-sm text-fault/70">
          POSE MODEL FAILED — {poseError}
        </p>
      )}
      {camError && (
        <p className="max-w-xs px-8 text-center text-sm text-fault/70">
          CAMERA BLOCKED — {camError}
        </p>
      )}

      {status === 'ready' && !camError && (
        <>
          {/* dim clock — the whole interface */}
          <div
            className="numerals whitespace-nowrap leading-none transition-colors duration-500"
            style={{
              fontSize: `min(18vh, ${Math.round((150 / Math.max(formatClock(live.holdTimeMs ?? 0).length, 1)) * 10) / 10}vw)`,
              color: isPaused ? DIM_FAULT : DIM_EARN,
            }}
          >
            {formatClock(live.holdTimeMs ?? 0)}
          </div>
          <div className="numerals mt-4 text-xs tracking-[0.4em] text-bone/30">
            {stateWord}
          </div>
        </>
      )}

      {/* faint hold-to-end hint + progress */}
      <div className="absolute inset-x-0 bottom-10 flex flex-col items-center gap-3">
        <div className="h-[2px] w-40 bg-bone/10">
          <div
            className="h-full bg-bone/40"
            style={{
              width: ending ? '100%' : '0%',
              transition: ending
                ? `width ${HOLD_TO_END_MS}ms linear`
                : 'width 120ms ease-out',
            }}
          />
        </div>
        <p className="numerals text-[10px] tracking-[0.3em] text-bone/25">
          {ending ? 'KEEP HOLDING…' : 'PRESS AND HOLD TO END'}
        </p>
      </div>

      {/* faint debug toggle — kept for threshold tuning (Phase 4) */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          setDebug((d) => !d);
        }}
        onPointerDown={(e) => e.stopPropagation()}
        className="numerals absolute right-2 top-2 px-2 py-1 text-[9px] tracking-widest text-bone/20"
      >
        {debug ? 'DBG ON' : 'DBG'}
      </button>
      {debug && (
        <div className="numerals absolute left-2 top-2 space-y-1 text-[11px] text-bone/40">
          <div>PHASE: {live.phase.toUpperCase()}</div>
          {live.debug &&
            Object.entries(live.debug).map(([k, v]) => (
              <div key={k}>
                {k.toUpperCase()}: {Number.isNaN(v) ? '—' : v}
              </div>
            ))}
          <div>FORM: {live.formScore}</div>
          <div>FPS: {fpsRef.current.fps || '—'}</div>
        </div>
      )}
    </div>
  );
}
