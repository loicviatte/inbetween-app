-- A coach's row is a profile, not a directory entry.
--
-- To let a new dancer find their teacher before they even have an account, the
-- users read policy carries one branch with no caller at all:
--
--   invite_code IS NOT NULL AND role = 'coach'
--
-- which hands the WHOLE row to anybody holding the app's public key — the key
-- that ships inside the app. Measured: signed out, 11 coach rows come back with
-- every column, including email, the legacy push_token (19 rows in this table
-- still have one), the consent and health-consent fields, and the notification
-- settings. None of that is needed to pick a teacher from a list.
--
-- So the directory becomes a real directory: a view with the six fields the
-- picker uses, readable by anyone, and the coach branch of the policy now
-- requires a signed-in caller. Being signed in is not much of a bar, but it
-- takes the data out of reach of the app's public key, and the app no longer
-- reads coach profiles from the table at all.
--
-- The branch itself can go once every build in the field reads the view; it is
-- left for now so an older bundle keeps working.

create or replace view public.coach_directory as
  select u.id,
         u.name,
         u.role,
         u.dance_style,
         u.studio_id,
         s.name as studio_name,
         u.avatar_url,
         u.invite_code
    from public.users u
    left join public.studios s on s.id = u.studio_id
   where u.role = 'coach'
     and u.invite_code is not null;

comment on view public.coach_directory is
  'What a dancer needs to find a teacher: name, style, studio, avatar, invite code. Readable by anyone, including before sign-up. The users table itself holds the profile and stays behind its policy.';

grant select on public.coach_directory to anon, authenticated;

-- The table's own coach branch now needs a signed-in caller.
drop policy if exists users_select on public.users;
create policy users_select
  on public.users
  for select
  to public
  using (
    ((studio_id is not null) and (studio_id = (select current_coach_studio_id())))
    or (id in (select coach_requests.student_id from coach_requests where coach_requests.coach_id = (select auth.uid())))
    or (
      (exists (
        select 1 from couples c
         where ((users.id = c.user_a_id) or (users.id = c.user_b_id))
           and ((select auth.uid()) = c.user_a_id or (select auth.uid()) = c.user_b_id
                or (select auth.uid()) = c.latin_couple_coach_id or (select auth.uid()) = c.ballroom_couple_coach_id)
      ))
      or (exists (
        select 1 from couple_requests r
         where ((r.requester_id = (select auth.uid())) and (r.target_id = users.id))
            or ((r.target_id = (select auth.uid())) and (r.requester_id = users.id))
      ))
    )
    or (id in (select g.child_id from guardians g where g.guardian_id = (select auth.uid())))
    or ((select exists (select 1 from guardians g where g.guardian_id = (select auth.uid()))) and guardian_can_see_user(id))
    -- The coach directory, for signed-in callers. Anyone else reads
    -- public.coach_directory, which carries no email and no token.
    or ((invite_code is not null) and (role = 'coach') and (select auth.uid()) is not null)
    or (
      (id = (select auth.uid()))
      or (latin_coach_id = (select auth.uid()))
      or (ballroom_coach_id = (select auth.uid()))
      or (id in (select cr.student_id from coach_requests cr where cr.coach_id = (select auth.uid()) and cr.status = 'accepted'))
    )
    or ((select auth.uid()) = id)
    or is_my_coach(id)
    or (((select auth.jwt()) ->> 'email') = admin_email())
  );

-- Rollback: drop the view and re-create users_select with the coach branch as
-- `((invite_code IS NOT NULL) AND (role = 'coach'))`.
