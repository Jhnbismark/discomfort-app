import { createClient } from '@supabase/supabase-js';

/** Publishable credentials — safe in frontend code by design; every table is
 *  gated by RLS. Frames never leave the device: only numeric results are sent. */
const SUPABASE_URL = 'https://ozddlqlabdrtvossnbxi.supabase.co';
const SUPABASE_KEY = 'sb_publishable_B6zI7Ojv3w1F5UW-ANA9Gg_zYYrGfeK';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

export interface Profile {
  id: string;
  handle: string;
  elo: number;
}

export interface RankRow {
  exercise_id: string;
  user_id: string;
  handle: string;
  best: number;
  attempts: number;
}

export type WagerStatus = 'open' | 'accepted' | 'declined' | 'resolved';

/** row from the wager_board view (wagers + both handles) */
export interface WagerRow {
  id: string;
  exercise_id: string;
  metric: 'count' | 'clock' | 'rt' | null;
  challenger: string;
  opponent: string;
  status: WagerStatus;
  challenger_session: string | null;
  opponent_session: string | null;
  challenger_value: number | null;
  opponent_value: number | null;
  winner: string | null;
  elo_delta: number | null;
  created_at: string;
  resolved_at: string | null;
  challenger_handle: string;
  opponent_handle: string;
}

/** jsonb returned by the submit_wager_entry RPC */
export interface WagerSubmitResult {
  status: WagerStatus;
  winner: string | null;
  elo_delta: number | null;
  challenger: string;
  challenger_value: number | null;
  opponent_value: number | null;
}
