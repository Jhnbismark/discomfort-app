-- Phase 9: identity + verified session history + RANKS.
-- profiles: one row per user, claimed handle shown on leaderboards.
-- sessions: every finished attempt (voided ones excluded from ranks).
-- ranks: best verified result per user per test. VIGILANCE is median RT in ms
-- (lower wins); every other test is reps or hold-ms (higher wins).

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  handle text not null,
  created_at timestamptz not null default now(),
  constraint handle_format check (handle ~ '^[A-Z0-9]{3,12}$')
);

create unique index profiles_handle_key on public.profiles (handle);

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  exercise_id text not null,
  metric text not null check (metric in ('count', 'clock', 'rt')),
  value bigint not null, -- reps, hold ms, or median RT ms (metric decides)
  form_score int not null default 0,
  lapses int,
  false_starts int,
  voided boolean not null default false,
  created_at timestamptz not null default now()
);

create index sessions_exercise_idx on public.sessions (exercise_id, voided);
create index sessions_user_idx on public.sessions (user_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.sessions enable row level security;

-- profiles: anyone signed in can read (leaderboards); only you write yours
create policy "profiles are readable by the signed-in"
  on public.profiles for select to authenticated using (true);
create policy "claim your own profile"
  on public.profiles for insert to authenticated
  with check (auth.uid() = id);
create policy "rename your own profile"
  on public.profiles for update to authenticated
  using (auth.uid() = id) with check (auth.uid() = id);

-- sessions: readable by the signed-in (ranks), insert-only, and only your own.
-- No update/delete policies: a recorded result is immutable. Verified effort only.
create policy "sessions are readable by the signed-in"
  on public.sessions for select to authenticated using (true);
create policy "record your own sessions"
  on public.sessions for insert to authenticated
  with check (auth.uid() = user_id);

-- best verified result per user per test (direction depends on the test)
create view public.ranks
  with (security_invoker = on) as
select
  s.exercise_id,
  s.user_id,
  p.handle,
  case
    when s.metric = 'rt' then min(s.value)
    else max(s.value)
  end as best,
  count(*) as attempts
from public.sessions s
join public.profiles p on p.id = s.user_id
where not s.voided
group by s.exercise_id, s.metric, s.user_id, p.handle;
