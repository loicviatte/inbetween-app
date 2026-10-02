-- A couple lesson is not "the group class of my coach".
--
-- Fabio reported it this morning: the lesson he taught Sanna and Sadie was
-- showing on Yaroslava's account. Yaroslava is a child account with a guardian,
-- no couple, no focus point, no class of her own — and one accepted request
-- that makes Fabio her Ballroom coach.
--
-- The branch that let her read it:
--
--   my coach taught this class  AND  (the class is about me OR it names no student)
--
-- "Names no student" was written to mean a group class, where the roster lives
-- elsewhere and every student of that coach may read the shared summary. But a
-- COUPLE lesson also carries no student_id — the two dancers are the couple —
-- so every student of the coach could read it: title, summary and the full
-- transcript. 2,883 characters of two adults' private lesson, on a child's
-- account.
--
-- The couple's own branch, the first one in this policy, already gives the two
-- dancers and their couple coaches what they need. So the student branch now
-- excludes a couple lesson explicitly, by couple_id and by lesson_type — one
-- older couple class carries the type but no couple_id.
--
-- Nothing else in the policy changes.

drop policy if exists class_inputs_select on public.class_inputs;

create policy class_inputs_select
  on public.class_inputs
  for select
  to public
  using (
    -- The couple's own lesson: the two dancers, their couple coaches.
    (
      couple_id is not null
      and couple_id in (
        select c.id from couples c
         where (select auth.uid()) = any (array[c.user_a_id, c.user_b_id, c.latin_couple_coach_id, c.ballroom_couple_coach_id])
      )
    )
    -- A guardian, for what their child is allowed to read.
    or (
      (select exists (select 1 from guardians g where g.guardian_id = (select auth.uid())))
      and guardian_can_read_class_input(id)
    )
    -- Your own lesson, or one taught about you.
    or user_id = (select auth.uid())
    or student_id = (select auth.uid())
    -- A coach reads the lessons of the dancers they coach.
    or user_id in (
      select u.id from users u
       where u.latin_coach_id = (select auth.uid())
          or u.ballroom_coach_id = (select auth.uid())
    )
    -- A student reads their coach's lessons: the ones about them, and the group
    -- ones. A couple lesson names no student either, which is exactly how this
    -- branch leaked one — so it is excluded here, and served by the couple
    -- branch above instead.
    or exists (
      select 1 from users u
       where u.id = (select auth.uid())
         and (u.latin_coach_id = class_inputs.user_id or u.ballroom_coach_id = class_inputs.user_id)
         and (
           class_inputs.student_id = (select auth.uid())
           or (
             class_inputs.student_id is null
             and class_inputs.couple_id is null
             and coalesce(class_inputs.lesson_type, '') <> 'couple'
           )
         )
    )
    or (select auth.uid()) = user_id
    or ((select auth.jwt()) ->> 'email') = admin_email()
    -- A coach reads the lessons their students logged themselves.
    or user_id in (
      select cr.student_id from coach_requests cr
       where cr.coach_id = (select auth.uid()) and cr.status = 'accepted'
    )
  );

-- Rollback: re-create the policy with the student branch's last condition back
-- to `(class_inputs.student_id = auth.uid() OR class_inputs.student_id IS NULL)`.
