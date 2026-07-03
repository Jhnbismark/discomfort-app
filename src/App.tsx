import { useEffect, useState } from 'react';
import { Session, formatClock, type SessionResult } from './screens/Session';
import { NearSession } from './screens/NearSession';
import { EXERCISES, type ExerciseConfig, type ExerciseId } from './exercises';
import { audioSignals } from './audio/AudioSignals';

type Screen = 'home' | 'presession' | 'session' | 'result';

export function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [selected, setSelected] = useState<ExerciseConfig | null>(null);
  const [result, setResult] = useState<SessionResult | null>(null);

  return (
    <div className="mx-auto h-full max-w-md">
      {screen === 'home' && (
        <Home
          onPick={(id) => {
            setSelected(EXERCISES[id]);
            setScreen('presession');
          }}
        />
      )}
      {screen === 'presession' && selected && (
        <PreSession
          config={selected}
          onGo={() => setScreen('session')}
          onBack={() => setScreen('home')}
        />
      )}
      {screen === 'session' &&
        selected &&
        (selected.mode === 'near' ? (
          <NearSession
            config={selected}
            onExit={(r) => {
              setResult(r);
              setScreen('result');
            }}
          />
        ) : (
          <Session
            config={selected}
            onExit={(r) => {
              setResult(r);
              setScreen('result');
            }}
          />
        ))}
      {screen === 'result' && result && (
        <ResultScreen result={result} onDone={() => setScreen('home')} />
      )}
    </div>
  );
}

// ── HOME ───────────────────────────────────────────────────────────────
function Home({ onPick }: { onPick: (id: ExerciseId) => void }) {
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
        <TestButton label="PUSH-UPS" onClick={() => onPick('pushup')} />
        <TestButton label="SKIPPING" onClick={() => onPick('skipping')} />
        <TestButton label="PLANK" onClick={() => onPick('plank')} />
      </Section>

      <Section label="MIND">
        <TestButton label="STILLNESS" onClick={() => onPick('stillness')} />
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
function PreSession({
  config,
  onGo,
  onBack,
}: {
  config: ExerciseConfig;
  onGo: () => void;
  onBack: () => void;
}) {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    if (count === null) return;
    if (count <= 0) {
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
        {config.title}
      </h1>

      <div className="mt-10 space-y-6 text-bone/80">
        {config.placement.map((step) => (
          <div key={step.n} className="flex items-start gap-4">
            <span className="numerals text-sm text-earn">{step.n}</span>
            <span className="numerals text-sm tracking-wide">{step.text}</span>
          </div>
        ))}
      </div>

      {config.hardRule && (
        <div className="mt-8 border border-fault/40 p-4">
          <p className="text-sm leading-snug text-fault">
            HARD RULE: {config.hardRule}
          </p>
        </div>
      )}

      <div className="mt-auto" />
      <button
        onClick={() => {
          // last gesture before walking away — unlock the AudioContext here
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

// ── RESULT ─────────────────────────────────────────────────────────────
function ResultScreen({
  result,
  onDone,
}: {
  result: SessionResult;
  onDone: () => void;
}) {
  const isClock = result.metric === 'clock';
  const big = isClock ? formatClock(result.value) : String(result.value);

  return (
    <div className="flex h-full flex-col items-center justify-center px-6">
      <div className="numerals mb-4 text-sm tracking-[0.4em] text-bone/40">
        {result.title}
      </div>
      <div
        className="numerals whitespace-nowrap px-2 leading-none text-earn"
        style={{
          fontSize: `min(${isClock ? 22 : 32}vh, ${Math.round((150 / Math.max(big.length, 1)) * 10) / 10}vw)`,
        }}
      >
        {big}
      </div>
      <div className="numerals mt-2 text-xl tracking-[0.4em] text-bone/70">
        {isClock ? 'VERIFIED HOLD' : 'VERIFIED'}
      </div>

      <div className="mt-12 flex w-full justify-center gap-12">
        <Stat label="AVG FORM" value={String(result.avgForm)} />
        <Stat
          label={isClock ? 'HOLD' : 'REPS'}
          value={isClock ? formatClock(result.value) : String(result.value)}
        />
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
