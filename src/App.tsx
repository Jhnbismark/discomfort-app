import { useEffect, useState } from 'react';
import { Session, formatClock, type SessionResult } from './screens/Session';
import { NearSession } from './screens/NearSession';
import { VigilanceSession } from './screens/VigilanceSession';
import { Identify } from './screens/Identify';
import { Ranks } from './screens/Ranks';
import { Wagers } from './screens/Wagers';
import { EXERCISES, type ExerciseConfig, type ExerciseId } from './exercises';
import { audioSignals } from './audio/AudioSignals';
import { supabase, type WagerSubmitResult } from './lib/supabase';
import { useAuth } from './lib/useAuth';
import { shareReceipt } from './lib/receipt';
import { PlacementDiagram } from './screens/PlacementDiagram';

type Screen =
  | 'home'
  | 'presession'
  | 'session'
  | 'result'
  | 'identify'
  | 'ranks'
  | 'wagers';

/** whether the latest result made it to the cloud ledger */
export type SaveState = 'off' | 'saving' | 'saved' | 'error';

export function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [selected, setSelected] = useState<ExerciseConfig | null>(null);
  const [result, setResult] = useState<SessionResult | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('off');
  // when a session was started from a wager's FIGHT button, its id rides along
  const [fightWagerId, setFightWagerId] = useState<string | null>(null);
  const [wagerNote, setWagerNote] = useState<string | null>(null);
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
          onWagers={() => setScreen('wagers')}
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
      {screen === 'wagers' && (
        <Wagers
          userId={session?.user.id ?? ''}
          hasProfile={!!session && !!profile}
          onBack={() => setScreen('home')}
          onIdentify={() => setScreen('identify')}
          onFight={(exerciseId, wagerId) => {
            setSelected(EXERCISES[exerciseId]);
            setFightWagerId(wagerId);
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
        (() => {
          const onExit = (r: SessionResult) => {
            setResult(r);
            setScreen('result');
            const wagerId = fightWagerId;
            setFightWagerId(null); // one attempt per FIGHT tap, win or void
            if (!session) {
              setSaveState('off');
              setWagerNote(null);
              return;
            }
            const uid = session.user.id;
            setSaveState('saving');
            setWagerNote(
              wagerId
                ? r.voided
                  ? 'WAGER: VOID ATTEMPTS DON’T COUNT — GO AGAIN'
                  : 'WAGER: SUBMITTING ENTRY…'
                : null
            );
            void (async () => {
              const { data, error } = await supabase
                .from('sessions')
                .insert({
                  user_id: uid,
                  exercise_id: r.exerciseId,
                  metric: r.metric,
                  value: r.value,
                  form_score: r.avgForm,
                  lapses: r.lapses ?? null,
                  false_starts: r.falseStarts ?? null,
                  voided: r.voided ?? false,
                })
                .select('id')
                .single();
              setSaveState(error ? 'error' : 'saved');
              if (!wagerId || r.voided) return;
              if (error || !data) {
                setWagerNote('WAGER: ENTRY NOT SUBMITTED — SAVE FAILED');
                return;
              }
              const { data: wr, error: werr } = await supabase.rpc(
                'submit_wager_entry',
                { p_wager_id: wagerId, p_session_id: data.id }
              );
              if (werr) {
                setWagerNote('WAGER: ' + werr.message.toUpperCase());
                return;
              }
              const res = wr as WagerSubmitResult;
              if (res.status !== 'resolved') {
                setWagerNote('WAGER: ENTRY IN — WAITING ON OPPONENT');
                return;
              }
              const myDelta =
                (res.elo_delta ?? 0) * (res.challenger === uid ? 1 : -1);
              setWagerNote(
                res.winner === null
                  ? 'WAGER: DRAW'
                  : res.winner === uid
                    ? `WAGER WON — RATING +${myDelta}`
                    : `WAGER LOST — RATING ${myDelta}`
              );
            })();
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
          wagerNote={wagerNote}
          handle={profile?.handle ?? null}
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
  onWagers,
  onIdentify,
  identityLabel,
  identityUrgent,
}: {
  onPick: (id: ExerciseId) => void;
  onRanks: () => void;
  onWagers: () => void;
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
        <TestButton label="WAGERS" onClick={onWagers} />
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

      <div className="mt-6">
        <PlacementDiagram kind={config.diagram} />
      </div>

      <div className="mt-8 space-y-6 text-bone/80">
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
function SaveLine({
  saveState,
  wagerNote,
}: {
  saveState: SaveState;
  wagerNote: string | null;
}) {
  const text =
    saveState === 'saved'
      ? 'SAVED TO THE LEDGER'
      : saveState === 'saving'
        ? 'SAVING…'
        : saveState === 'error'
          ? 'SAVE FAILED — RESULT KEPT LOCALLY ONLY'
          : 'NOT IDENTIFIED — NOT SAVED';
  return (
    <div className="mt-8 space-y-2">
      <p
        className={
          'numerals text-center text-[10px] tracking-[0.3em] ' +
          (saveState === 'saved'
            ? 'text-earn/70'
            : saveState === 'error'
              ? 'text-fault'
              : 'text-bone/30')
        }
      >
        {text}
      </p>
      {wagerNote && (
        <p
          className={
            'numerals text-center text-[11px] font-bold tracking-[0.3em] ' +
            (wagerNote.includes('WON')
              ? 'text-earn'
              : wagerNote.includes('LOST') || wagerNote.includes('VOID')
                ? 'text-fault'
                : 'text-bone/60')
          }
        >
          {wagerNote}
        </p>
      )}
    </div>
  );
}

function ResultActions({
  result,
  handle,
  saveState,
  wagerNote,
  onDone,
}: {
  result: SessionResult;
  handle: string | null;
  saveState: SaveState;
  wagerNote: string | null;
  onDone: () => void;
}) {
  const [sharing, setSharing] = useState(false);
  return (
    <div className="w-full">
      <SaveLine saveState={saveState} wagerNote={wagerNote} />
      <div className="mt-6 flex w-full gap-3">
        <button
          onClick={() => {
            setSharing(true);
            void shareReceipt(result, handle).finally(() => setSharing(false));
          }}
          disabled={sharing}
          className="numerals flex-1 border-2 border-earn py-6 text-xl font-bold tracking-[0.3em] text-earn active:bg-earn active:text-void"
        >
          {sharing ? '…' : 'RECEIPT'}
        </button>
        <button
          onClick={onDone}
          className="numerals flex-1 border-2 border-bone/40 py-6 text-xl font-bold tracking-[0.3em] text-bone active:bg-bone active:text-void"
        >
          DONE
        </button>
      </div>
    </div>
  );
}

function ResultScreen({
  result,
  saveState,
  wagerNote,
  handle,
  onDone,
}: {
  result: SessionResult;
  saveState: SaveState;
  wagerNote: string | null;
  handle: string | null;
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
        <ResultActions
          result={result}
          handle={handle}
          saveState={saveState}
          wagerNote={wagerNote}
          onDone={onDone}
        />
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
        <ResultActions
          result={result}
          handle={handle}
          saveState={saveState}
          wagerNote={wagerNote}
          onDone={onDone}
        />
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
