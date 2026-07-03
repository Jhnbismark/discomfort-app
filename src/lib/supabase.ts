import { createClient } from '@supabase/supabase-js';

/** Publishable credentials — safe in frontend code by design; every table is
 *  gated by RLS. Frames never leave the device: only numeric results are sent. */
const SUPABASE_URL = 'https://ozddlqlabdrtvossnbxi.supabase.co';
const SUPABASE_KEY = 'sb_publishable_B6zI7Ojv3w1F5UW-ANA9Gg_zYYrGfeK';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

export interface Profile {
  id: string;
  handle: string;
}

export interface RankRow {
  exercise_id: string;
  user_id: string;
  handle: string;
  best: number;
  attempts: number;
}
