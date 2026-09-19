-- A parent reads the questions their child asked the coach, and the answers.
--
-- Parent accounts follow their children; this lets them see the exchange with
-- the coach — read only: no insert, update or delete for a guardian. Merged
-- into the one SELECT policy (the 2026-09-17 audit keeps one per command).

drop policy if exists coach_messages_select on public.coach_messages;
create policy coach_messages_select on public.coach_messages
  for select to authenticated
  using (
    coach_id = (select auth.uid())
    or student_id = (select auth.uid())
    or public.is_guardian_of(student_id)
  );

-- Rollback: recreate coach_messages_select without the is_guardian_of clause.
