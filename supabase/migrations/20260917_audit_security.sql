-- Audit 2026-09-17: close the ways a signed-in (or signed-out) client could
-- forge links to other people and read or change what isn't theirs.
--
-- 1. coach_requests: any user could insert a row as the "coach" of anyone
--    (coach_requests_coach FOR ALL, no WITH CHECK) or set their own request to
--    'accepted' (coach_requests_student FOR ALL) — and an accepted row opens the
--    student's profile, focus points, practice logs and classes to the "coach".
--    Now: a student only sends pending requests to a real coach (not
--    themselves); a coach only answers requests addressed to them, and the
--    request's people and style can't be rewritten.
-- 2. users: a user (or a parent, on their child's row) could point their coach
--    columns at any coach, or turn an existing account into a coach. Now a
--    coach column only takes a coach who accepted, or NULL; the role is fixed
--    once the account is a day old.
-- 3. couple_coach_requests / couples: a coach could move a request onto another
--    couple and accept it; a dancer could write any coach onto their couple.
--    Now requests are answered only through respond_couple_coach_request, and
--    couple coaches are set only by the SECURITY DEFINER functions.
-- 4. finalize_recording_atomic (writes a class from any transcript) and two
--    SECURITY DEFINER views (stuck recordings, AI costs) were reachable with the
--    public anon key. Server-only now. find_partner_by_code needs a sign-in.
-- 5. coach_respond_request: accepting writes the student's coach column
--    server-side (the client write was silently refused by RLS).
-- 6. The age review and link functions require the caller to be a coach.

-- ── Helpers ─────────────────────────────────────────────────────────────────
create or replace function public.is_coach(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (select 1 from public.users where id = p_user and role = 'coach');
$$;
revoke all on function public.is_coach(uuid) from public, anon;
grant execute on function public.is_coach(uuid) to authenticated;

-- ── 1. coach_requests ───────────────────────────────────────────────────────
drop policy if exists coach_requests_coach on public.coach_requests;
drop policy if exists coach_requests_student on public.coach_requests;
drop policy if exists coach_requests_update on public.coach_requests;
drop policy if exists coach_requests_insert on public.coach_requests;

create policy coach_requests_student_insert on public.coach_requests
  for insert to authenticated
  with check (
    student_id = auth.uid()
    and status = 'pending'
    and coach_id <> auth.uid()
    and public.is_coach(coach_id)
  );

create policy coach_requests_coach_respond on public.coach_requests
  for update to authenticated
  using (coach_id = auth.uid())
  with check (coach_id = auth.uid() and status in ('pending', 'accepted', 'declined'));

-- Reads (coach_requests_read, guardian, trainer) and the student's delete stay.

create or replace function public.guard_coach_request_update()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if current_user in ('authenticated', 'anon') and (
       new.student_id is distinct from old.student_id
    or new.coach_id is distinct from old.coach_id
    or new.category is distinct from old.category
  ) then
    raise exception 'A request''s student, coach and style can''t be changed.';
  end if;
  return new;
end;
$$;
drop trigger if exists coach_requests_guard_update on public.coach_requests;
create trigger coach_requests_guard_update
  before update on public.coach_requests
  for each row execute function public.guard_coach_request_update();

-- ── 2. users: coach columns and role ────────────────────────────────────────
create or replace function public.guard_user_links()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if new.latin_coach_id is not null and new.latin_coach_id is distinct from old.latin_coach_id
     and not exists (
       select 1 from public.coach_requests
        where student_id = new.id and coach_id = new.latin_coach_id and status = 'accepted'
          and (category = 'latin' or category is null)
     ) then
    raise exception 'That coach hasn''t accepted this student.';
  end if;

  if new.ballroom_coach_id is not null and new.ballroom_coach_id is distinct from old.ballroom_coach_id
     and not exists (
       select 1 from public.coach_requests
        where student_id = new.id and coach_id = new.ballroom_coach_id and status = 'accepted'
          and (category = 'ballroom' or category is null)
     ) then
    raise exception 'That coach hasn''t accepted this student.';
  end if;

  -- Sign-up writes the role it was given; after that it stays.
  if new.role is distinct from old.role
     and (auth.uid() is distinct from new.id or old.created_at < now() - interval '1 day') then
    raise exception 'The account type can''t be changed.';
  end if;

  return new;
end;
$$;
drop trigger if exists users_guard_links on public.users;
create trigger users_guard_links
  before update on public.users
  for each row execute function public.guard_user_links();

-- ── 3. couples and couple coach requests ────────────────────────────────────
drop policy if exists ccr_update on public.couple_coach_requests;
drop policy if exists ccr_insert on public.couple_coach_requests;
create policy ccr_insert on public.couple_coach_requests
  for insert to authenticated
  with check (public.is_couple_member(couple_id) and status = 'pending' and public.is_coach(coach_id));

-- Every couple change goes through SECURITY DEFINER functions (pairing,
-- proposing/approving changes, unpairing, couple coaches): no direct update.
drop policy if exists couples_update on public.couples;
drop policy if exists couples_insert on public.couples;
create policy couples_insert on public.couples
  for insert to authenticated
  with check (
    auth.uid() in (user_a_id, user_b_id)
    and latin_couple_coach_id is null
    and ballroom_couple_coach_id is null
  );

-- ── 4. Server-only functions and views ──────────────────────────────────────
revoke execute on function public.finalize_recording_atomic(uuid, text, text) from public, anon, authenticated;
revoke select on public.class_recordings_needing_retry from anon, authenticated;
revoke select on public.ai_call_costs_daily from anon, authenticated;
revoke execute on function public.find_partner_by_code(text) from public, anon;
grant execute on function public.find_partner_by_code(text) to authenticated;

-- ── 5. Accepting or declining a student's request ───────────────────────────
create or replace function public.coach_respond_request(p_request uuid, p_accept boolean)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r public.coach_requests;
begin
  select * into r from public.coach_requests where id = p_request for update;
  if not found then raise exception 'Request not found.'; end if;
  if r.coach_id is distinct from auth.uid() then raise exception 'This request isn''t for you.'; end if;

  update public.coach_requests set status = case when p_accept then 'accepted' else 'declined' end
   where id = p_request;

  if p_accept then
    -- A request with no style links both, as before; never over another coach.
    if r.category is null or r.category = 'latin' then
      update public.users set latin_coach_id = r.coach_id
       where id = r.student_id and (latin_coach_id is null or latin_coach_id = r.coach_id);
    end if;
    if r.category is null or r.category = 'ballroom' then
      update public.users set ballroom_coach_id = r.coach_id
       where id = r.student_id and (ballroom_coach_id is null or ballroom_coach_id = r.coach_id);
    end if;
  else
    if r.category is null or r.category = 'latin' then
      update public.users set latin_coach_id = null where id = r.student_id and latin_coach_id = r.coach_id;
    end if;
    if r.category is null or r.category = 'ballroom' then
      update public.users set ballroom_coach_id = null where id = r.student_id and ballroom_coach_id = r.coach_id;
    end if;
  end if;

  return jsonb_build_object('student_id', r.student_id, 'category', r.category);
end;
$$;
revoke all on function public.coach_respond_request(uuid, boolean) from public, anon;
grant execute on function public.coach_respond_request(uuid, boolean) to authenticated;

-- ── 6. Coach-only functions check the caller is a coach ─────────────────────
CREATE OR REPLACE FUNCTION public.coach_review_student_age(p_student uuid, p_adult boolean)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;
