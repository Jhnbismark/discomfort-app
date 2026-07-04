import { useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, type Profile } from '../lib/supabase';

/** IDENTIFY — email gets a 6-digit code (and a fallback link); typing the
 *  code signs you in without ever leaving the app, which is the only flow
 *  that survives mobile mail clients and installed-PWA storage isolation.
 *  Then claim a HANDLE (the name the leaderboard knows you by). */

const SITE_URL = 'https://discomfort-app.pages.dev';
const HANDLE_RE = /^[A-Z0-9]{3,12}$/;

interface Props {
  session: Session | null;
  profile: Profile | null;
  onProfileClaimed: (p: Profile) => void;
  onBack: () => void;
  /** auth error carried back on the URL hash by a failed magic link */
  authNotice: string | null;
}

export function Identify({
  session,
  profile,
  onProfileClaimed,
  onBack,
  authNotice,
}: Props) {
  return (
    <div className="screen-in flex h-full flex-col px-6 py-10">
      <button
        onClick={onBack}
        className="numerals mb-8 self-start text-xs tracking-widest text-bone/50"
      >
        ← BACK
      </button>
      <h1 className="numerals text-3xl font-bold tracking-widest text-bone">
        IDENTIFY
      </h1>

      {!session && <EmailStep authNotice={authNotice} />}
      {session && !profile && (
        <HandleStep userId={session.user.id} onClaimed={onProfileClaimed} />
      )}
      {session && profile && (
        <AccountStep
          email={session.user.email ?? ''}
          handle={profile.handle}
          elo={profile.elo}
        />
      )}

      <div className="mt-auto" />
      <p className="numerals text-center text-[10px] tracking-widest text-bone/30">
        NO PASSWORDS. NO FRAMES LEAVE YOUR PHONE. ONLY NUMBERS.
      </p>
    </div>
  );
}

function EmailStep({ authNotice }: { authNotice: string | null }) {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>(
    'idle'
  );
  const [error, setError] = useState('');
  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [codeError, setCodeError] = useState('');

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

  const verify = async () => {
    if (code.length !== 6 || verifying) return;
    setVerifying(true);
    setCodeError('');
    const { error: err } = await supabase.auth.verifyOtp({
      email: email.trim().toLowerCase(),
      token: code,
      type: 'email',
    });
    if (err) {
      setCodeError(err.message.toUpperCase());
      setVerifying(false);
    }
    // on success onAuthStateChange flips this screen to the HANDLE step
  };

  if (state === 'sent') {
    return (
      <div className="mt-10 space-y-5">
        <p className="numerals text-sm tracking-[0.3em] text-earn">
          EMAIL SENT TO {email.trim().toUpperCase()}.
        </p>
        <p className="numerals text-sm leading-relaxed tracking-wide text-bone/70">
          IF THE EMAIL SHOWS A 6-DIGIT CODE, TYPE IT HERE — YOU STAY RIGHT
          HERE. OTHERWISE TAP ITS LINK ON THIS PHONE: IT SIGNS IN WHICHEVER
          BROWSER IT OPENS IN, SO COME BACK TO THIS ONE.
        </p>
        <input
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="000000"
          value={code}
          maxLength={6}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          className="numerals w-full border border-bone/40 bg-void px-4 py-4 text-center text-3xl font-bold tracking-[0.5em] text-bone placeholder:text-bone/25 focus:border-earn focus:outline-none"
        />
        {codeError && (
          <p className="numerals text-xs tracking-widest text-fault">
            {codeError}
          </p>
        )}
        <button
          onClick={() => void verify()}
          disabled={code.length !== 6 || verifying}
          className={
            'numerals w-full border-2 py-5 text-xl font-bold tracking-[0.3em] ' +
            (code.length !== 6 || verifying
              ? 'border-bone/15 text-bone/25'
              : 'border-earn text-earn active:bg-earn active:text-void')
          }
        >
          {verifying ? 'VERIFYING…' : 'VERIFY'}
        </button>
        <button
          onClick={() => {
            setState('idle');
            setCode('');
            setCodeError('');
          }}
          className="numerals w-full py-2 text-xs tracking-widest text-bone/40"
        >
          WRONG EMAIL / NO CODE? GO BACK, SEND AGAIN.
        </button>
      </div>
    );
  }

  return (
    <div className="mt-10 space-y-5">
      {authNotice && (
        <div className="border border-fault/40 p-4">
          <p className="numerals text-xs leading-relaxed tracking-widest text-fault">
            LAST SIGN-IN LINK FAILED: {authNotice}. SEND A FRESH ONE AND TYPE
            THE CODE INSTEAD.
          </p>
        </div>
      )}
      <p className="numerals text-sm tracking-wide text-bone/70">
        YOUR EMAIL. A SIGN-IN EMAIL GETS SENT TO IT.
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
        {state === 'sending' ? 'SENDING…' : 'SEND EMAIL'}
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
      onClaimed({ id: userId, handle, elo: 1000 });
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

function AccountStep({
  email,
  handle,
  elo,
}: {
  email: string;
  handle: string;
  elo: number;
}) {
  const [signingOut, setSigningOut] = useState(false);
  return (
    <div className="mt-10 space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <div className="numerals text-[10px] tracking-[0.3em] text-bone/40">
            HANDLE
          </div>
          <div className="numerals mt-1 text-3xl font-bold tracking-[0.2em] text-earn">
            {handle}
          </div>
        </div>
        <div className="text-right">
          <div className="numerals text-[10px] tracking-[0.3em] text-bone/40">
            RATING
          </div>
          <div className="numerals mt-1 text-3xl font-bold text-bone">
            {elo}
          </div>
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
