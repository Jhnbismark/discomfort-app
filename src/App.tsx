import { useEffect, useState } from 'react';
import { PushupSession } from './screens/PushupSession';
import { audioSignals } from './audio/AudioSignals';

type Screen = 'home' | 'presession' | 'session' | 'result';

interface Result {
  count: number;
  avgForm: number;
}

export function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [result, setResult] = useState<Result | null>(null);

  return (
    <div className="mx-auto h-full max-w-md">
      {screen === 'home' && <Home onStart={() => setScreen('presession')} />}
      {screen === 'presession' && (
        <PreSession onGo={() => setScreen('session')} onBack={() => setScreen('home')} />
      )}
      {screen === 'session' && (
        <PushupSession
          onExit={(r) => {
            setResult(r);
            setScreen('result');
          }}
        />
      )}
      {screen === 'result' && result && (
        <ResultScreen result={result} onDone={() => setScreen('home')} />
      )}
    </div>
  );
}

// ── HOME ───────────────────────────────────────────────────────────────
function Home({ onStart }: { onStart: () => void }) {
  return (
    <div className="flex h-full flex-col px-5 py-8">
      <header className="mb-10">
        <h1 className="numerals text-4xl font-bold tracking-tight text-bone">
          DISCOMFORT
        </h1>
        <p className="mt-2 max-w-xs text-sm leading-snug text-bone/50">
          A rep that isn't seen doesn't exist. Every number is earned on camera.
        </p>
      </header>

      <Section label="BODY">
        <TestButton label="PUSH-UPS" onClick={onStart} />
        <TestButton label="SKIPPING" disabled />
        <TestButton label="PLANK" disabled />
      </Section>

      <Section label="MIND">
        <TestButton label="STILLNESS" disabled />
        <TestButton label="GAZE" disabled />
        <TestButton label="VIGILANCE" disabled />
        <TestButton label="STARE" disabled />
      </Section>

      <div className="mt-auto" />
      <p className="numerals text-center text-[10px] tracking-widest text-bone/30">
        PROCESSED ON DEVICE. NOTHING WATCHES YOU BUT YOU.
      </p>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-8">
      <h2 className="numerals mb-3 text-xs tracking-[0.3em] text-bone/40">
        {label}
      </h2>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  );
}

function TestButton({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={
        'numerals flex items-center justify-between border px-5 py-5 text-left text-2xl font-bold tracking-widest transition-colors ' +
        (disabled
          ? 'cursor-not-allowed border-bone/10 text-bone/20'
          : 'border-bone/40 text-bone hover:border-earn hover:text-earn active:bg-earn active:text-void')
      }
    >
      <span>{label}</span>
      <span className="text-sm tracking-normal opacity-50">
        {disabled ? 'SOON' : '→'}
      </span>
    </button>
  );
}

// ── PRE-SESSION ────────────────────────────────────────────────────────
function PreSession({ onGo, onBack }: { onGo: () => void; onBack: () => void }) {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    if (count === null) return;
    if (count <= 0) {
      // let "GO" register before the session takes over
      const t = setTimeout(onGo, 400);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setCount((c) => (c === null ? null : c - 1)), 1000);
    return () => clearTimeout(t);
  }, [count, onGo]);

  if (count !== null) {
    return (
      <div className="flex h-full items-center justify-center">
        <span
          className="numerals leading-none text-earn"
          style={{ fontSize: '50vh' }}
        >
          {count === 0 ? 'GO' : count}
        </span>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col px-6 py-10">
      <button
        onClick={onBack}
        className="numerals mb-8 self-start text-xs tracking-widest text-bone/50"
      >
        ← BACK
      </button>
      <h1 className="numerals text-3xl font-bold tracking-widest text-bone">
        PUSH-UPS
      </h1>

      <div className="mt-10 space-y-6 text-bone/80">
        <PlacementRow n="01" text="CAMERA SIDE-ON TO YOUR BODY." />
        <PlacementRow n="02" text="PHONE 2–3 METRES AWAY, ON THE FLOOR." />
        <PlacementRow n="03" text="FULL BODY IN FRAME: HANDS TO FEET." />
        <PlacementRow n="04" text="AUDIO IS PRIMARY. TURN UP THE VOLUME." />
      </div>

      <div className="mt-8 border border-fault/40 p-4">
        <p className="text-sm leading-snug text-fault">
          HARD RULE: A REP THAT DOESN'T BREAK 100° AT THE ELBOW IS NOT COUNTED.
          NO PARTIAL CREDIT.
        </p>
      </div>

      <div className="mt-auto" />
      <button
        onClick={() => {
          // this tap is the user's last gesture before walking away —
          // unlock the AudioContext here so FAR MODE ticks are audible
          void audioSignals.unlock();
          setCount(3);
        }}
        className="numerals w-full border-2 border-earn py-6 text-2xl font-bold tracking-[0.3em] text-earn active:bg-earn active:text-void"
      >
        BEGIN
      </button>
    </div>
  );
}

function PlacementRow({ n, text }: { n: string; text: string }) {
  return (
    <div className="flex items-start gap-4">
      <span className="numerals text-sm text-earn">{n}</span>
      <span className="numerals text-sm tracking-wide">{text}</span>
    </div>
  );
}

// ── RESULT ─────────────────────────────────────────────────────────────
function ResultScreen({
  result,
  onDone,
}: {
  result: Result;
  onDone: () => void;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6">
      <div
        className="numerals leading-none text-earn"
        style={{ fontSize: '32vh' }}
      >
        {result.count}
      </div>
      <div className="numerals mt-2 text-xl tracking-[0.4em] text-bone/70">
        VERIFIED
      </div>

      <div className="mt-12 flex w-full justify-center gap-12">
        <Stat label="AVG FORM" value={String(result.avgForm)} />
        <Stat label="REPS" value={String(result.count)} />
      </div>

      <button
        onClick={onDone}
        className="numerals mt-16 w-full border-2 border-bone/40 py-6 text-xl font-bold tracking-[0.3em] text-bone active:bg-bone active:text-void"
      >
        DONE
      </button>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center">
      <div className="numerals text-4xl text-bone">{value}</div>
      <div className="numerals mt-1 text-[10px] tracking-widest text-bone/40">
        {label}
      </div>
    </div>
  );
}
