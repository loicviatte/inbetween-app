-- Two ways a student a coach marked under 18 gets a second look.
--
--   coach  the student asks their coach to review; the coach answers again
--          (coach_review_student_age). 18 or over unlocks the account.
--   proof  the student photographs an ID with only the date of birth showing;
--          InBetween checks it from the admin dashboard and deletes the photo
--          as soon as it has decided.
-- The third way — a parent approves — is the existing permission flow.
--
-- age_reviews is written only by security-definer functions and the service
-- role; the age-proofs bucket is private: a student can put a photo in their
-- own folder and nobody but the service role can read it back.

create table if not exists public.age_reviews (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.users(id) on delete cascade,
  kind text not null check (kind in ('coach', 'proof')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  coach_id uuid references public.users(id) on delete set null,
  proof_path text,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid
);
create index if not exists age_reviews_student_idx on public.age_reviews (student_id, kind, status);
alter table public.age_reviews enable row level security;

-- ── the student asks their coach ───────────────────────────────────────────
create or replace function public.request_coach_age_review()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.users%rowtype;
begin
  select * into v_me from public.users where id = auth.uid();
  if v_me.id is null or v_me.age_check is distinct from 'minor_pending' then
    raise exception 'Your account doesn''t need this.';
  end if;
  if v_me.age_check_by is null then
    raise exception 'There''s no coach to ask.';
  end if;
  if exists (select 1 from public.age_reviews where student_id = v_me.id and kind = 'coach' and status = 'pending') then
    return 'already_pending';
  end if;
  -- The coach has already looked again during this lock and kept their answer:
  -- what's left is a proof of age or a parent.
  if exists (
    select 1 from public.age_reviews
     where student_id = v_me.id and kind = 'coach' and status = 'rejected'
       and created_at >= coalesce(v_me.age_check_at, '-infinity'::timestamptz)
  ) then
    raise exception 'Your coach has already reviewed your age.';
  end if;
  insert into public.age_reviews (student_id, kind, coach_id) values (v_me.id, 'coach', v_me.age_check_by);
  insert into public.notifications (user_id, type, title, body, data)
  values (
    v_me.age_check_by, 'age_review_requested',
    coalesce(split_part(v_me.name, ' ', 1), 'A student') || ' asked you to review their age',
    'Tap to check again whether they''re 18 or over.',
    jsonb_build_object('student_id', v_me.id, 'student_name', v_me.name)
  );
  return 'requested';
end;
$$;
revoke all on function public.request_coach_age_review() from public, anon;
grant execute on function public.request_coach_age_review() to authenticated;

-- ── the coach looks again ──────────────────────────────────────────────────
-- Is a review waiting on this coach for this student?
create or replace function public.coach_age_review_pending(p_student uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.age_reviews
     where student_id = p_student and kind = 'coach' and status = 'pending' and coach_id = auth.uid()
  );
$$;
revoke all on function public.coach_age_review_pending(uuid) from public, anon;
grant execute on function public.coach_age_review_pending(uuid) to authenticated;

-- The coach's second answer. 18 or over unlocks the account; under 18 keeps it
-- locked and tells the student to use another way.
create or replace function public.coach_review_student_age(p_student uuid, p_adult boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.coach_requests
     where coach_id = auth.uid() and student_id = p_student and status in ('pending', 'accepted')
  ) then
    raise exception 'This student hasn''t asked you to coach them.';
  end if;
  if not exists (select 1 from public.users where id = p_student and age_check = 'minor_pending') then
    return 'not_pending';
  end if;

  update public.age_reviews
     set status = case when p_adult then 'approved' else 'rejected' end, decided_at = now(), decided_by = auth.uid()
   where student_id = p_student and kind = 'coach' and status = 'pending';

  if p_adult then
    update public.users
       set age_check = 'adult', consent_status = 'not_required', age_check_by = auth.uid(), age_check_at = now()
     where id = p_student and age_check = 'minor_pending';
    -- A parent invitation sent in the meantime has nothing left to approve.
    update public.parental_consents
       set status = 'expired', email_token_hash = null, sms_code_hash = null, ticket_hash = null, ticket_expires_at = null
     where child_id = p_student and status = 'pending';
    insert into public.notifications (user_id, type, title, body, data)
    values (p_student, 'age_check_unlocked', 'Your account is unlocked', 'Your age is confirmed. You can use InBetween again.', '{}'::jsonb);
    return 'unlocked';
  end if;

  insert into public.notifications (user_id, type, title, body, data)
  values (p_student, 'age_review_declined', 'Your age still needs confirming',
          'Send us proof of age, or ask a parent to approve your account.', '{}'::jsonb);
  return 'kept';
end;
$$;
revoke all on function public.coach_review_student_age(uuid, boolean) from public, anon;
grant execute on function public.coach_review_student_age(uuid, boolean) to authenticated;

-- ── proof of age photos ─────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('age-proofs', 'age-proofs', false, 10485760, array['image/jpeg', 'image/png', 'image/heic', 'image/webp'])
on conflict (id) do update set public = false;

drop policy if exists "age proofs: student uploads own" on storage.objects;
create policy "age proofs: student uploads own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'age-proofs' and (storage.foldername(name))[1] = auth.uid()::text);
