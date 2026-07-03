import { useEffect, useRef, useState, useCallback } from 'react';
import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import { usePoseLandmarker } from '../pose/usePoseLandmarker';
import { useFaceLandmarker } from '../pose/useFaceLandmarker';
import { facePresent } from '../pose/faceMath';
import type { TrackerState, ExerciseTracker } from '../trackers/types';
import { audioSignals } from '../audio/AudioSignals';
import type { ExerciseConfig } from '../exercises';
import { formatClockTenths, type SessionResult } from './Session';

/** NEAR MODE — phone at arm's length, user calm. Starts with a FRAMING stage:
 *  the camera feed is visible with an IN FRAME indicator so you can position
 *  yourself, then BEGIN drops to the dark test screen (dim mono clock, no
 *  bright feed, no visible buttons). If tracking pauses mid-test, a small
 *  thumbnail feed reappears so you can re-frame. STILLNESS allows eyes closed,
 *  so audio carries state (soft chime = paused, low tone = resumed). STARE ends
 *  automatically on the first blink. End manually = press and hold anywhere 2s. */

const HOLD_TO_END_MS = 2000;
const DIM_EARN = '#5f8a3d';
const DIM_FAULT = '#8a3436';
const MIN_POSE_POINTS = 6; // matches the stillness tracker's judgeable floor

interface Props {
  config: ExerciseConfig;
  onExit: (result: SessionResult) => void;
}

/** Is the subject usably in frame? Face tests need the face mesh; pose tests
 *  need enough visible landmarks to judge. */
function subjectPresent(
  lms: NormalizedLandmark[] | null,
  usesFace: boolean
): boolean {
  if (!lms || lms.length === 0) return false;
  if (usesFace) return facePresent(lms);
  let n = 0;
  for (const lm of lms) if ((lm.visibility ?? 0) >= 0.5) n += 1;
  return n >= MIN_POSE_POINTS;
}

export function NearSession({ config, onExit }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const trackerRef = useRef<ExerciseTracker>(config.makeTracker!());
  const rafRef = useRef<number>(0);
  const lastTsRef = useRef(0);
  const pausedRef = useRef(false);
  const endedRef = useRef(false); // guard the auto-exit from firing twice
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;
  const fpsRef = useRef({ frames: 0, windowStart: 0, fps: 0 });

  const endTimerRef = useRef<number | null>(null);
  const [ending, setEnding] = useState(false);

  const [stage, setStage] = useState<'framing' | 'live'>('framing');
  const stageRef = useRef<'framing' | 'live'>('framing');
  const [inFrame, setInFrame] = useState(false);

  const [camError, setCamError] = useState<string | null>(null);
  const [debug, setDebug] = useState(false);
  const [live, setLive] = useState<TrackerState>({
    holdTimeMs: 0,
    formScore: 0,
    phase: config.landmarker === 'face' ? 'calibrating' : 'holding',
    faults: [],
  });

  // load only the model this test needs
  const usesFace = config.landmarker === 'face';
  const pose = usePoseLandmarker(!usesFace);
  const face = useFaceLandmarker(usesFace);
  const { status, error, detect } = usesFace ? face : pose;

  // ── camera (feed shown while framing / paused; dark while earning) ─────
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

  // ── main loop (no canvas draw — test screen must stay dark) ────────────
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

      const lms = detect(video, ts);

      const f = fpsRef.current;
      f.frames += 1;
      if (ts - f.windowStart >= 1000) {
        f.fps = Math.round((f.frames * 1000) / (ts - f.windowStart));
        f.frames = 0;
        f.windowStart = ts;
      }

      const present = subjectPresent(lms, usesFace);
      setInFrame((prev) => (prev === present ? prev : present));

      // framing stage: only report presence — the tracker (and any
      // calibration) must not start until the user is positioned and begins
      if (stageRef.current === 'framing') return;

      // Every tracker handles an empty landmark array as "subject not visible"
      // and preserves its accumulated result, so we always call through.
      const state = trackerRef.current.processFrame(lms ?? [], ts);

      // tracker declared the attempt over (STARE blink / face-lost void)
      if (state.ended && !endedRef.current) {
        endedRef.current = true;
        cancelAnimationFrame(rafRef.current);
        onExitRef.current({
          exerciseId: config.id,
          title: config.title,
          metric: config.metric,
          value: state.holdTimeMs ?? 0,
          avgForm: state.formScore,
          voided: state.voided,
          note: state.voided ? undefined : 'BLINK.',
        });
        return;
      }

      // audio carries the state change (eyes may be closed)
      const isPaused =
        state.faults.length > 0 ||
        state.phase === 'paused' ||
        state.phase === 'invalid';
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
  }, [status, detect, config, usesFace]);

  // ── framing -> live ────────────────────────────────────────────────────
  const begin = useCallback(() => {
    void audioSignals.unlock();
    trackerRef.current.reset(); // calibration starts clean, right now
    stageRef.current = 'live';
    setStage('live');
  }, []);

  // ── press-and-hold anywhere for 2s to end (live stage only) ────────────
  const beginHold = useCallback(() => {
    void audioSignals.unlock();
    if (stageRef.current !== 'live') return;
    if (endTimerRef.current !== null || endedRef.current) return;
    setEnding(true);
    endTimerRef.current = window.setTimeout(() => {
      if (endedRef.current) return;
      endedRef.current = true;
      onExitRef.current({
        exerciseId: config.id,
        title: config.title,
        metric: config.metric,
        value: live.holdTimeMs ?? 0,
        avgForm: live.formScore,
      });
    }, HOLD_TO_END_MS);
  }, [config, live.holdTimeMs, live.formScore]);

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

  const isPaused =
    live.faults.length > 0 ||
    live.phase === 'paused' ||
    live.phase === 'invalid';
  const stateWord = deriveStateWord(live);
  const clock = formatClockTenths(live.holdTimeMs ?? 0);
  const framing = stage === 'framing';
  const ready = status === 'ready' && !camError;

  // feed placement: big while framing; small re-frame thumbnail when the test
  // is paused (tracking lost / fault); hidden while earning
  const videoClass = framing
    ? 'absolute left-1/2 top-[8vh] h-[38vh] w-[68vw] max-w-xs -translate-x-1/2 border border-bone/25 object-cover opacity-80'
    : isPaused
      ? 'absolute bottom-28 right-3 h-32 w-24 border border-fault/50 object-cover opacity-60'
      : 'hidden';

  return (
    <div
      className="relative flex h-full w-full select-none flex-col items-center justify-center overflow-hidden bg-void"
      onPointerDown={beginHold}
      onPointerUp={cancelHold}
      onPointerLeave={cancelHold}
      onPointerCancel={cancelHold}
    >
      <video
        ref={videoRef}
        className={videoClass}
        style={{ transform: 'scaleX(-1)' }}
        playsInline
        muted
      />

      {status === 'loading' && (
        <p className="numerals text-sm tracking-widest text-bone/40">
          PREPARING…
        </p>
      )}
      {status === 'error' && (
        <p className="max-w-xs px-8 text-center text-sm text-fault/70">
          MODEL FAILED — {error}
        </p>
      )}
      {camError && (
        <p className="max-w-xs px-8 text-center text-sm text-fault/70">
          CAMERA BLOCKED — {camError}
        </p>
      )}

      {/* ── FRAMING: see yourself, get in frame, then begin ── */}
      {ready && framing && (
        <div className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-5 px-6 pb-8">
          <div
            className="numerals text-sm font-bold tracking-[0.4em]"
            style={{ color: inFrame ? DIM_EARN : DIM_FAULT }}
          >
            {inFrame
              ? usesFace
                ? 'FACE IN FRAME'
                : 'IN FRAME'
              : usesFace
                ? 'NO FACE DETECTED'
                : 'NOT IN FRAME'}
          </div>
          <p className="numerals text-center text-[10px] tracking-[0.3em] text-bone/40">
            POSITION YOURSELF. THE SCREEN GOES DARK WHEN YOU BEGIN.
          </p>
          <button
            onClick={(e) => {
              e.stopPropagation();
              begin();
            }}
            onPointerDown={(e) => e.stopPropagation()}
            disabled={!inFrame}
            className={
              'numerals w-full border-2 py-5 text-xl font-bold tracking-[0.3em] transition-colors ' +
              (inFrame
                ? 'border-earn text-earn active:bg-earn active:text-void'
                : 'border-bone/15 text-bone/25')
            }
          >
            {inFrame ? 'BEGIN' : 'GET IN FRAME'}
          </button>
        </div>
      )}

      {/* ── LIVE: dark test screen ── */}
      {ready && !framing && config.target && (
        // GAZE: the target dot IS the interface. Tiny clock + state above it.
        // A ring around the dot mirrors the detector live: it swells as your
        // gaze drifts and hits the fault color at the tolerance edge.
        <>
          <div className="absolute top-[18vh] flex flex-col items-center">
            <div
              className="numerals text-2xl leading-none transition-colors duration-300"
              style={{ color: isPaused ? DIM_FAULT : DIM_EARN }}
            >
              {clock}
            </div>
            <div className="numerals mt-2 text-[10px] tracking-[0.4em] text-bone/30">
              {stateWord}
            </div>
          </div>
          <div className="relative flex items-center justify-center">
            <div
              className="absolute rounded-full border"
              style={{
                width: `${24 + gazeDrift(live) * 56}px`,
                height: `${24 + gazeDrift(live) * 56}px`,
                borderColor:
                  gazeDrift(live) >= 1 || isPaused ? DIM_FAULT : DIM_EARN,
                opacity: 0.6,
              }}
            />
            <div
              className="h-6 w-6 rounded-full transition-colors duration-300"
              style={{
                background: isPaused ? DIM_FAULT : DIM_EARN,
                boxShadow: `0 0 24px ${isPaused ? DIM_FAULT : DIM_EARN}`,
              }}
            />
          </div>
        </>
      )}

      {ready && !framing && !config.target && (
        <>
          <div
            className="numerals whitespace-nowrap leading-none transition-colors duration-500"
            style={{
              fontSize: `min(18vh, ${Math.round((150 / Math.max(clock.length, 1)) * 10) / 10}vw)`,
              color: isPaused ? DIM_FAULT : DIM_EARN,
            }}
          >
            {clock}
          </div>
          <div className="numerals mt-4 text-xs tracking-[0.4em] text-bone/30">
            {stateWord}
          </div>
        </>
      )}

      {ready && !framing && (
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
      )}

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
          <div>STAGE: {stage.toUpperCase()}</div>
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

/** GAZE deviation as a 0–1.4 fraction of the tolerance cone (drives the
 *  feedback ring). Falls back to 0 while calibrating / dev unavailable. */
function gazeDrift(s: TrackerState): number {
  const dev = s.debug?.dev;
  const tol = s.debug?.tol;
  if (dev === undefined || tol === undefined || !tol || Number.isNaN(dev)) {
    return 0;
  }
  return Math.min(dev / tol, 1.4);
}

/** phase/fault -> the dim status word under the clock. */
function deriveStateWord(s: TrackerState): string {
  if (s.faults.length > 0) return s.faults[0];
  switch (s.phase) {
    case 'calibrating':
      return 'EYES OPEN — CALIBRATING';
    case 'staring':
      return "DON'T BLINK";
    case 'holding':
      return 'COUNTING';
    default:
      return s.phase.toUpperCase();
  }
}
