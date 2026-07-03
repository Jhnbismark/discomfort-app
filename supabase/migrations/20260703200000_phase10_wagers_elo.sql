-- Phase 10: wagers + ELO.
-- A wager: challenger calls out an opponent on one test. Opponent accepts or
-- declines. Once accepted, each side submits ONE verified (non-voided)
-- session; when both are in, the wager resolves server-side: metric direction
-- respected (rt lower-wins, count/clock higher-wins), ties are draws, and
-- both ratings move by ELO with K=32. All mutations go through SECURITY
-- DEFINER functions — the client can never write a result or touch a rating
-- directly.

alter table public.profiles
  add column elo int not null default 1000;

create table public.wagers (
  id uuid primary key default gen_random_uuid(),
  exercise_id text not null check (exercise_id in
    ('pushup', 'plank', 'skipping', 'stillness', 'stare', 'gaze', 'vigilance')),
  metric text check (metric in ('count', 'clock', 'rt')),
  challenger uuid not null references public.profiles (id) on delete cascade,
  opponent uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'open'
    check (status in ('open', 'accepted', 'declined', 'resolved')),
  challenger_session uuid references public.sessions (id),
  opponent_session uuid references public.sessions (id),
  challenger_value bigint,
  opponent_value bigint,
  winner uuid,
  elo_delta int, -- challenger's rating change (opponent gets the negation)
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint no_self_wager check (challenger <> opponent)
);

create index wagers_challenger_idx on public.wagers (challenger, created_at desc);
create index wagers_opponent_idx on public.wagers (opponent, created_at desc);

alter table public.wagers enable row level security;

-- parties see their own wagers; nobody writes the table directly
create policy "wagers are visible to their parties"
  on public.wagers for select to authenticated
  using (auth.uid() = challenger or auth.uid() = opponent);

grant select on public.wagers to authenticated;

-- wager list with handles resolved (RLS of wagers applies via invoker)
create view public.wager_board
  with (security_invoker = on) as
select
  w.*,
  pc.handle as challenger_handle,
  po.handle as opponent_handle
from public.wagers w
join public.profiles pc on pc.id = w.challenger
join public.profiles po on po.id = w.opponent;

grant select on public.wager_board to authenticated;

-- ── mutations ───────────────────────────────────────────────────────────

create or replace function public.create_wager(
  p_opponent_handle text,
  p_exercise_id text
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  opp uuid;
  wid uuid;
begin
  if uid is null then raise exception 'NOT SIGNED IN'; end if;
  if not exists (select 1 from public.profiles where id = uid) then
    raise exception 'CLAIM A HANDLE FIRST';
  end if;
  select id into opp from public.profiles
    where handle = upper(trim(p_opponent_handle));
  if not found then raise exception 'NO SUCH HANDLE'; end if;
  if opp = uid then raise exception 'YOU CANNOT WAGER YOURSELF'; end if;

  insert into public.wagers (exercise_id, challenger, opponent)
    values (p_exercise_id, uid, opp)
    returning id into wid;
  return wid;
end;
$$;

create or replace function public.respond_wager(
  p_wager_id uuid,
  p_accept boolean
) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update public.wagers
    set status = case when p_accept then 'accepted' else 'declined' end
    where id = p_wager_id and opponent = auth.uid() and status = 'open';
  if not found then raise exception 'CANNOT RESPOND TO THIS WAGER'; end if;
end;
$$;

create or replace function public.submit_wager_entry(
  p_wager_id uuid,
  p_session_id uuid
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  w public.wagers%rowtype;
  s public.sessions%rowtype;
  lower_wins boolean;
  score_c numeric;
  win uuid;
  ra int;
  rb int;
  expected_c numeric;
  delta_c int;
begin
  select * into w from public.wagers where id = p_wager_id for update;
  if not found then raise exception 'WAGER NOT FOUND'; end if;
  if uid is null or (uid <> w.challenger and uid <> w.opponent) then
    raise exception 'NOT YOUR WAGER';
  end if;
  if w.status <> 'accepted' then raise exception 'WAGER NOT ACTIVE'; end if;

  select * into s from public.sessions
    where id = p_session_id and user_id = uid;
  if not found then raise exception 'NOT YOUR SESSION'; end if;
  if s.exercise_id <> w.exercise_id then raise exception 'WRONG TEST'; end if;
  if s.voided then raise exception 'VOIDED SESSIONS DO NOT COUNT'; end if;

  if uid = w.challenger then
    if w.challenger_session is not null then
      raise exception 'YOUR ENTRY IS ALREADY IN';
    end if;
    w.challenger_session := p_session_id;
    w.challenger_value := s.value;
  else
    if w.opponent_session is not null then
      raise exception 'YOUR ENTRY IS ALREADY IN';
    end if;
    w.opponent_session := p_session_id;
    w.opponent_value := s.value;
  end if;
  w.metric := coalesce(w.metric, s.metric);

  -- both entries in -> resolve: direction by metric, ties draw, ELO K=32
  if w.challenger_session is not null and w.opponent_session is not null then
    lower_wins := w.metric = 'rt';
    if w.challenger_value = w.opponent_value then
      score_c := 0.5;
      win := null;
    elsif (w.challenger_value < w.opponent_value) = lower_wins then
      score_c := 1;
      win := w.challenger;
    else
      score_c := 0;
      win := w.opponent;
    end if;

    select elo into ra from public.profiles where id = w.challenger for update;
    select elo into rb from public.profiles where id = w.opponent for update;
    expected_c := 1 / (1 + power(10, (rb - ra) / 400.0));
    delta_c := round(32 * (score_c - expected_c));

    update public.profiles set elo = elo + delta_c where id = w.challenger;
    update public.profiles set elo = elo - delta_c where id = w.opponent;

    w.status := 'resolved';
    w.winner := win;
    w.elo_delta := delta_c;
    w.resolved_at := now();
  end if;

  update public.wagers set
    challenger_session = w.challenger_session,
    challenger_value = w.challenger_value,
    opponent_session = w.opponent_session,
    opponent_value = w.opponent_value,
    metric = w.metric,
    status = w.status,
    winner = w.winner,
    elo_delta = w.elo_delta,
    resolved_at = w.resolved_at
  where id = p_wager_id;

  return jsonb_build_object(
    'status', w.status,
    'winner', w.winner,
    'elo_delta', w.elo_delta,
    'challenger', w.challenger,
    'challenger_value', w.challenger_value,
    'opponent_value', w.opponent_value
  );
end;
$$;

revoke execute on function public.create_wager(text, text) from public, anon;
revoke execute on function public.respond_wager(uuid, boolean) from public, anon;
revoke execute on function public.submit_wager_entry(uuid, uuid) from public, anon;
grant execute on function public.create_wager(text, text) to authenticated;
grant execute on function public.respond_wager(uuid, boolean) to authenticated;
grant execute on function public.submit_wager_entry(uuid, uuid) to authenticated;

-- live updates: parties see accepts/entries/resolutions as they land
alter publication supabase_realtime add table public.wagers;
