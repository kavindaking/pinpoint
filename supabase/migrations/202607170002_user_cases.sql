-- Per-user case metadata. Large image and DICOM payloads live privately in R2;
-- this table stores only the teaching metadata and the authenticated user's
-- object keys.

create table if not exists public.user_cases (
  user_id uuid not null references auth.users (id) on delete cascade,
  case_id text not null,
  case_data jsonb not null,
  media jsonb not null default '{}'::jsonb,
  object_keys text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, case_id)
);

create index if not exists user_cases_updated_idx
  on public.user_cases (user_id, updated_at desc);

alter table public.user_cases enable row level security;

create policy "user_cases_select_own"
  on public.user_cases for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "user_cases_insert_own"
  on public.user_cases for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "user_cases_update_own"
  on public.user_cases for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "user_cases_delete_own"
  on public.user_cases for delete to authenticated
  using ((select auth.uid()) = user_id);

create trigger user_cases_set_updated_at
  before update on public.user_cases
  for each row execute function public.set_updated_at();

revoke all on public.user_cases from anon;
grant select, insert, update, delete on public.user_cases to authenticated;
