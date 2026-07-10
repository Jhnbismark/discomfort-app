import { POSE_CONNECTIONS } from '../pose/landmarks';
import type { LandmarkStore, DisplayLandmark } from './landmarkStore';

/** Overlay render loop, independent of detection. Runs its own RAF at display
 *  refresh rate; each frame lerps store.display toward store.target, then
 *  draws the mirrored feed + skeleton from the interpolated landmarks. The
 *  detection loop never touches the canvas.
 *
 *  Interpolation uses the exponential form alpha = 1 - exp(-lambda*dt) so the
 *  smoothing speed is framerate-independent (a fixed 0.3 would smooth twice as
 *  hard at 120Hz as at 60Hz). */

const LAMBDA = 20; // 1/s — higher = display snaps to target faster

/** Detection older than FADE_START_MS starts fading the skeleton; fully gone
 *  at FADE_START_MS + FADE_LEN_MS. Signals lost tracking instead of freezing
 *  a stale skeleton. */
const FADE_START_MS = 300;
const FADE_LEN_MS = 500;

const EARN = '#9BE564';
const FAULT = '#E5484D';
const BONE = '#EDEDEA';
const VIS_DRAW_FLOOR = 0.4;

export interface RenderLoopOptions {
  video: HTMLVideoElement;
  canvas: HTMLCanvasElement;
  store: LandmarkStore;
  /** latest tracker phase — drives skeleton color (earn/fault/bone) */
  getPhase: () => string;
  /** called ~once per second with the measured render fps */
  onFps?: (fps: number) => void;
}

/** Starts the loop immediately (frames are skipped until the camera has
 *  data). Returns a stop function — call it on unmount. */
export function startRenderLoop(opts: RenderLoopOptions): () => void {
  const { video, canvas, store, getPhase, onFps } = opts;
  let rafId = 0;
  let stopped = false;
  let lastFrameTs = 0;
  let fpsFrames = 0;
  let fpsWindowStart = 0;

  const frame = (now: number) => {
    if (stopped) return;
    rafId = requestAnimationFrame(frame);
    if (video.readyState < 2 || video.videoWidth === 0) return;

    const dtS = lastFrameTs ? Math.min((now - lastFrameTs) / 1000, 0.1) : 0;
    lastFrameTs = now;

    fpsFrames += 1;
    if (now - fpsWindowStart >= 1000) {
      onFps?.(Math.round((fpsFrames * 1000) / (now - fpsWindowStart)));
      fpsFrames = 0;
      fpsWindowStart = now;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
    }

    // cover-fit projection; front camera, so mirror feed + skeleton
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const scale = Math.max(cw / vw, ch / vh);
    const dw = vw * scale;
    const dh = vh * scale;
    const ox = (cw - dw) / 2;
    const oy = (ch - dh) / 2;
    const px = (nx: number) => ox + (1 - nx) * dw;
    const py = (ny: number) => oy + ny * dh;

    ctx.clearRect(0, 0, cw, ch);
    ctx.save();
    ctx.translate(cw, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, ox, oy, dw, dh);
    ctx.restore();
    ctx.fillStyle = 'rgba(10,10,10,0.45)';
    ctx.fillRect(0, 0, cw, ch);

    stepDisplay(store, dtS);

    const lms = store.display;
    if (!lms || !store.lastUpdateTs) return;

    // stale detection -> fade out rather than freeze
    const age = now - store.lastUpdateTs;
    const alpha =
      age <= FADE_START_MS
        ? 1
        : Math.max(0, 1 - (age - FADE_START_MS) / FADE_LEN_MS);
    if (alpha <= 0) return;

    ctx.globalAlpha = alpha;
    drawSkeleton(ctx, lms, px, py, getPhase());
    ctx.globalAlpha = 1;
  };

  rafId = requestAnimationFrame(frame);
  return () => {
    stopped = true;
    cancelAnimationFrame(rafId);
  };
}

/** Lerp display toward target, framerate-independently. Snaps when there is
 *  no display yet (first detection, or landmark-count change). */
function stepDisplay(store: LandmarkStore, dtS: number): void {
  const target = store.target;
  if (!target) return;

  if (!store.display || store.display.length !== target.length) {
    store.display = target.map((lm) => ({
      x: lm.x,
      y: lm.y,
      visibility: lm.visibility ?? 0,
    }));
    return;
  }

  const a = 1 - Math.exp(-LAMBDA * dtS);
  const display = store.display;
  for (let i = 0; i < target.length; i++) {
    const t = target[i];
    const d = display[i];
    d.x += (t.x - d.x) * a;
    d.y += (t.y - d.y) * a;
    d.visibility += ((t.visibility ?? 0) - d.visibility) * a;
  }
}

type Proj = (n: number) => number;

/** Batched: one path + one stroke for all bones, one path + one fill for all
 *  joints — not a path per landmark. */
function drawSkeleton(
  ctx: CanvasRenderingContext2D,
  lms: DisplayLandmark[],
  px: Proj,
  py: Proj,
  phase: string
): void {
  const earnPhases = ['down', 'holding', 'airborne'];
  const faultPhases = ['invalid', 'paused'];
  const color = faultPhases.includes(phase)
    ? FAULT
    : earnPhases.includes(phase)
      ? EARN
      : BONE;
  ctx.lineWidth = 4;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;

  ctx.beginPath();
  for (const [a, b] of POSE_CONNECTIONS) {
    const p = lms[a];
    const q = lms[b];
    if (!p || !q) continue;
    if (p.visibility < VIS_DRAW_FLOOR || q.visibility < VIS_DRAW_FLOOR) continue;
    ctx.moveTo(px(p.x), py(p.y));
    ctx.lineTo(px(q.x), py(q.y));
  }
  ctx.stroke();

  ctx.beginPath();
  for (const lm of lms) {
    if (lm.visibility < VIS_DRAW_FLOOR) continue;
    const x = px(lm.x);
    const y = py(lm.y);
    ctx.moveTo(x + 5, y); // subpath break so arcs don't chain into each other
    ctx.arc(x, y, 5, 0, Math.PI * 2);
  }
  ctx.fill();
}
