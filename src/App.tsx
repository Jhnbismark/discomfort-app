import { useEffect, useState } from 'react';
import { Session, formatClock, type SessionResult } from './screens/Session';
import { NearSession } from './screens/NearSession';
import { VigilanceSession } from './screens/VigilanceSession';
import { Identify } from './screens/Identify';
import { Ranks } from './screens/Ranks';
import { EXERCISES, type ExerciseConfig, type ExerciseId } from './exercises';
import { audioSignals } from './audio/AudioSignals';
import { supabase } from './lib/supabase';
import { useAuth } from './lib/useAuth';

type Screen =
  | 'home'
  | 'presession'
  | 'session'
  | 'result'
  | 'identify'
  | 'ranks';

/** whether the latest result made it to the cloud ledger */
export type SaveState = 'off' | 'saving' | 'saved' | 'error';

export function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [selected, setSelected] = useState<ExerciseConfig | null>(null);
  const [result, setResult] = useState<SessionResult | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('off');
  const { session, profile, profileLoaded, setProfile } = useAuth();

  return (
    <div className="mx-auto h-full max-w-md">
      {screen === 'home' && (
        <Home
          onPick={(id) => {
            setSelected(EXERCISES[id]);
            setScreen('presession');
          }}
          onRanks={() => setScreen('ranks')}
          onIdentify={() => setScreen('identify')}
          identityLabel={
            !profileLoaded
              ? '…'
              : profile
                ? profile.handle
                : session
                  ? 'CLAIM HANDLE'
                  : 'IDENTIFY'
          }
          identityUrgent={!!session && profileLoaded && !profile}
        />
      )}
      {screen === 'identify' && (
        <Identify
          session={session}
          profile={profile}
          onProfileClaimed={(p) => setProfile(p)}
          onBack={() => setScreen('home')}
        />
      )}
      {screen === 'ranks' && (
        <Ranks
          userId={session?.user.id ?? null}
          onBack={() => setScreen('home')}
          onIdentify={() => setScreen('identify')}
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
        (() => {
          const onExit = (r: SessionResult) => {
            setResult(r);
            setScreen('result');
            if (session) {
              setSaveState('saving');
              void supabase
                .from('sessions')
                .insert({
                  user_id: session.user.id,
                  exercise_id: r.exerciseId,
                  metric: r.metric,
                  value: r.value,
                  form_score: r.avgForm,
                  lapses: r.lapses ?? null,
                  false_starts: r.falseStarts ?? null,
                  voided: r.voided ?? false,
                })
                .then(({ error }) => setSaveState(error ? 'error' : 'saved'));
            } else {
              setSaveState('off');
            }
          };
          if (selected.interaction === 'pvt')
            return <VigilanceSession config={selected} onExit={onExit} />;
          if (selected.mode === 'near')
            return <NearSession config={selected} onExit={onExit} />;
          return <Session config={selected} onExit={onExit} />;
        })()}
      {screen === 'result' && result && (
        <ResultScreen
          result={result}
          saveState={saveState}
          onDone={() => setScreen('home')}
        />
      )}
    </div>
  );
}

// ── HOME ───────────────────────────────────────────────────────────────
function Home({
  onPick,
  onRanks,
  onIdentify,
  identityLabel,
  identityUrgent,
}: {
  onPick: (id: ExerciseId) => void;
  onRanks: () => void;
  onIdentify: () => void;
  identityLabel: string;
  identityUrgent: boolean;
}) {
  return (
    <div className="flex h-full flex-col px-5 py-8">
      <header className="mb-10">
        <div className="flex items-start justify-between">
          <h1 className="numerals text-4xl font-bold tracking-tight text-bone">
            DISCOMFORT
          </h1>
          <button
            onClick={onIdentify}
            className={
              'numerals border px-3 py-2 text-[11px] tracking-widest ' +
              (identityUrgent
                ? 'border-earn text-earn'
                : 'border-bone/30 text-bone/60')
            }
          >
            {identityLabel}
          </button>
        </div>
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
        <TestButton label="GAZE" onClick={() => onPick('gaze')} />
        <TestButton label="VIGILANCE" onClick={() => onPick('vigilance')} />
        <TestButton label="STARE" onClick={() => onPick('stare')} />
      </Section>

      <Section label="LEDGER">
        <TestButton label="RANKS" onClick={onRanks} />
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
function SaveLine({ saveState }: { saveState: SaveState }) {
  const text =
    saveState === 'saved'
      ? 'SAVED TO THE LEDGER'
      : saveState === 'saving'
        ? 'SAVING…'
        : saveState === 'error'
          ? 'SAVE FAILED — RESULT KEPT LOCALLY ONLY'
          : 'NOT IDENTIFIED — NOT SAVED';
  return (
    <p
      className={
        'numerals mt-8 text-center text-[10px] tracking-[0.3em] ' +
        (saveState === 'saved'
          ? 'text-earn/70'
          : saveState === 'error'
            ? 'text-fault'
            : 'text-bone/30')
      }
    >
      {text}
    </p>
  );
}

function ResultScreen({
  result,
  saveState,
  onDone,
}: {
  result: SessionResult;
  saveState: SaveState;
  onDone: () => void;
}) {
  const isClock = result.metric === 'clock';
  const isRt = result.metric === 'rt';
  const big = isClock ? formatClock(result.value) : String(result.value);

  // voided attempt (STARE face lost / PVT no verified taps): no valid result
  if (result.voided) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6">
        <div className="numerals mb-4 text-sm tracking-[0.4em] text-bone/40">
          {result.title}
        </div>
        <div className="numerals text-5xl font-bold tracking-widest text-fault">
          VOID
        </div>
        <div className="numerals mt-3 max-w-xs text-center text-sm tracking-[0.3em] text-bone/50">
          {isRt ? 'NO VERIFIED TAPS — EYES NOT SEEN' : 'FACE LOST — NOTHING VERIFIED'}
        </div>
        <SaveLine saveState={saveState} />
        <button
          onClick={onDone}
          className="numerals mt-6 w-full border-2 border-bone/40 py-6 text-xl font-bold tracking-[0.3em] text-bone active:bg-bone active:text-void"
        >
          DONE
        </button>
      </div>
    );
  }

  // PVT reaction-time result (lower wins)
  if (isRt) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6">
        <div className="numerals mb-4 text-sm tracking-[0.4em] text-bone/40">
          {result.title}
        </div>
        <div
          className="numerals whitespace-nowrap px-2 leading-none text-earn"
          style={{
            fontSize: `min(26vh, ${Math.round((150 / Math.max(String(result.value).length, 1)) * 10) / 10}vw)`,
          }}
        >
          {result.value}
        </div>
        <div className="numerals mt-2 text-lg tracking-[0.4em] text-bone/70">
          MS MEDIAN · LOWER WINS
        </div>
        <div className="mt-12 flex w-full justify-center gap-10">
          <Stat label="LAPSES" value={String(result.lapses ?? 0)} />
          <Stat label="FALSE STARTS" value={String(result.falseStarts ?? 0)} />
          <Stat label="SCORE" value={String(result.avgForm)} />
        </div>
        <SaveLine saveState={saveState} />
        <button
          onClick={onDone}
          className="numerals mt-6 w-full border-2 border-bone/40 py-6 text-xl font-bold tracking-[0.3em] text-bone active:bg-bone active:text-void"
        >
          DONE
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col items-center justify-center px-6">
      <div className="numerals mb-4 text-sm tracking-[0.4em] text-bone/40">
        {result.title}
      </div>
      {result.note && (
        <div className="numerals mb-3 text-3xl font-bold tracking-[0.3em] text-fault">
          {result.note}
        </div>
      )}
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
        {result.exerciseId === 'stare' ? (
          <Stat label="HELD" value={formatClock(result.value)} />
        ) : (
          <>
            <Stat label="AVG FORM" value={String(result.avgForm)} />
            <Stat
              label={isClock ? 'HOLD' : 'REPS'}
              value={isClock ? formatClock(result.value) : String(result.value)}
            />
          </>
        )}
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
