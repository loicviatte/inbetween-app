-- Pairing a child's phone to their own profile.
--
-- A parent's account holds their child's training, but the child shouldn't
-- need the parent's password (or see the parent's settings) to train on their
-- own phone. From Stats ▸ Settings the parent gets a short one-time code; the
-- child types it on their phone and is signed in to their own profile. The
-- child-pairing edge function does both halves; this is its storage.
--
-- A code is kept only as a hash, lasts 10 minutes and works once. Nothing but
-- the service role reads or writes the table.

create table if not exists public.child_pairing_codes (
  id uuid primary key default gen_random_uuid(),
  guardian_id uuid not null references public.users(id) on delete cascade,
  child_id uuid not null references public.users(id) on delete cascade,
  code_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists child_pairing_codes_hash_idx on public.child_pairing_codes (code_hash);
create index if not exists child_pairing_codes_child_idx on public.child_pairing_codes (child_id);
alter table public.child_pairing_codes enable row level security;

-- Is a phone signed in to this child's profile? A managed child has no
-- password anyone knows, so any live session is a paired phone.
create or replace function public.child_phone_status(p_child uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'sessions', count(*),
    'last_seen', max(coalesce(s.refreshed_at, s.updated_at, s.created_at))
  )
  from auth.sessions s
  where s.user_id = p_child
    and (s.not_after is null or s.not_after > now());
$$;

-- Sign every phone out of this child's profile. Their refresh tokens go with
-- the sessions, so the phone is signed out once its current access token lapses.
create or replace function public.revoke_child_sessions(p_child uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  delete from auth.sessions where user_id = p_child;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.child_phone_status(uuid) from public, anon, authenticated;
revoke all on function public.revoke_child_sessions(uuid) from public, anon, authenticated;
grant execute on function public.child_phone_status(uuid) to service_role;
grant execute on function public.revoke_child_sessions(uuid) to service_role;
