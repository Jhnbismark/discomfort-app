import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { EXERCISES, type ExerciseId } from '../exercises';
import { formatClock } from './Session';
import { formGrade } from '../lib/formGrade';

/** LOG — the signed-in user's own session history, newest first. Every
 *  attempt is listed, including voids: the ledger doesn't forget. */

interface LogRow {
  id: string;
  exercise_id: string;
  metric: 'count' | 'clock' | 'rt';
  value: number;
  form_score: number;
  voided: boolean;
  created_at: string;
}

interface Props {
  userId: string | null;
  onBack: () => void;
  onIdentify: () => void;
}

export function Log({ userId, onBack, onIdentify }: Props) {
  const [rows, setRows] = useState<LogRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void supabase
      .from('sessions')
      .select('id, exercise_id, metric, value, form_score, voided, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(100)
      .then(({ data, error: err }) => {
        if (cancelled) return;
        if (err) setError(err.message.toUpperCase());
        else setRows((data as LogRow[]) ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return (
    <div className="screen-in flex h-full flex-col px-5 py-8">
      <button
        onClick={onBack}
        className="numerals mb-6 self-start text-xs tracking-widest text-bone/50"
      >
        ← BACK
      </button>
      <h1 className="numerals text-3xl font-bold tracking-widest text-bone">
        LOG
      </h1>

      {!userId && (
        <div className="mt-12 space-y-6">
          <p className="numerals text-sm tracking-wide text-bone/70">
            THE LOG ONLY EXISTS FOR THE IDENTIFIED.
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
        <div className="mt-6 flex-1 overflow-y-auto">
          {error && (
            <p className="numerals text-xs tracking-widest text-fault">
              {error}
            </p>
          )}
          {!error && rows === null && (
            <p className="numerals text-xs tracking-widest text-bone/40">
              LOADING…
            </p>
          )}
          {!error && rows !== null && rows.length === 0 && (
            <p className="numerals text-xs tracking-widest text-bone/40">
              NOTHING VERIFIED YET. THE LOG STARTS WHEN YOU DO.
            </p>
          )}
          {(rows ?? []).map((r) => (
            <div
              key={r.id}
              className="flex items-center justify-between border-b border-bone/10 py-3"
            >
              <div>
                <div
                  className={
                    'numerals text-base font-bold tracking-[0.15em] ' +
                    (r.voided ? 'text-bone/30' : 'text-bone')
                  }
                >
                  {EXERCISES[r.exercise_id as ExerciseId]?.title ??
                    r.exercise_id.toUpperCase()}
                </div>
                <div className="numerals mt-0.5 text-[10px] tracking-widest text-bone/30">
                  {stamp(r.created_at)}
                </div>
              </div>
              <div className="text-right">
                {r.voided ? (
                  <div className="numerals text-base font-bold tracking-widest text-fault">
                    VOID
                  </div>
                ) : (
                  <>
                    <div className="numerals text-base text-earn">
                      {formatValue(r)}
                    </div>
                    {r.metric !== 'rt' && r.exercise_id !== 'stare' && (
                      <div
                        className={
                          'numerals text-[9px] tracking-widest ' +
                          formGrade(r.form_score).cls
                        }
                      >
                        FORM {r.form_score} · {formGrade(r.form_score).word}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function formatValue(r: LogRow): string {
  if (r.metric === 'clock') return formatClock(r.value);
  if (r.metric === 'rt') return `${r.value} MS`;
  return String(r.value);
}

function stamp(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
