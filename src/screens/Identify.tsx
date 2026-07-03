import { useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, type Profile } from '../lib/supabase';

/** IDENTIFY — sign in with a magic link, then claim a HANDLE (the name the
 *  leaderboard knows you by). Signed-in-with-handle shows the account +
 *  SIGN OUT. Brutalist: one column, hard borders, no fluff. */

const SITE_URL = 'https://discomfort-app.pages.dev';
const HANDLE_RE = /^[A-Z0-9]{3,12}$/;

interface Props {
  session: Session | null;
  profile: Profile | null;
  onProfileClaimed: (p: Profile) => void;
  onBack: () => void;
}

export function Identify({ session, profile, onProfileClaimed, onBack }: Props) {
  return (
    <div className="flex h-full flex-col px-6 py-10">
      <button
        onClick={onBack}
        className="numerals mb-8 self-start text-xs tracking-widest text-bone/50"
      >
        ← BACK
      </button>
      <h1 className="numerals text-3xl font-bold tracking-widest text-bone">
        IDENTIFY
      </h1>

      {!session && <EmailStep />}
      {session && !profile && (
        <HandleStep userId={session.user.id} onClaimed={onProfileClaimed} />
      )}
      {session && profile && (
        <AccountStep email={session.user.email ?? ''} handle={profile.handle} />
      )}

      <div className="mt-auto" />
      <p className="numerals text-center text-[10px] tracking-widest text-bone/30">
        NO PASSWORDS. NO FRAMES LEAVE YOUR PHONE. ONLY NUMBERS.
      </p>
    </div>
  );
}

function EmailStep() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>(
    'idle'
  );
  const [error, setError] = useState('');

  const send = async () => {
    const addr = email.trim().toLowerCase();
    if (!addr.includes('@')) return;
    setState('sending');
    const { error: err } = await supabase.auth.signInWithOtp({
      email: addr,
      options: { emailRedirectTo: SITE_URL },
    });
    if (err) {
      setError(err.message.toUpperCase());
      setState('error');
    } else {
      setState('sent');
    }
  };

  if (state === 'sent') {
    return (
      <div className="mt-10 space-y-4">
        <p className="numerals text-sm tracking-[0.3em] text-earn">
          LINK SENT.
        </p>
        <p className="numerals text-sm leading-relaxed tracking-wide text-bone/70">
          OPEN THE EMAIL ON THIS PHONE AND TAP THE LINK. YOU LAND BACK HERE,
          SIGNED IN.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-10 space-y-5">
      <p className="numerals text-sm tracking-wide text-bone/70">
        YOUR EMAIL. A ONE-TAP SIGN-IN LINK GETS SENT TO IT.
      </p>
      <input
        type="email"
        inputMode="email"
        autoComplete="email"
        placeholder="YOU@SOMEWHERE.COM"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="numerals w-full border border-bone/40 bg-void px-4 py-4 text-lg tracking-wider text-bone placeholder:text-bone/25 focus:border-earn focus:outline-none"
      />
      {state === 'error' && (
        <p className="numerals text-xs tracking-widest text-fault">{error}</p>
      )}
      <button
        onClick={() => void send()}
        disabled={state === 'sending' || !email.includes('@')}
        className={
          'numerals w-full border-2 py-5 text-xl font-bold tracking-[0.3em] ' +
          (state === 'sending' || !email.includes('@')
            ? 'border-bone/15 text-bone/25'
            : 'border-earn text-earn active:bg-earn active:text-void')
        }
      >
        {state === 'sending' ? 'SENDING…' : 'SEND LINK'}
      </button>
    </div>
  );
}

function HandleStep({
  userId,
  onClaimed,
}: {
  userId: string;
  onClaimed: (p: Profile) => void;
}) {
  const [handle, setHandle] = useState('');
  const [state, setState] = useState<'idle' | 'claiming' | 'error'>('idle');
  const [error, setError] = useState('');

  const valid = HANDLE_RE.test(handle);

  const claim = async () => {
    if (!valid) return;
    setState('claiming');
    const { error: err } = await supabase
      .from('profiles')
      .insert({ id: userId, handle });
    if (err) {
      setError(
        err.code === '23505' ? 'HANDLE TAKEN.' : err.message.toUpperCase()
      );
      setState('error');
    } else {
      onClaimed({ id: userId, handle });
    }
  };

  return (
    <div className="mt-10 space-y-5">
      <p className="numerals text-sm tracking-wide text-bone/70">
        CLAIM YOUR HANDLE. 3–12 CHARACTERS, A–Z AND 0–9. THIS IS THE NAME THE
        RANKS KNOW YOU BY.
      </p>
      <input
        type="text"
        autoCapitalize="characters"
        autoComplete="off"
        placeholder="HANDLE"
        value={handle}
        maxLength={12}
        onChange={(e) =>
          setHandle(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))
        }
        className="numerals w-full border border-bone/40 bg-void px-4 py-4 text-2xl font-bold tracking-[0.2em] text-bone placeholder:text-bone/25 focus:border-earn focus:outline-none"
      />
      {state === 'error' && (
        <p className="numerals text-xs tracking-widest text-fault">{error}</p>
      )}
      <button
        onClick={() => void claim()}
        disabled={!valid || state === 'claiming'}
        className={
          'numerals w-full border-2 py-5 text-xl font-bold tracking-[0.3em] ' +
          (!valid || state === 'claiming'
            ? 'border-bone/15 text-bone/25'
            : 'border-earn text-earn active:bg-earn active:text-void')
        }
      >
        {state === 'claiming' ? 'CLAIMING…' : 'CLAIM'}
      </button>
    </div>
  );
}

function AccountStep({ email, handle }: { email: string; handle: string }) {
  const [signingOut, setSigningOut] = useState(false);
  return (
    <div className="mt-10 space-y-6">
      <div>
        <div className="numerals text-[10px] tracking-[0.3em] text-bone/40">
          HANDLE
        </div>
        <div className="numerals mt-1 text-3xl font-bold tracking-[0.2em] text-earn">
          {handle}
        </div>
      </div>
      <div>
        <div className="numerals text-[10px] tracking-[0.3em] text-bone/40">
          EMAIL
        </div>
        <div className="numerals mt-1 break-all text-sm tracking-wider text-bone/80">
          {email}
        </div>
      </div>
      <p className="numerals text-xs leading-relaxed tracking-wide text-bone/50">
        EVERY VERIFIED RESULT SAVES TO THIS IDENTITY AUTOMATICALLY.
      </p>
      <button
        onClick={() => {
          setSigningOut(true);
          void supabase.auth.signOut();
        }}
        disabled={signingOut}
        className="numerals w-full border-2 border-fault py-4 text-lg font-bold tracking-[0.3em] text-fault active:bg-fault active:text-void"
      >
        {signingOut ? '…' : 'SIGN OUT'}
      </button>
    </div>
  );
}
