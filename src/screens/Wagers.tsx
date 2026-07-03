import { useCallback, useEffect, useState } from 'react';
import { supabase, type WagerRow } from '../lib/supabase';
import { EXERCISES, type ExerciseId } from '../exercises';
import { formatClock } from './Session';

/** WAGERS — call out another handle on one test. They accept or decline.
 *  Once accepted, each side submits ONE verified attempt (started from the
 *  wager's FIGHT button); when both are in, the wager resolves and both
 *  ratings move by ELO. Realtime: the list refreshes itself when the other
 *  side acts. */

const TESTS: ExerciseId[] = [
  'pushup',
  'skipping',
  'plank',
  'stillness',
  'gaze',
  'vigilance',
  'stare',
];

interface Props {
  userId: string;
  hasProfile: boolean;
  onBack: () => void;
  onIdentify: () => void;
  onFight: (exerciseId: ExerciseId, wagerId: string) => void;
}

export function Wagers({ userId, hasProfile, onBack, onIdentify, onFight }: Props) {
  const [rows, setRows] = useState<WagerRow[] | null>(null);
  const [creating, setCreating] = useState(false);

  const refetch = useCallback(async () => {
    const { data } = await supabase
      .from('wager_board')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);
    setRows((data as WagerRow[]) ?? []);
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  // realtime: any change to a wager you're part of -> refetch the board
  useEffect(() => {
    const ch = supabase
      .channel('wagers-watch')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'wagers' },
        () => void refetch()
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [refetch]);

  return (
    <div className="flex h-full flex-col px-5 py-8">
      <button
        onClick={onBack}
        className="numerals mb-6 self-start text-xs tracking-widest text-bone/50"
      >
        ← BACK
      </button>
      <div className="flex items-center justify-between">
        <h1 className="numerals text-3xl font-bold tracking-widest text-bone">
          WAGERS
        </h1>
        {hasProfile && (
          <button
            onClick={() => setCreating((c) => !c)}
            className={
              'numerals border px-3 py-2 text-[11px] tracking-widest ' +
              (creating
                ? 'border-bone/30 text-bone/60'
                : 'border-earn text-earn')
            }
          >
            {creating ? 'CANCEL' : 'THROW DOWN'}
          </button>
        )}
      </div>

      {!hasProfile && (
        <div className="mt-12 space-y-6">
          <p className="numerals text-sm tracking-wide text-bone/70">
            ONLY THE IDENTIFIED CAN WAGER. STAKE: YOUR RATING.
          </p>
          <button
            onClick={onIdentify}
            className="numerals w-full border-2 border-earn py-5 text-xl font-bold tracking-[0.3em] text-earn active:bg-earn active:text-void"
          >
            IDENTIFY
          </button>
        </div>
      )}

      {hasProfile && creating && (
        <CreateWager
          onCreated={() => {
            setCreating(false);
            void refetch();
          }}
        />
      )}

      {hasProfile && !creating && (
        <div className="mt-6 flex-1 space-y-3 overflow-y-auto">
          {rows === null && (
            <p className="numerals text-xs tracking-widest text-bone/40">
              LOADING…
            </p>
          )}
          {rows !== null && rows.length === 0 && (
            <p className="numerals text-xs tracking-widest text-bone/40">
              NO WAGERS. CALL SOMEONE OUT.
            </p>
          )}
          {rows?.map((w) => (
            <WagerCard
              key={w.id}
              w={w}
              userId={userId}
              onChanged={() => void refetch()}
              onFight={onFight}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CreateWager({ onCreated }: { onCreated: () => void }) {
  const [exercise, setExercise] = useState<ExerciseId>('pushup');
  const [handle, setHandle] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'error'>('idle');
  const [error, setError] = useState('');

  const create = async () => {
    setState('sending');
    const { error: err } = await supabase.rpc('create_wager', {
      p_opponent_handle: handle,
      p_exercise_id: exercise,
    });
    if (err) {
      setError(err.message.toUpperCase());
      setState('error');
    } else {
      onCreated();
    }
  };

  return (
    <div className="mt-6 space-y-5">
      <div>
        <div className="numerals mb-2 text-[10px] tracking-[0.3em] text-bone/40">
          THE TEST
        </div>
        <div className="flex flex-wrap gap-2">
          {TESTS.map((id) => (
            <button
              key={id}
              onClick={() => setExercise(id)}
              className={
                'numerals border px-3 py-2 text-[11px] tracking-widest ' +
                (exercise === id
                  ? 'border-earn bg-earn text-void'
                  : 'border-bone/30 text-bone/60')
              }
            >
              {EXERCISES[id].title}
            </button>
          ))}
        </div>
      </div>
      <div>
        <div className="numerals mb-2 text-[10px] tracking-[0.3em] text-bone/40">
          THE OPPONENT
        </div>
        <input
          type="text"
          autoCapitalize="characters"
          autoComplete="off"
          placeholder="THEIR HANDLE"
          value={handle}
          maxLength={12}
          onChange={(e) =>
            setHandle(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))
          }
          className="numerals w-full border border-bone/40 bg-void px-4 py-4 text-xl font-bold tracking-[0.2em] text-bone placeholder:text-bone/25 focus:border-earn focus:outline-none"
        />
      </div>
      {state === 'error' && (
        <p className="numerals text-xs tracking-widest text-fault">{error}</p>
      )}
      <button
        onClick={() => void create()}
        disabled={handle.length < 3 || state === 'sending'}
        className={
          'numerals w-full border-2 py-5 text-xl font-bold tracking-[0.3em] ' +
          (handle.length < 3 || state === 'sending'
            ? 'border-bone/15 text-bone/25'
            : 'border-earn text-earn active:bg-earn active:text-void')
        }
      >
        {state === 'sending' ? '…' : 'THROW DOWN'}
      </button>
      <p className="numerals text-[10px] leading-relaxed tracking-[0.2em] text-bone/40">
        ONE VERIFIED ATTEMPT EACH. BEST RESULT TAKES RATING POINTS. VOIDED
        ATTEMPTS DON'T COUNT — GO AGAIN.
      </p>
    </div>
  );
}

function WagerCard({
  w,
  userId,
  onChanged,
  onFight,
}: {
  w: WagerRow;
  userId: string;
  onChanged: () => void;
  onFight: (exerciseId: ExerciseId, wagerId: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const iAmChallenger = w.challenger === userId;
  const them = iAmChallenger ? w.opponent_handle : w.challenger_handle;
  const myEntry = iAmChallenger ? w.challenger_session : w.opponent_session;
  const theirEntry = iAmChallenger ? w.opponent_session : w.challenger_session;
  const config = EXERCISES[w.exercise_id as ExerciseId];

  const respond = async (accept: boolean) => {
    setBusy(true);
    await supabase.rpc('respond_wager', { p_wager_id: w.id, p_accept: accept });
    setBusy(false);
    onChanged();
  };

  let statusLine: { text: string; tone: 'earn' | 'fault' | 'dim' };
  if (w.status === 'declined') {
    statusLine = { text: 'DECLINED', tone: 'fault' };
  } else if (w.status === 'resolved') {
    const myDelta = (w.elo_delta ?? 0) * (iAmChallenger ? 1 : -1);
    statusLine =
      w.winner === null
        ? { text: 'DRAW — RATINGS BARELY MOVED', tone: 'dim' }
        : w.winner === userId
          ? { text: `WON +${myDelta}`, tone: 'earn' }
          : { text: `LOST ${myDelta}`, tone: 'fault' };
  } else if (w.status === 'open') {
    statusLine = iAmChallenger
      ? { text: 'WAITING FOR THEM TO ACCEPT', tone: 'dim' }
      : { text: 'YOU HAVE BEEN CALLED OUT', tone: 'earn' };
  } else {
    // accepted
    statusLine = myEntry
      ? { text: 'YOUR ENTRY IS IN — WAITING ON THEM', tone: 'dim' }
      : { text: 'ACTIVE — SUBMIT YOUR ATTEMPT', tone: 'earn' };
  }

  return (
    <div className="border border-bone/20 p-4">
      <div className="flex items-center justify-between">
        <span className="numerals text-sm font-bold tracking-[0.2em] text-bone">
          {config?.title ?? w.exercise_id.toUpperCase()}
        </span>
        <span className="numerals text-[10px] tracking-widest text-bone/40">
          VS {them}
        </span>
      </div>

      <div
        className={
          'numerals mt-2 text-[11px] tracking-[0.2em] ' +
          (statusLine.tone === 'earn'
            ? 'text-earn'
            : statusLine.tone === 'fault'
              ? 'text-fault'
              : 'text-bone/50')
        }
      >
        {statusLine.text}
      </div>

      {w.status === 'resolved' && (
        <div className="numerals mt-2 text-[11px] tracking-widest text-bone/60">
          YOU {fmt(w, iAmChallenger ? w.challenger_value : w.opponent_value)} ·
          THEM {fmt(w, iAmChallenger ? w.opponent_value : w.challenger_value)}
        </div>
      )}

      {w.status === 'open' && !iAmChallenger && (
        <div className="mt-3 flex gap-2">
          <button
            disabled={busy}
            onClick={() => void respond(true)}
            className="numerals flex-1 border-2 border-earn py-3 text-sm font-bold tracking-[0.2em] text-earn active:bg-earn active:text-void"
          >
            ACCEPT
          </button>
          <button
            disabled={busy}
            onClick={() => void respond(false)}
            className="numerals flex-1 border border-fault/60 py-3 text-sm tracking-[0.2em] text-fault/80 active:bg-fault active:text-void"
          >
            DECLINE
          </button>
        </div>
      )}

      {w.status === 'accepted' && !myEntry && (
        <button
          onClick={() => onFight(w.exercise_id as ExerciseId, w.id)}
          className="numerals mt-3 w-full border-2 border-earn py-3 text-sm font-bold tracking-[0.3em] text-earn active:bg-earn active:text-void"
        >
          FIGHT — ONE VERIFIED ATTEMPT
        </button>
      )}

      {w.status === 'accepted' && myEntry && !theirEntry && (
        <div className="numerals mt-2 text-[10px] tracking-widest text-bone/30">
          IT RESOLVES THE MOMENT THEIR ENTRY LANDS.
        </div>
      )}
    </div>
  );
}

function fmt(w: WagerRow, value: number | null): string {
  if (value === null) return '—';
  if (w.metric === 'clock') return formatClock(value);
  if (w.metric === 'rt') return `${value} MS`;
  return String(value);
}
