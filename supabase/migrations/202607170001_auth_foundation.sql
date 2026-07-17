-- Pinpoint account foundation.
-- Apply with the Supabase CLI or paste into the project's SQL editor.

create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.rounds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  client_id text not null,
  finished_at timestamptz not null,
  case_count integer not null check (case_count >= 0),
  total_score integer not null check (total_score >= 0),
  max_score integer not null check (max_score >= 0),
  hits integer not null default 0 check (hits >= 0),
  nears integer not null default 0 check (nears >= 0),
  misses integer not null default 0 check (misses >= 0),
  by_modality jsonb not null default '{}'::jsonb,
  filters jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, client_id)
);

create table if not exists public.case_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  round_id uuid not null references public.rounds (id) on delete cascade,
  case_id text not null,
  title text not null,
  modality text not null,
  body_region text not null,
  base_score integer not null check (base_score >= 0),
  time_bonus integer not null default 0 check (time_bonus >= 0),
  outcomes jsonb not null default '[]'::jsonb,
  answered_at timestamptz not null default now()
);

create table if not exists public.user_case_progress (
  user_id uuid not null references auth.users (id) on delete cascade,
  case_id text not null,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  best_score integer not null default 0 check (best_score >= 0),
  last_score integer not null default 0 check (last_score >= 0),
  last_result text check (last_result in ('hit', 'near', 'miss')),
  last_attempted_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, case_id)
);

create index if not exists rounds_user_finished_idx
  on public.rounds (user_id, finished_at desc);
create index if not exists case_attempts_user_answered_idx
  on public.case_attempts (user_id, answered_at desc);
create index if not exists case_attempts_round_idx
  on public.case_attempts (round_id);

alter table public.profiles enable row level security;
alter table public.user_settings enable row level security;
alter table public.rounds enable row level security;
alter table public.case_attempts enable row level security;
alter table public.user_case_progress enable row level security;

create policy "profiles_select_own"
  on public.profiles for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "profiles_update_own"
  on public.profiles for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "settings_select_own"
  on public.user_settings for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "settings_insert_own"
  on public.user_settings for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "settings_update_own"
  on public.user_settings for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "settings_delete_own"
  on public.user_settings for delete to authenticated
  using ((select auth.uid()) = user_id);

create policy "rounds_select_own"
  on public.rounds for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "rounds_insert_own"
  on public.rounds for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "rounds_delete_own"
  on public.rounds for delete to authenticated
  using ((select auth.uid()) = user_id);

create policy "attempts_select_own"
  on public.case_attempts for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "attempts_insert_own"
  on public.case_attempts for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.rounds
      where rounds.id = round_id and rounds.user_id = (select auth.uid())
    )
  );
create policy "attempts_delete_own"
  on public.case_attempts for delete to authenticated
  using ((select auth.uid()) = user_id);

create policy "progress_select_own"
  on public.user_case_progress for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "progress_insert_own"
  on public.user_case_progress for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "progress_update_own"
  on public.user_case_progress for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "progress_delete_own"
  on public.user_case_progress for delete to authenticated
  using ((select auth.uid()) = user_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger settings_set_updated_at
  before update on public.user_settings
  for each row execute function public.set_updated_at();
create trigger progress_set_updated_at
  before update on public.user_case_progress
  for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture')
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

revoke all on public.profiles from anon;
revoke all on public.user_settings from anon;
revoke all on public.rounds from anon;
revoke all on public.case_attempts from anon;
revoke all on public.user_case_progress from anon;

grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.user_settings to authenticated;
grant select, insert, delete on public.rounds to authenticated;
grant select, insert, delete on public.case_attempts to authenticated;
grant select, insert, update, delete on public.user_case_progress to authenticated;
