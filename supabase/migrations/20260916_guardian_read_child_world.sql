-- A parent follows their child through the child's own screens, so they have to
-- read what the child reads. The first guardian migration covered the child's
-- profile, focus points and practice logs; everything around them — the lessons
-- the child took part in, their coach, their couple — stayed invisible, and so
-- did most focus points: focus_points_require_admin_approval is restrictive and
-- checks approval by reading class_inputs, which a parent could not read.
--
-- Read-only, and never wider than the child's own view: each rule follows one
-- of the links the child's own policies follow. The checks live in security
-- definer helpers so a policy on one table can consult another without tripping
-- that table's RLS or recursing through it.

-- lessons the guarded child is part of: logged themselves, private, group (either link), couple,
-- or a class by their coach addressed to them or to no one in particular
create or replace function public.guardian_can_read_class_input(p_ci uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.class_inputs ci
     where ci.id = p_ci
       and (
         -- a lesson the child logged themselves is theirs as author, not as student
         public.is_guardian_of(ci.user_id)
         or public.is_guardian_of(ci.student_id)
         or exists (select 1 from unnest(coalesce(ci.student_ids, '{}'::uuid[])) sid where public.is_guardian_of(sid))
         or exists (select 1 from public.class_input_students s
                     where s.class_input_id = ci.id and public.is_guardian_of(s.student_id))
         or (ci.couple_id is not null and exists (
               select 1 from public.couples c
                where c.id = ci.couple_id
                  and (public.is_guardian_of(c.user_a_id) or public.is_guardian_of(c.user_b_id))))
         or exists (
               select 1 from public.guardians g
                 join public.users u on u.id = g.child_id
                where g.guardian_id = auth.uid()
                  and (u.latin_coach_id = ci.user_id or u.ballroom_coach_id = ci.user_id)
                  and (ci.student_id = u.id or ci.student_id is null))
       )
  );
$$;

create or replace function public.is_guardian_of_couple(p_couple uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.couples c
     where c.id = p_couple
       and (public.is_guardian_of(c.user_a_id) or public.is_guardian_of(c.user_b_id))
  );
$$;

-- people the child can see: their coaches, their partner, anyone in a couple
-- request with them
create or replace function public.guardian_can_see_user(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.guardians g
      join public.users child on child.id = g.child_id
     where g.guardian_id = auth.uid()
       and (
         p_user in (child.latin_coach_id, child.ballroom_coach_id)
         or exists (select 1 from public.coach_requests cr
                     where cr.student_id = child.id and cr.coach_id = p_user and cr.status in ('accepted', 'pending'))
         or exists (select 1 from public.couples c
                     where child.id in (c.user_a_id, c.user_b_id)
                       and p_user in (c.user_a_id, c.user_b_id, c.latin_couple_coach_id, c.ballroom_couple_coach_id))
         or exists (select 1 from public.couple_requests r
                     where (r.requester_id = child.id and r.target_id = p_user)
                        or (r.target_id = child.id and r.requester_id = p_user))
       )
  );
$$;

revoke all on function public.guardian_can_read_class_input(uuid) from public;
revoke all on function public.is_guardian_of_couple(uuid) from public;
revoke all on function public.guardian_can_see_user(uuid) from public;
grant execute on function public.guardian_can_read_class_input(uuid) to authenticated;
grant execute on function public.is_guardian_of_couple(uuid) to authenticated;
grant execute on function public.guardian_can_see_user(uuid) to authenticated;

drop policy if exists class_inputs_guardian_read on public.class_inputs;
create policy class_inputs_guardian_read on public.class_inputs
  for select using (public.guardian_can_read_class_input(id));

drop policy if exists class_input_students_guardian_read on public.class_input_students;
create policy class_input_students_guardian_read on public.class_input_students
  for select using (public.is_guardian_of(student_id));

drop policy if exists attendance_responses_guardian_read on public.attendance_responses;
create policy attendance_responses_guardian_read on public.attendance_responses
  for select using (public.is_guardian_of(student_id));

drop policy if exists coach_requests_guardian_read on public.coach_requests;
create policy coach_requests_guardian_read on public.coach_requests
  for select using (public.is_guardian_of(student_id));

drop policy if exists couples_guardian_read on public.couples;
create policy couples_guardian_read on public.couples
  for select using (public.is_guardian_of(user_a_id) or public.is_guardian_of(user_b_id));

drop policy if exists couple_requests_guardian_read on public.couple_requests;
create policy couple_requests_guardian_read on public.couple_requests
  for select using (public.is_guardian_of(requester_id) or public.is_guardian_of(target_id));

drop policy if exists cfp_guardian_read on public.couple_focus_points;
create policy cfp_guardian_read on public.couple_focus_points
  for select using (public.is_guardian_of_couple(couple_id));

drop policy if exists cpl_guardian_read on public.couple_practice_logs;
create policy cpl_guardian_read on public.couple_practice_logs
  for select using (public.is_guardian_of_couple(couple_id));

drop policy if exists cfl_guardian_read on public.couple_focus_locks;
create policy cfl_guardian_read on public.couple_focus_locks
  for select using (public.is_guardian_of_couple(couple_id));

drop policy if exists users_guardian_sees_child_circle on public.users;
create policy users_guardian_sees_child_circle on public.users
  for select using (public.guardian_can_see_user(id));
