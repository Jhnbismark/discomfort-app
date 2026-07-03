import { useEffect, useMemo, useState } from 'react';
import { supabase, type Profile, type RankRow } from '../lib/supabase';
import { EXERCISES, type ExerciseId } from '../exercises';
import { formatClock } from './Session';

/** RANKS — best verified result per identity per test. VIGILANCE is median
 *  reaction time (lower wins); everything else is reps or hold time (higher
 *  wins). Reads the `ranks` view; RLS only opens it to the signed-in. */

const ORDER: ExerciseId[] = [
  'pushup',
  'skipping',
  'plank',
  'stillness',
  'gaze',
  'vigilance',
  'stare',
];

interface Props {
  userId: string | null;
  onBack: () => void;
  onIdentify: () => void;
}

type Tab = ExerciseId | 'rating';

export function Ranks({ userId, onBack, onIdentify }: Props) {
  const [rows, setRows] = useState<RankRow[] | null>(null);
  const [ratings, setRatings] = useState<Profile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('rating');

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void supabase
      .from('ranks')
      .select('*')
      .then(({ data, error: err }) => {
        if (cancelled) return;
        if (err) setError(err.message.toUpperCase());
        else setRows((data as RankRow[]) ?? []);
      });
    void supabase
      .from('profiles')
      .select('id, handle, elo')
      .order('elo', { ascending: false })
      .limit(100)
      .then(({ data }) => {
        if (!cancelled) setRatings((data as Profile[]) ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const board = useMemo(() => {
    if (tab === 'rating' || !rows) return [];
    const config = EXERCISES[tab];
    const filtered = rows.filter((r) => r.exercise_id === tab);
    filtered.sort((a, b) =>
      config.metric === 'rt' ? a.best - b.best : b.best - a.best
    );
    return filtered;
  }, [rows, tab]);

  return (
    <div className="flex h-full flex-col px-5 py-8">
      <button
        onClick={onBack}
        className="numerals mb-6 self-start text-xs tracking-widest text-bone/50"
      >
        ← BACK
      </button>
      <h1 className="numerals text-3xl font-bold tracking-widest text-bone">
        RANKS
      </h1>

      {!userId && (
        <div className="mt-12 space-y-6">
          <p className="numerals text-sm tracking-wide text-bone/70">
            THE RANKS ONLY EXIST FOR THE IDENTIFIED.
          </p>
          <button
            onClick={onIdentify}
            className="numerals w-full border-2 border-earn py-5 text-xl font-bold tracking-[0.3em] text-earn active:bg-earn active:text-void"
          >
            IDENTIFY
          </button>
        </div>
      )}

      {userId && (
        <>
          {/* test tabs */}
          <div className="mt-6 flex flex-wrap gap-2">
            {(['rating', ...ORDER] as Tab[]).map((id) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={
                  'numerals border px-3 py-2 text-[11px] tracking-widest ' +
                  (tab === id
                    ? 'border-earn bg-earn text-void'
                    : 'border-bone/30 text-bone/60')
                }
              >
                {id === 'rating' ? 'RATING' : EXERCISES[id].title}
              </button>
            ))}
          </div>

          <div className="mt-6 flex-1 overflow-y-auto">
            {error && (
              <p className="numerals text-xs tracking-widest text-fault">
                {error}
              </p>
            )}
            {tab === 'rating' &&
              (ratings ?? []).map((p, i) => (
                <div
                  key={p.id}
                  className={
                    'flex items-center justify-between border-b border-bone/10 py-3 ' +
                    (p.id === userId ? 'text-earn' : 'text-bone')
                  }
                >
                  <div className="flex items-center gap-4">
                    <span className="numerals w-8 text-sm text-bone/40">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <span className="numerals text-lg font-bold tracking-[0.15em]">
                      {p.handle}
                    </span>
                  </div>
                  <div className="numerals text-lg">{p.elo}</div>
                </div>
              ))}
            {tab !== 'rating' && !error && rows === null && (
              <p className="numerals text-xs tracking-widest text-bone/40">
                LOADING…
              </p>
            )}
            {tab !== 'rating' && !error && rows !== null && board.length === 0 && (
              <p className="numerals text-xs tracking-widest text-bone/40">
                NO VERIFIED RESULTS YET. BE FIRST.
              </p>
            )}
            {board.map((r, i) => (
              <div
                key={r.user_id}
                className={
                  'flex items-center justify-between border-b border-bone/10 py-3 ' +
                  (r.user_id === userId ? 'text-earn' : 'text-bone')
                }
              >
                <div className="flex items-center gap-4">
                  <span className="numerals w-8 text-sm text-bone/40">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span className="numerals text-lg font-bold tracking-[0.15em]">
                    {r.handle}
                  </span>
                </div>
                <div className="text-right">
                  <div className="numerals text-lg">
                    {formatBest(tab as ExerciseId, r.best)}
                  </div>
                  <div className="numerals text-[9px] tracking-widest text-bone/30">
                    {r.attempts} ATTEMPT{r.attempts === 1 ? '' : 'S'}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function formatBest(id: ExerciseId, best: number): string {
  const metric = EXERCISES[id].metric;
  if (metric === 'clock') return formatClock(best);
  if (metric === 'rt') return `${best} MS`;
  return String(best);
}
