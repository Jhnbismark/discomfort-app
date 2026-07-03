import { useEffect, useRef, useState, useCallback } from 'react';
import { usePoseLandmarker } from '../pose/usePoseLandmarker';
import { POSE_CONNECTIONS } from '../pose/landmarks';
import { PushupTracker } from '../trackers/pushup';
import type { TrackerState } from '../trackers/types';
import { audioSignals } from '../audio/AudioSignals';

interface Props {
  onExit: (result: { count: number; avgForm: number }) => void;
}

const EARN = '#9BE564';
const FAULT = '#E5484D';
const BONE = '#EDEDEA';

export function PushupSession({ onExit }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const trackerRef = useRef(new PushupTracker());
  const rafRef = useRef<number>(0);
  const lastTsRef = useRef(0);
  // last known-good tracker output — the loop closure must not read `live`
  // (it would be stale); the UI fallback when the body leaves frame reads this
  const lastGoodRef = useRef({ count: 0, formScore: 0 });
  // fps meter for the debug overlay
  const fpsRef = useRef({ frames: 0, windowStart: 0, fps: 0 });

  const [camError, setCamError] = useState<string | null>(null);
  const [debug, setDebug] = useState(false);
  const debugRef = useRef(false);
  const [live, setLive] = useState<TrackerState>({
    count: 0,
    formScore: 0,
    phase: 'up',
    faults: [],
  });
  // fault flash: text + a key that retriggers the CSS animation
  const [flash, setFlash] = useState<{ text: string; key: number } | null>(null);

  const { status, error: poseError, detect } = usePoseLandmarker(true);

  // keep a ref mirror of debug so the rAF loop reads the latest without re-binding
  useEffect(() => {
    debugRef.current = debug;
  }, [debug]);

  // ── camera ───────────────────────────────────────────────────────────
  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    (async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
        if (cancelled) {
          // unmounted (e.g. StrictMode double-mount) before the permission
          // prompt resolved — release the camera, don't leave the light on
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

  // ── main loop ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (status !== 'ready') return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const loop = () => {
      rafRef.current = requestAnimationFrame(loop);
      if (video.readyState < 2 || video.videoWidth === 0) return;

      // monotonically increasing timestamp for detectForVideo
      let ts = performance.now();
      if (ts <= lastTsRef.current) ts = lastTsRef.current + 1;
      lastTsRef.current = ts;

      const result = detect(video, ts);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // size canvas to viewport
      const cw = canvas.clientWidth;
      const ch = canvas.clientHeight;
      if (canvas.width !== cw || canvas.height !== ch) {
        canvas.width = cw;
        canvas.height = ch;
      }

      // cover-fit the video into the canvas, remember the transform
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      const scale = Math.max(cw / vw, ch / vh);
      const dw = vw * scale;
      const dh = vh * scale;
      const ox = (cw - dw) / 2;
      const oy = (ch - dh) / 2;
      const px = (nx: number) => ox + nx * dw;
      const py = (ny: number) => oy + ny * dh;

      ctx.clearRect(0, 0, cw, ch);
      ctx.drawImage(video, ox, oy, dw, dh);
      // darken the feed so the counter reads clearly at 3m
      ctx.fillStyle = 'rgba(10,10,10,0.45)';
      ctx.fillRect(0, 0, cw, ch);

      // fps meter (1s window) for the debug overlay
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
          count: state.count ?? 0,
          formScore: state.formScore,
        };
        drawSkeleton(ctx, lms, px, py, state.phase);
      } else {
        // body left frame: keep the earned numbers, flag the state
        state = {
          ...lastGoodRef.current,
          phase: 'invalid',
          faults: ['MOVE INTO FRAME'],
        };
      }

      // consume one-frame events for audio + flash
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

      setLive(state);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [status, detect]);

  // ── silence any sustained tone on unmount (context is app-wide, keep it) ─
  useEffect(() => {
    return () => audioSignals.stopPausedTone();
  }, []);

  const handleEnd = useCallback(() => {
    onExit({ count: live.count ?? 0, avgForm: live.formScore });
  }, [onExit, live.count, live.formScore]);

  // backup unlock — primary unlock happens on the BEGIN tap in pre-session
  const startAudio = () => void audioSignals.unlock();

  const paused = live.phase === 'invalid';
  const fault = live.faults[0];

  return (
    <div
      className="relative h-full w-full overflow-hidden bg-void"
      onPointerDown={startAudio}
    >
      <video ref={videoRef} className="hidden" playsInline muted />
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />

      {/* loading / error states */}
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

      {/* GIANT COUNTER — fills ~half the screen, readable at 3m */}
      <div className="pointer-events-none absolute inset-x-0 top-[6vh] flex flex-col items-center">
        <div
          className="numerals leading-none"
          style={{
            fontSize: '42vh',
            color: paused ? FAULT : EARN,
            textShadow: '0 0 40px rgba(0,0,0,0.7)',
          }}
        >
          {live.count ?? 0}
        </div>
        <div className="numerals mt-2 text-lg tracking-[0.3em] text-bone/70">
          VERIFIED
        </div>
      </div>

      {/* full-width fault banner */}
      {fault && (
        <div
          className="numerals absolute inset-x-0 top-1/2 -translate-y-1/2 bg-fault/95 py-4 text-center text-3xl font-bold tracking-widest text-void"
        >
          {fault}
        </div>
      )}
      {flash && (
        <div
          key={flash.key}
          className="fault-flash numerals absolute inset-x-0 bottom-[22vh] bg-fault py-3 text-center text-2xl font-bold tracking-widest text-void"
        >
          {flash.text}
        </div>
      )}

      {/* debug angle overlay */}
      {debug && (
        <div className="numerals absolute left-3 top-3 space-y-1 bg-void/80 p-3 text-sm text-earn">
          <div>PHASE: {live.phase.toUpperCase()}</div>
          <div>ELBOW: {fmt(live.debug?.elbow)}°</div>
          <div>MIN: {fmt(live.debug?.minElbow)}°</div>
          <div>SIDE: {live.debug?.side === 1 ? 'R' : live.debug?.side === 0 ? 'L' : '—'}</div>
          <div>FORM: {live.formScore}</div>
          <div>LAST REP: {live.lastRepScore ?? '—'}</div>
          <div>FPS: {fpsRef.current.fps || '—'}</div>
        </div>
      )}

      {/* controls */}
      <button
        onClick={() => setDebug((d) => !d)}
        className="numerals absolute right-3 top-3 border border-bone/40 px-3 py-2 text-xs tracking-widest text-bone/80"
      >
        {debug ? 'DEBUG ON' : 'DEBUG'}
      </button>

      {/* oversized END SESSION — thumb from above */}
      <button
        onClick={handleEnd}
        className="numerals absolute inset-x-0 bottom-0 border-t-2 border-fault bg-void/90 py-7 text-center text-2xl font-bold tracking-[0.3em] text-fault active:bg-fault active:text-void"
      >
        END SESSION
      </button>

      {/* on-device footer promise */}
      <p className="numerals pointer-events-none absolute inset-x-0 bottom-24 text-center text-[10px] tracking-widest text-bone/30">
        PROCESSED ON DEVICE. NOTHING WATCHES YOU BUT YOU.
      </p>
    </div>
  );
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

type Proj = (n: number) => number;

function drawSkeleton(
  ctx: CanvasRenderingContext2D,
  lms: { x: number; y: number; visibility?: number }[],
  px: Proj,
  py: Proj,
  phase: string
) {
  const color = phase === 'invalid' ? FAULT : phase === 'down' ? EARN : BONE;
  ctx.lineWidth = 4;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;

  for (const [a, b] of POSE_CONNECTIONS) {
    const p = lms[a];
    const q = lms[b];
    if (!p || !q) continue;
    if ((p.visibility ?? 0) < 0.4 || (q.visibility ?? 0) < 0.4) continue;
    ctx.beginPath();
    ctx.moveTo(px(p.x), py(p.y));
    ctx.lineTo(px(q.x), py(q.y));
    ctx.stroke();
  }
  for (const lm of lms) {
    if ((lm.visibility ?? 0) < 0.4) continue;
    ctx.beginPath();
    ctx.arc(px(lm.x), py(lm.y), 5, 0, Math.PI * 2);
    ctx.fill();
  }
}
