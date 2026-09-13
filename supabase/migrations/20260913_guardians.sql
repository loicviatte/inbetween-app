-- ─── Parent ↔ child ─────────────────────────────────────────────────────────
-- A parent holds an account and follows a child's training. The child has to be
-- a first-class student row: coaches attach class_inputs and focus points to a
-- student_id, and a roster showing the parent instead of the dancer would be
-- wrong. public.users.id is FK'd to auth.users, so the child gets a managed auth
-- account (created server-side, no password in anyone's hands) that they can
-- later claim by setting their own email.
--
-- Access is granted the way coach access already is: additive policies on top of
-- the owner's, never a relaxation of them.
create table if not exists public.guardians (
  id uuid primary key default gen_random_uuid(),
  guardian_id uuid not null references public.users(id) on delete cascade,
  child_id uuid not null references public.users(id) on delete cascade,
  relationship text not null default 'parent',
  created_at timestamptz not null default now(),
  unique (guardian_id, child_id),
  constraint guardians_not_self check (guardian_id <> child_id)
);
create index if not exists guardians_guardian on public.guardians (guardian_id);
create index if not exists guardians_child on public.guardians (child_id);

alter table public.guardians enable row level security;

drop policy if exists guardians_read_own on public.guardians;
create policy guardians_read_own on public.guardians
  for select using (guardian_id = auth.uid() or child_id = auth.uid());

-- Security definer so the policies below can consult guardians without the
-- caller needing to read it, and without recursing through its own RLS.
create or replace function public.is_guardian_of(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.guardians g
    where g.guardian_id = auth.uid() and g.child_id = target
  );
$$;
revoke all on function public.is_guardian_of(uuid) from public;
grant execute on function public.is_guardian_of(uuid) to authenticated;

-- ── additive access, table by table ──
drop policy if exists users_guardian_read on public.users;
create policy users_guardian_read on public.users
  for select using (public.is_guardian_of(id));

drop policy if exists users_guardian_update on public.users;
create policy users_guardian_update on public.users
  for update using (public.is_guardian_of(id)) with check (public.is_guardian_of(id));

drop policy if exists focus_points_guardian_read on public.focus_points;
create policy focus_points_guardian_read on public.focus_points
  for select using (public.is_guardian_of(user_id));

drop policy if exists focus_points_guardian_write on public.focus_points
  ;
create policy focus_points_guardian_write on public.focus_points
  for update using (public.is_guardian_of(user_id)) with check (public.is_guardian_of(user_id));

drop policy if exists focus_points_guardian_insert on public.focus_points;
create policy focus_points_guardian_insert on public.focus_points
  for insert with check (public.is_guardian_of(user_id));

drop policy if exists practice_logs_guardian_all on public.practice_logs;
create policy practice_logs_guardian_all on public.practice_logs
  for all using (public.is_guardian_of(student_id)) with check (public.is_guardian_of(student_id));

-- The parent's own row says who it belongs to, so the app can resolve the
-- training subject on sign-in without a second round trip.
alter table public.users
  add column if not exists account_for text not null default 'self';
alter table public.users
  drop constraint if exists users_account_for_known;
alter table public.users
  add constraint users_account_for_known check (account_for in ('self', 'child')) not valid;
