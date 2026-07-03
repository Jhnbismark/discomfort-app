import { useEffect, useRef, useState, useCallback } from 'react';
import { useFaceLandmarker } from '../pose/useFaceLandmarker';
import { meanEAR, facePresent } from '../pose/faceMath';
import { audioSignals } from '../audio/AudioSignals';
import type { ExerciseConfig } from '../exercises';
import type { SessionResult } from './Session';

/** VIGILANCE — psychomotor vigilance task (PVT). Starts with a FRAMING stage:
 *  visible camera feed, plain instructions, and open-eye calibration (the
 *  eyes-verified check is judged against YOUR calibrated EAR, not a fixed
 *  constant). Then: black screen; a counter appears at random 2–10s intervals;
 *  tap the instant it shows. A small corner feed stays up so you always know
 *  you're in frame. Taps during unverified periods are voided. Lapse = RT >
 *  500ms. False start = tap with no stimulus. Result = median RT (lower wins),
 *  secondary = lapse count. Fixed 3-minute duration. */

const DURATION_MS = 180_000; // 3 minutes
const MIN_ISI_MS = 2_000;
const MAX_ISI_MS = 10_000;
const NO_TAP_MS = 3_000; // stimulus with no response -> a lapse
const LAPSE_RT = 500;
const EYES_OPEN_EAR = 0.15; // fallback floor if calibration fails
const EYES_OPEN_RATIO = 0.6; // eyes closed when EAR < calibrated open × this
const CALIB_SAMPLES = 30; // face frames needed before START unlocks
// face detection is the expensive call — run it at ~7Hz so the rAF loop stays
// free to render the stimulus counter smoothly at display rate
const DETECT_EVERY_MS = 150;

interface Trial {
  rt: number;
  verified: boolean;
}

/** per-trial feedback shown on the WAIT screen. rt set = a tapped result
 *  (shown BIG — it is the result of that trial); note-only = lapse/false start. */
interface Feedback {
  rt?: number;
  note?: string;
  bad: boolean;
  key: number;
}

interface Props {
  config: ExerciseConfig;
  onExit: (result: SessionResult) => void;
}

export function VigilanceSession({ config, onExit }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const rafRef = useRef(0);
  const lastTsRef = useRef(0);

  const stageRef = useRef<'framing' | 'live'>('framing');
  const earSamplesRef = useRef<number[]>([]);
  const earThreshRef = useRef(EYES_OPEN_EAR);

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

  const lastDetectRef = useRef(0);

  const [camError, setCamError] = useState<string | null>(null);
  const [stage, setStage] = useState<'framing' | 'live'>('framing');
  const [calibrated, setCalibrated] = useState(false);
  const [display, setDisplay] = useState<'waiting' | 'stimulus'>('waiting');
  const [stimMs, setStimMs] = useState(0);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [taps, setTaps] = useState(0);
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
        setFeedback({
          note: 'TOO SLOW — LAPSE',
          bad: true,
          key: performance.now(),
        });
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

    const loop = () => {
      rafRef.current = requestAnimationFrame(loop);
      if (video.readyState < 2 || video.videoWidth === 0) return;

      let ts = performance.now();
      if (ts <= lastTsRef.current) ts = lastTsRef.current + 1;
      lastTsRef.current = ts;

      // detection only every DETECT_EVERY_MS — the stimulus counter below
      // must update every displayed frame or it reads as broken
      if (ts - lastDetectRef.current >= DETECT_EVERY_MS) {
        lastDetectRef.current = ts;
        const lms = detect(video, ts);
        const facePres = !!lms && facePresent(lms);

        if (stageRef.current === 'framing') {
          // gather the user's open-eye EAR while they read the instructions
          if (facePres) {
            const samples = earSamplesRef.current;
            samples.push(meanEAR(lms));
            if (samples.length > CALIB_SAMPLES * 2) samples.shift();
            if (samples.length >= CALIB_SAMPLES) setCalibrated(true);
          }
          setVerified((prev) => (prev === facePres ? prev : facePres));
        } else {
          const ok = facePres && meanEAR(lms) > earThreshRef.current;
          faceOkRef.current = ok;
          setVerified((prev) => (prev === ok ? prev : ok));
        }
      }

      if (stageRef.current === 'framing') return;

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
  }, [status, detect, finish, clearTimers]);

  // ── framing -> live ────────────────────────────────────────────────────
  const startTest = useCallback(() => {
    void audioSignals.unlock();
    const samples = earSamplesRef.current;
    if (samples.length >= 10) {
      const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
      earThreshRef.current = Math.max(0.06, mean * EYES_OPEN_RATIO);
    }
    stageRef.current = 'live';
    setStage('live');
    startTsRef.current = performance.now();
    scheduleNext();
  }, [scheduleNext]);

  // ── tap handling ───────────────────────────────────────────────────────
  const onTap = useCallback(() => {
    void audioSignals.unlock();
    if (endedRef.current || stageRef.current !== 'live') return;

    if (stimActiveRef.current) {
      const rt = Math.round(performance.now() - stimTsRef.current);
      if (noTapTimerRef.current !== null) clearTimeout(noTapTimerRef.current);
      stimActiveRef.current = false;
      const v = faceOkRef.current;
      trialsRef.current.push({ rt, verified: v });
      setFeedback({
        rt,
        note: v ? undefined : 'UNVERIFIED — EYES NOT SEEN',
        bad: !v,
        key: performance.now(),
      });
      setTaps((n) => n + 1);
      setDisplay('waiting');
      audioSignals.tick();
      scheduleNext();
    } else {
      // tapped with no stimulus on screen
      falseStartsRef.current += 1;
      setFeedback({ note: 'FALSE START', bad: true, key: performance.now() });
      audioSignals.buzz();
    }
  }, [scheduleNext]);

  const ready = status === 'ready' && !camError;
  const framing = stage === 'framing';

  // feed placement: big while framing; small corner thumbnail during the test
  // so you always know your face is in frame
  const videoClass = framing
    ? 'absolute left-1/2 top-[6vh] h-[30vh] w-[56vw] max-w-[260px] -translate-x-1/2 border border-bone/25 object-cover opacity-80'
    : 'absolute right-3 top-10 h-24 w-[4.5rem] border border-bone/20 object-cover opacity-50';

  return (
    <div
      className="relative flex h-full w-full select-none flex-col items-center justify-center overflow-hidden bg-void"
      onPointerDown={onTap}
    >
      <video
        ref={videoRef}
        className={ready ? videoClass : 'hidden'}
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

      {/* ── FRAMING: face in frame, how to play, calibrate, start ── */}
      {ready && framing && (
        <div className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-4 px-6 pb-8">
          <div
            className={
              'numerals text-sm font-bold tracking-[0.4em] ' +
              (verified ? 'text-earn' : 'text-fault')
            }
          >
            {verified
              ? calibrated
                ? 'EYES CALIBRATED'
                : 'FACE IN FRAME — CALIBRATING…'
              : 'NO FACE DETECTED'}
          </div>
          <div className="space-y-2 self-stretch">
            <Rule n="01" text="THE SCREEN GOES BLACK. WAIT." />
            <Rule n="02" text="A NUMBER APPEARS AT RANDOM. TAP ANYWHERE — FAST." />
            <Rule n="03" text="TAP WITH NO NUMBER ON SCREEN = FALSE START." />
            <Rule n="04" text="OVER 500 MS = LAPSE. EYES MUST STAY OPEN, IN FRAME." />
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              startTest();
            }}
            onPointerDown={(e) => e.stopPropagation()}
            disabled={!calibrated}
            className={
              'numerals w-full border-2 py-5 text-xl font-bold tracking-[0.3em] transition-colors ' +
              (calibrated
                ? 'border-earn text-earn active:bg-earn active:text-void'
                : 'border-bone/15 text-bone/25')
            }
          >
            {calibrated ? 'START — 3 MINUTES' : 'SHOW YOUR FACE'}
          </button>
        </div>
      )}

      {/* ── LIVE ── */}
      {ready && !framing && display === 'stimulus' && (
        <div
          className="numerals leading-none text-earn"
          style={{ fontSize: 'min(28vh, 40vw)' }}
        >
          {stimMs}
        </div>
      )}

      {ready && !framing && display === 'waiting' && (
        <div className="flex flex-col items-center">
          {feedback && feedback.rt !== undefined ? (
            // your reaction time IS the result of that trial — show it big
            <div key={feedback.key} className="count-pop flex flex-col items-center">
              <div
                className={
                  'numerals leading-none ' +
                  (feedback.bad ? 'text-fault' : 'text-earn')
                }
                style={{ fontSize: 'min(18vh, 30vw)' }}
              >
                {feedback.rt}
              </div>
              <div className="numerals mt-2 text-sm tracking-[0.4em] text-bone/60">
                MS{feedback.rt > LAPSE_RT ? ' — LAPSE' : ''}
              </div>
              {feedback.note && (
                <div className="numerals mt-2 text-xs tracking-[0.3em] text-fault">
                  {feedback.note}
                </div>
              )}
            </div>
          ) : feedback ? (
            <p
              key={feedback.key}
              className="count-pop numerals text-2xl tracking-widest text-fault"
            >
              {feedback.note}
            </p>
          ) : null}
          <p className="numerals mt-10 text-sm tracking-[0.5em] text-bone/25">
            WAIT
          </p>
          <p className="numerals mt-3 text-[10px] tracking-[0.3em] text-bone/30">
            TAP THE INSTANT THE NUMBER APPEARS
          </p>
        </div>
      )}

      {/* top status strip */}
      {ready && !framing && (
        <div className="absolute inset-x-0 top-3 flex items-center justify-between px-4">
          <span className="numerals text-[11px] tracking-widest text-bone/30">
            {formatMMSS(remainingS)}
          </span>
          <span className="numerals text-[11px] tracking-widest text-bone/30">
            TAPS {taps}
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
      {!framing && (
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
      )}
    </div>
  );
}

function Rule({ n, text }: { n: string; text: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="numerals text-xs text-earn">{n}</span>
      <span className="numerals text-xs tracking-wide text-bone/70">{text}</span>
    </div>
  );
}

function formatMMSS(totalS: number): string {
  const m = Math.floor(totalS / 60);
  const s = totalS % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
