/** Personal bests + taunt lines — the comeback loop.
 *  PBs live in localStorage (device-local, works signed-out; the cloud ledger
 *  is the authority for RANKS, this is the in-session ghost). For 'rt' lower
 *  is better; everything else higher is better. Voided results never count. */

const KEY = 'discomfort-pb-v1';

type PBMap = Record<string, number>;

function load(): PBMap {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as PBMap;
  } catch {
    return {};
  }
}

export function getPB(exerciseId: string): number | null {
  const v = load()[exerciseId];
  return typeof v === 'number' ? v : null;
}

/** Record a finished result. Returns true when it's a new record. */
export function submitPB(
  exerciseId: string,
  metric: 'count' | 'clock' | 'rt',
  value: number,
  voided: boolean | undefined
): boolean {
  if (voided) return false;
  if (metric !== 'rt' && value <= 0) return false;
  const map = load();
  const prev = map[exerciseId];
  const better =
    prev === undefined ? true : metric === 'rt' ? value < prev : value > prev;
  if (!better) return false;
  map[exerciseId] = value;
  localStorage.setItem(KEY, JSON.stringify(map));
  return true;
}

/** Session taunts — shown while the record still stands. Rotated on a timer.
 *  Tone: the opponent is yesterday's you. Mocking, never protected-class bait. */
export const CHASE_TAUNTS = [
  'YESTERDAY-YOU IS STILL WINNING.',
  'THE RECORD DOESN’T CARE HOW YOU FEEL.',
  'QUITTING IS ALSO A CHOICE. A BAD ONE.',
  'THE CAMERA DOESN’T CLAP.',
  'YOUR EXCUSES ARE NOT LANDMARKS.',
  'OLD YOU IS LAUGHING.',
  'THIS IS THE PART WHERE MOST PEOPLE STOP.',
  'PAIN IS JUST THE PRICE. PAY IT.',
];

/** flashed the moment the PB falls mid-session */
export const RECORD_DOWN = 'RECORD DOWN.';

/** result-screen verdict lines */
export function resultTaunt(
  beat: boolean,
  hadPB: boolean,
  pbLabel: string
): string {
  if (!hadPB) return 'FIRST ENTRY. NOW IT HAUNTS YOU.';
  return beat
    ? 'OLD YOU JUST GOT DROPPED.'
    : `YESTERDAY-YOU IS STILL AHEAD: ${pbLabel}. SLEEP ON THAT.`;
}
