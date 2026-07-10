import { useEffect, useRef, useState, useCallback } from 'react';
import { usePoseLandmarker } from '../pose/usePoseLandmarker';
import { createLandmarkStore } from '../tracking/landmarkStore';
import { LandmarkFilterBank } from '../tracking/oneEuro';
import { startRenderLoop } from '../tracking/renderLoop';
import type { TrackerState, ExerciseTracker } from '../trackers/types';
import { audioSignals } from '../audio/AudioSignals';
import { getPB, CHASE_TAUNTS, RECORD_DOWN } from '../lib/pb';
import type { ExerciseConfig } from '../exercises';

export interface SessionResult {
  exerciseId: string;
  title: string;
  metric: 'count' | 'clock' | 'rt';
  value: number; // reps/jumps, hold ms, or median reaction time ms (lower wins)
  avgForm: number;
  /** attempt ended without a valid result (STARE: face lost; PVT: no verified) */
  voided?: boolean;
  /** optional headline for the result screen ("BLINK.") */
  note?: string;
  /** PVT secondary metrics */
  lapses?: number;
  falseStarts?: number;
}

interface Props {
  config: ExerciseConfig;
  onExit: (result: SessionResult) => void;
}

const EARN = '#9BE564';
const FAULT = '#E5484D';

export function Session({ config, onExit }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const trackerRef = useRef<ExerciseTracker>(config.makeTracker!());
  // detection -> rendering handoff: filtered landmarks land in the store,
  // the render loop interpolates + draws them at display rate
  const storeRef = useRef(createLandmarkStore());
  const filterRef = useRef(new LandmarkFilterBank());
  const phaseRef = useRef('idle');
  const lastTsRef = useRef(0);
  // last known-good tracker output — the loop closure must not read `live`
  const lastGoodRef = useRef({ count: 0, holdTimeMs: 0, formScore: 0 });
  const fpsRef = useRef({ frames: 0, windowStart: 0, fps: 0 });
  const renderFpsRef = useRef(0);
  // for clock exercises: whether the sustained paused-tone is currently on
  const paused = useRef(false);

  const [camError, setCamError] = useState<string | null>(null);
  const [debug, setDebug] = useState(false);
  const [live, setLive] = useState<TrackerState>({
    count: 0,
    holdTimeMs: 0,
    formScore: 0,
    phase: 'idle',
    faults: [],
  });
  const [flash, setFlash] = useState<{ text: string; key: number } | null>(null);

  const { status, error: poseError, detect } = usePoseLandmarker(true);
  const isClock = config.metric === 'clock';

  // ── the ghost: your own record, here to be taken ─────────────────────
  const pbRef = useRef<number | null>(getPB(config.id));
  const [recordDown, setRecordDown] = useState(false);
  const [tauntIdx, setTauntIdx] = useState(() =>
    Math.floor(Math.random() * CHASE_TAUNTS.length)
  );
  const chasing = pbRef.current !== null && !recordDown;
  useEffect(() => {
    if (!chasing) return;
    const t = setInterval(
      () => setTauntIdx((i) => (i + 1) % CHASE_TAUNTS.length),
      12000
    );
    return () => clearInterval(t);
  }, [chasing]);
  useEffect(() => {
    const pb = pbRef.current;
    if (pb === null || recordDown) return;
    const value = isClock ? (live.holdTimeMs ?? 0) : (live.count ?? 0);
    if (value > pb) {
      setRecordDown(true);
      audioSignals.record();
    }
  }, [live, isClock, recordDown]);

  // ── camera ───────────────────────────────────────────────────────────
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

  // ── detection loop — runs at CAMERA rate, never draws ─────────────────
  // One Euro filters the raw landmarks, the filtered set goes to the store
  // (for the render loop) AND to the tracker (freshest signal — display
  // interpolation is cosmetic only and must not delay rep detection).
  useEffect(() => {
    if (status !== 'ready') return;
    const video = videoRef.current;
    if (!video) return;
    let stopped = false;
    let rafId = 0;
    let vfcId = 0;
    let lastVideoTime = -1;

    const runDetection = () => {
      if (video.readyState < 2 || video.videoWidth === 0) return;

      let ts = performance.now();
      if (ts <= lastTsRef.current) ts = lastTsRef.current + 1;
      lastTsRef.current = ts;

      const f = fpsRef.current;
      f.frames += 1;
      if (ts - f.windowStart >= 1000) {
        f.fps = Math.round((f.frames * 1000) / (ts - f.windowStart));
        f.frames = 0;
        f.windowStart = ts;
      }

      const raw = detect(video, ts);

      let state: TrackerState;
      if (raw && raw.length) {
        const filtered = filterRef.current.apply(raw, ts);
        storeRef.current.setTarget(filtered, ts);
        state = trackerRef.current.processFrame(filtered, ts);
        lastGoodRef.current = {
          count: state.count ?? 0,
          holdTimeMs: state.holdTimeMs ?? 0,
          formScore: state.formScore,
        };
      } else {
        // body left frame: keep earned numbers, flag the state. The store's
        // lastUpdateTs goes stale, so the render loop fades the skeleton.
        state = {
          ...lastGoodRef.current,
          phase: 'invalid',
          faults: ['MOVE INTO FRAME'],
        };
      }
      phaseRef.current = state.phase;

      // one-frame events -> audio + flash (count exercises)
      if (state.events) {
        for (const ev of state.events) {
          if (ev.type === 'rep-counted') {
            audioSignals.tick();
          } else if (ev.type === 'rep-rejected') {
            audioSignals.buzz();
            setFlash({ text: ev.reason, key: ts });
          }
        }
      }

      // clock exercises: sustained tone follows the paused state
      if (isClock) {
        const isPaused = state.phase === 'paused' || state.phase === 'invalid';
        if (isPaused && !paused.current) {
          audioSignals.startPausedTone();
          paused.current = true;
        } else if (!isPaused && paused.current) {
          audioSignals.stopPausedTone();
          paused.current = false;
        }
      }

      setLive(state);
    };

    // follow camera frames via requestVideoFrameCallback where available;
    // fall back to a RAF loop gated on currentTime so we still only detect
    // on NEW frames, not once per display refresh
    const vfc = video as HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: () => void) => number;
      cancelVideoFrameCallback?: (handle: number) => void;
    };
    if (vfc.requestVideoFrameCallback) {
      const onFrame = () => {
        if (stopped) return;
        vfcId = vfc.requestVideoFrameCallback!(onFrame);
        runDetection();
      };
      vfcId = vfc.requestVideoFrameCallback(onFrame);
    } else {
      const rafLoop = () => {
        if (stopped) return;
        rafId = requestAnimationFrame(rafLoop);
        if (video.currentTime === lastVideoTime) return;
        lastVideoTime = video.currentTime;
        runDetection();
      };
      rafId = requestAnimationFrame(rafLoop);
    }

    return () => {
      stopped = true;
      cancelAnimationFrame(rafId);
      vfc.cancelVideoFrameCallback?.(vfcId);
    };
  }, [status, detect, isClock]);

  // ── render loop — display-rate RAF, draws interpolated landmarks ──────
  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    return startRenderLoop({
      video,
      canvas,
      store: storeRef.current,
      getPhase: () => phaseRef.current,
      onFps: (fps) => {
        renderFpsRef.current = fps;
      },
    });
  }, []);

  // silence any sustained tone on unmount (context is app-wide, keep it)
  useEffect(() => {
    return () => audioSignals.stopPausedTone();
  }, []);

  const handleEnd = useCallback(() => {
    onExit({
      exerciseId: config.id,
      title: config.title,
      metric: config.metric,
      value: isClock ? (live.holdTimeMs ?? 0) : (live.count ?? 0),
      avgForm: live.formScore,
    });
  }, [onExit, config, isClock, live.holdTimeMs, live.count, live.formScore]);

  const startAudio = () => void audioSignals.unlock();

  const isPaused = live.phase === 'paused' || live.phase === 'invalid';
  const fault = live.faults[0];
  // clocks show tenths so a running clock is visibly alive (and a stuck one
  // visibly stuck); counts pop on each rep for the same reason
  const readout = isClock
    ? formatClockTenths(live.holdTimeMs ?? 0)
    : String(live.count ?? 0);

  return (
    <div
      className="relative h-full w-full overflow-hidden bg-void"
      onPointerDown={startAudio}
    >
      <video ref={videoRef} className="hidden" playsInline muted />
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />

      {status === 'loading' && (
        <Overlay>
          <p className="numerals text-lg tracking-widest text-bone">
            LOADING POSE MODEL…
          </p>
        </Overlay>
      )}
      {status === 'error' && (
        <Overlay>
          <p className="max-w-xs text-center text-sm text-fault">
            POSE MODEL FAILED TO LOAD
            <br />
            <span className="text-bone/60">{poseError}</span>
          </p>
        </Overlay>
      )}
      {camError && (
        <Overlay>
          <p className="max-w-xs text-center text-sm text-fault">
            CAMERA BLOCKED
            <br />
            <span className="text-bone/60">{camError}</span>
          </p>
        </Overlay>
      )}

      {/* GIANT READOUT — fills ~half the screen, readable at 3m. Font is sized
          off both viewport height AND string width so multi-digit counts and
          the M:SS clock never overflow a narrow phone. */}
      <div className="pointer-events-none absolute inset-x-0 top-[6vh] flex flex-col items-center overflow-hidden px-2">
        <div
          key={isClock ? 'clock' : (live.count ?? 0)}
          className={
            'numerals whitespace-nowrap leading-none' +
            (isClock ? '' : ' count-pop')
          }
          style={{
            fontSize: readoutFontSize(readout.length, isClock),
            color: isPaused ? FAULT : EARN,
            textShadow: '0 0 40px rgba(0,0,0,0.7)',
          }}
        >
          {readout}
        </div>
        <div className="numerals mt-2 text-lg tracking-[0.3em] text-bone/70">
          {config.readoutLabel}
        </div>
        {pbRef.current !== null && (
          <div
            className={
              'numerals mt-3 text-sm tracking-[0.25em] ' +
              (recordDown ? 'text-earn' : 'text-bone/50')
            }
          >
            {recordDown
              ? 'RECORD DOWN — KEEP GOING'
              : `THE RECORD: ${
                  isClock
                    ? formatClockTenths(pbRef.current)
                    : pbRef.current
                } — TAKE IT`}
          </div>
        )}
      </div>

      {/* persistent full-width fault banner (out of frame / paused form) */}
      {fault && (
        <div className="numerals absolute inset-x-0 top-1/2 -translate-y-1/2 bg-fault/95 py-4 text-center text-3xl font-bold tracking-widest text-void">
          {fault}
        </div>
      )}
      {/* transient rejected-rep flash (push-up shallow) */}
      {flash && (
        <div
          key={flash.key}
          className="fault-flash numerals absolute inset-x-0 bottom-[22vh] bg-fault py-3 text-center text-2xl font-bold tracking-widest text-void"
        >
          {flash.text}
        </div>
      )}
      {/* the moment the record falls — one green banner, then back to work */}
      {recordDown && (
        <div className="record-flash numerals absolute inset-x-0 bottom-[30vh] bg-earn py-4 text-center text-3xl font-bold tracking-widest text-void">
          {RECORD_DOWN}
        </div>
      )}

      {/* debug overlay — generic dump of the tracker's debug telemetry */}
      {debug && (
        <div className="numerals absolute left-3 top-3 space-y-1 bg-void/80 p-3 text-sm text-earn">
          <div>PHASE: {live.phase.toUpperCase()}</div>
          {live.debug &&
            Object.entries(live.debug).map(([k, v]) => (
              <div key={k}>
                {k.toUpperCase()}: {fmt(v)}
              </div>
            ))}
          <div>FORM: {live.formScore}</div>
          <div>
            FPS: {fpsRef.current.fps || '—'} DETECT /{' '}
            {renderFpsRef.current || '—'} DRAW
          </div>
        </div>
      )}

      <button
        onClick={() => setDebug((d) => !d)}
        className="numerals absolute right-3 top-3 border border-bone/40 px-3 py-2 text-xs tracking-widest text-bone/80"
      >
        {debug ? 'DEBUG ON' : 'DEBUG'}
      </button>

      <button
        onClick={handleEnd}
        className="numerals absolute inset-x-0 bottom-0 border-t-2 border-fault bg-void/90 py-7 text-center text-2xl font-bold tracking-[0.3em] text-fault active:bg-fault active:text-void"
      >
        END SESSION
      </button>

      <p
        key={chasing ? tauntIdx : 'privacy'}
        className={
          'numerals pointer-events-none absolute inset-x-0 bottom-24 text-center tracking-widest ' +
          (chasing ? 'screen-in text-xs text-bone/60' : 'text-[10px] text-bone/30')
        }
      >
        {chasing
          ? CHASE_TAUNTS[tauntIdx]
          : 'PROCESSED ON DEVICE. NOTHING WATCHES YOU BUT YOU.'}
      </p>
    </div>
  );
}

/** Font size for the giant readout. Capped by viewport height for the tall
 *  case, and by width-per-character so a long string (100+, or the M:SS clock)
 *  can't run off the sides. ~0.6em per mono glyph, ~88vw usable width, so the
 *  width cap is 88 / (len * 0.6) ≈ 146/len vw. Clock uses a lower height cap. */
function readoutFontSize(len: number, isClock: boolean): string {
  const heightCap = isClock ? 24 : 40; // vh
  const widthCap = Math.round((146 / Math.max(len, 1)) * 10) / 10; // vw
  return `min(${heightCap}vh, ${widthCap}vw)`;
}

/** milliseconds -> "M:SS" (always shows a minute field so it reads as a clock). */
export function formatClock(ms: number): string {
  const totalS = Math.floor(ms / 1000);
  const m = Math.floor(totalS / 60);
  const s = totalS % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** "M:SS.d" — the ticking tenths make it obvious the clock is earning. */
export function formatClockTenths(ms: number): string {
  const tenth = Math.floor(ms / 100) % 10;
  return `${formatClock(ms)}.${tenth}`;
}

function fmt(n: number | undefined): string {
  return n === undefined || Number.isNaN(n) ? '—' : String(n);
}

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-void/85">
      {children}
    </div>
  );
}
