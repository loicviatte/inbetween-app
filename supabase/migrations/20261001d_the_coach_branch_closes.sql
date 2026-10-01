-- The coach directory leaves the users table for good.
--
-- 20261001c moved the app to public.coach_directory and left one branch of the
-- read policy alive — any signed-in caller could still read a coach's whole
-- profile row — so that a build which had not taken the update kept working.
-- The update has shipped; the branch goes.
--
-- What a dancer still reads of a coach: their own, through is_my_coach(), which
-- covers an accepted link, a pending request, and the latin/ballroom columns.
-- And, added here, the coach of a couple they belong to — the dancers must be
-- able to name who coaches them as a pair, and until now they could only do so
-- because every coach was readable by everyone.
--
-- Everyone else reads public.coach_directory: name, style, studio, avatar,
-- invite code. No email, no token, no consent field.

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
    -- The coach of a couple I dance in.
    or (exists (
      select 1 from couples c
       where ((select auth.uid()) = c.user_a_id or (select auth.uid()) = c.user_b_id)
         and users.id in (c.latin_couple_coach_id, c.ballroom_couple_coach_id)
    ))
    or (id in (select g.child_id from guardians g where g.guardian_id = (select auth.uid())))
    or ((select exists (select 1 from guardians g where g.guardian_id = (select auth.uid()))) and guardian_can_see_user(id))
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

-- Rollback: re-add `or ((invite_code is not null) and (role = 'coach') and (select auth.uid()) is not null)`.
