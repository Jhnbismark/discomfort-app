import { useEffect, useRef, useState, useCallback } from 'react';
import { useFaceLandmarker } from '../pose/useFaceLandmarker';
import { meanEAR, facePresent } from '../pose/faceMath';
import { audioSignals } from '../audio/AudioSignals';
import type { ExerciseConfig } from '../exercises';
import type { SessionResult } from './Session';

/** VIGILANCE — psychomotor vigilance task (PVT). A full-screen counter appears
 *  at random 2–10s intervals; tap the instant it shows. Camera verifies face +
 *  eyes open throughout; taps during unverified periods are voided. Lapse = RT >
 *  500ms. False start = tap with no stimulus. Result = median RT (lower wins),
 *  secondary = lapse count. Fixed 3-minute duration. */

const DURATION_MS = 180_000; // 3 minutes
const MIN_ISI_MS = 2_000;
const MAX_ISI_MS = 10_000;
const NO_TAP_MS = 3_000; // stimulus with no response -> a lapse
const LAPSE_RT = 500;
const EYES_OPEN_EAR = 0.15;

interface Trial {
  rt: number;
  verified: boolean;
}

interface Props {
  config: ExerciseConfig;
  onExit: (result: SessionResult) => void;
}

export function VigilanceSession({ config, onExit }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const rafRef = useRef(0);
  const lastTsRef = useRef(0);

  const faceOkRef = useRef(false);
  const trialsRef = useRef<Trial[]>([]);
  const falseStartsRef = useRef(0);
  const startTsRef = useRef(-1);
  const stimActiveRef = useRef(false);
  const stimTsRef = useRef(0);
  const nextTimerRef = useRef<number | null>(null);
  const noTapTimerRef = useRef<number | null>(null);
  const endedRef = useRef(false);
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;

  const [camError, setCamError] = useState<string | null>(null);
  const [display, setDisplay] = useState<'waiting' | 'stimulus'>('waiting');
  const [stimMs, setStimMs] = useState(0);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [verified, setVerified] = useState(true);
  const [remainingS, setRemainingS] = useState(DURATION_MS / 1000);

  const { status, error, detect } = useFaceLandmarker(true);

  const clearTimers = useCallback(() => {
    if (nextTimerRef.current !== null) clearTimeout(nextTimerRef.current);
    if (noTapTimerRef.current !== null) clearTimeout(noTapTimerRef.current);
    nextTimerRef.current = null;
    noTapTimerRef.current = null;
  }, []);

  const finish = useCallback(() => {
    if (endedRef.current) return;
    endedRef.current = true;
    clearTimers();
    cancelAnimationFrame(rafRef.current);

    const verifiedTrials = trialsRef.current.filter((t) => t.verified);
    const rts = verifiedTrials.map((t) => t.rt).sort((a, b) => a - b);
    const lapses = verifiedTrials.filter((t) => t.rt > LAPSE_RT).length;
    const falseStarts = falseStartsRef.current;

    let median = 0;
    if (rts.length) {
      const mid = Math.floor(rts.length / 2);
      median =
        rts.length % 2 ? rts[mid] : Math.round((rts[mid - 1] + rts[mid]) / 2);
    }

    // 100 at <=250ms scaling to 0 at >=600ms, minus 5/lapse, minus 5/false start
    const base = Math.max(0, Math.min(100, ((600 - median) / (600 - 250)) * 100));
    const form = Math.max(0, Math.round(base - 5 * lapses - 5 * falseStarts));

    onExitRef.current({
      exerciseId: config.id,
      title: config.title,
      metric: 'rt',
      value: median,
      avgForm: form,
      lapses,
      falseStarts,
      voided: verifiedTrials.length === 0,
    });
  }, [clearTimers, config.id, config.title]);

  const scheduleNext = useCallback(() => {
    if (endedRef.current) return;
    const delay = MIN_ISI_MS + Math.random() * (MAX_ISI_MS - MIN_ISI_MS);
    nextTimerRef.current = window.setTimeout(() => {
      if (endedRef.current) return;
      stimActiveRef.current = true;
      stimTsRef.current = performance.now();
      setStimMs(0);
      setDisplay('stimulus');
      noTapTimerRef.current = window.setTimeout(() => {
        // no response in time -> a lapse
        if (!stimActiveRef.current) return;
        stimActiveRef.current = false;
        trialsRef.current.push({ rt: NO_TAP_MS, verified: faceOkRef.current });
        setFeedback('TOO SLOW — LAPSE');
        setDisplay('waiting');
        scheduleNext();
      }, NO_TAP_MS);
    }, delay);
  }, []);

  // ── camera ─────────────────────────────────────────────────────────────
  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    (async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'user' }, width: { ideal: 1280 } },
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

  // ── verification loop + stimulus counter + duration ────────────────────
  useEffect(() => {
    if (status !== 'ready') return;
    const video = videoRef.current;
    if (!video) return;

    startTsRef.current = performance.now();
    scheduleNext();

    const loop = () => {
      rafRef.current = requestAnimationFrame(loop);
      if (video.readyState < 2 || video.videoWidth === 0) return;

      let ts = performance.now();
      if (ts <= lastTsRef.current) ts = lastTsRef.current + 1;
      lastTsRef.current = ts;

      const lms = detect(video, ts);
      const ok = !!lms && facePresent(lms) && meanEAR(lms) > EYES_OPEN_EAR;
      faceOkRef.current = ok;
      setVerified((prev) => (prev === ok ? prev : ok));

      if (stimActiveRef.current) {
        setStimMs(Math.round(ts - stimTsRef.current));
      }

      const elapsed = ts - startTsRef.current;
      setRemainingS(Math.max(0, Math.ceil((DURATION_MS - elapsed) / 1000)));
      if (elapsed >= DURATION_MS) finish();
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(rafRef.current);
      clearTimers();
    };
  }, [status, detect, scheduleNext, finish, clearTimers]);

  // ── tap handling ───────────────────────────────────────────────────────
  const onTap = useCallback(() => {
    void audioSignals.unlock();
    if (endedRef.current) return;

    if (stimActiveRef.current) {
      const rt = Math.round(performance.now() - stimTsRef.current);
      if (noTapTimerRef.current !== null) clearTimeout(noTapTimerRef.current);
      stimActiveRef.current = false;
      const v = faceOkRef.current;
      trialsRef.current.push({ rt, verified: v });
      setFeedback(v ? `${rt} MS` : `${rt} MS — UNVERIFIED`);
      setDisplay('waiting');
      audioSignals.tick();
      scheduleNext();
    } else {
      // tapped with no stimulus on screen
      falseStartsRef.current += 1;
      setFeedback('FALSE START');
      audioSignals.buzz();
    }
  }, [scheduleNext]);

  return (
    <div
      className="relative flex h-full w-full select-none flex-col items-center justify-center overflow-hidden bg-void"
      onPointerDown={onTap}
    >
      <video ref={videoRef} className="hidden" playsInline muted />

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

      {status === 'ready' && !camError && display === 'stimulus' && (
        <div
          className="numerals leading-none text-earn"
          style={{ fontSize: 'min(28vh, 40vw)' }}
        >
          {stimMs}
        </div>
      )}

      {status === 'ready' && !camError && display === 'waiting' && (
        <div className="flex flex-col items-center">
          <p className="numerals text-sm tracking-[0.5em] text-bone/25">WAIT</p>
          {feedback && (
            <p
              className={
                'numerals mt-6 text-2xl tracking-widest ' +
                (feedback.includes('FALSE') || feedback.includes('LAPSE')
                  ? 'text-fault'
                  : 'text-bone/70')
              }
            >
              {feedback}
            </p>
          )}
        </div>
      )}

      {/* top status strip */}
      {status === 'ready' && !camError && (
        <div className="absolute inset-x-0 top-3 flex items-center justify-between px-4">
          <span className="numerals text-[11px] tracking-widest text-bone/30">
            {formatMMSS(remainingS)}
          </span>
          <span
            className={
              'numerals text-[11px] tracking-widest ' +
              (verified ? 'text-bone/25' : 'text-fault')
            }
          >
            {verified ? 'VERIFIED' : 'EYES NOT VERIFIED'}
          </span>
        </div>
      )}

      {/* faint early-end escape (kept for testing the 3-min task) */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          finish();
        }}
        onPointerDown={(e) => e.stopPropagation()}
        className="numerals absolute bottom-4 left-1/2 -translate-x-1/2 px-3 py-2 text-[10px] tracking-[0.3em] text-bone/20"
      >
        END EARLY
      </button>
    </div>
  );
}

function formatMMSS(totalS: number): string {
  const m = Math.floor(totalS / 60);
  const s = totalS % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
