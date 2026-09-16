-- A coach says whether a new student is 18 or over.
--
-- Signing up, a teen can say they're an adult and skip the parent. The coach
-- knows better: when they accept a student they say "18 or over" or "under
-- 18". Under 18, for a student who came without a parent, locks the account
-- (recording and the app) until either the student confirms by email that
-- they are in fact 18 or over, or a parent approves through the usual
-- permission flow, linked to this existing account.
--
-- users.age_check
--   null             never asked (students accepted before this existed)
--   adult            the coach said 18 or over
--   minor_pending    the coach said under 18; locked, waiting on the student
--   adult_confirmed  the student confirmed by email they're 18 or over
--   minor_consented  a parent gave permission
-- consent_status moves with it: 'pending' while locked (StartClass already
-- refuses to record), back to 'not_required' or on to 'granted'.

alter table public.users add column if not exists age_check text;
alter table public.users add column if not exists age_check_by uuid references public.users(id) on delete set null;
alter table public.users add column if not exists age_check_at timestamptz;
alter table public.users drop constraint if exists users_age_check_known;
alter table public.users add constraint users_age_check_known
  check (age_check is null or age_check in ('adult', 'minor_pending', 'adult_confirmed', 'minor_consented'));

-- The age check and the consent it gates change only through InBetween's own
-- flows (security-definer functions, edge functions) — never a client writing
-- its own row, which RLS otherwise allows.
create or replace function public.guard_consent_columns()
returns trigger
language plpgsql
as $$
begin
  if current_user in ('authenticated', 'anon') and (
       new.consent_status is distinct from old.consent_status
    or new.age_check is distinct from old.age_check
    or new.age_check_by is distinct from old.age_check_by
    or new.age_check_at is distinct from old.age_check_at
  ) then
    raise exception 'Consent and age checks can only change through InBetween.';
  end if;
  return new;
end;
$$;
drop trigger if exists users_guard_consent on public.users;
create trigger users_guard_consent
  before update on public.users
  for each row execute function public.guard_consent_columns();

-- The coach's answer, at the moment they accept (or while the request is
-- still pending). Returns what happened: 'known' (the student came with a
-- parent — nothing to ask), 'adult' or 'minor_pending'.
create or replace function public.coach_set_student_age(p_student uuid, p_minor boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_consent text;
begin
  if not exists (select 1 from public.users where id = auth.uid() and role = 'coach') then
    raise exception 'Only a coach can do this.';
  end if;
  if not exists (
    select 1 from public.coach_requests
     where coach_id = auth.uid() and student_id = p_student and status in ('pending', 'accepted')
  ) then
    raise exception 'This student hasn''t asked you to coach them.';
  end if;

  select consent_status into v_consent from public.users where id = p_student;
  if exists (select 1 from public.guardians where child_id = p_student)
     or v_consent in ('pending', 'granted', 'withdrawn') then
    return 'known';
  end if;

  if not p_minor then
    update public.users
       set age_check = 'adult', age_check_by = auth.uid(), age_check_at = now()
     where id = p_student and (age_check is null or age_check = 'adult');
    return 'adult';
  end if;

  update public.users
     set age_check = 'minor_pending', consent_status = 'pending',
         age_check_by = auth.uid(), age_check_at = now()
   where id = p_student;
  insert into public.notifications (user_id, type, title, body, data)
  values (
    p_student, 'age_check_required', 'Confirm your age',
    'We need to check your age. Open InBetween to sort it out.',
    '{}'::jsonb
  );
  return 'minor_pending';
end;
$$;
revoke all on function public.coach_set_student_age(uuid, boolean) from public, anon;
grant execute on function public.coach_set_student_age(uuid, boolean) to authenticated;

-- One-time links a locked student gets by email to confirm they're 18 or over.
create table if not exists public.age_confirm_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  token_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists age_confirm_tokens_hash_idx on public.age_confirm_tokens (token_hash);
alter table public.age_confirm_tokens enable row level security;
