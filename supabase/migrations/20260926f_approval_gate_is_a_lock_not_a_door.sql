-- The approval gate was a second door, not a lock.
--
-- focus_points had two SELECT policies. The first is the real one: your own
-- focus points, your child's, your students' if you are a coach, everything if
-- you are the admin. The second, named focus_points_require_admin_approval,
-- was written as a barrier — nothing leaves before the admin has checked it.
--
-- But a PERMISSIVE policy can only ever GRANT: Postgres combines same-kind
-- policies with OR. So the "barrier" became a second way in, and unlike the
-- first it never asks who the reader is — it only looks at the row:
--
--     class_input_id IS NULL OR <that class is approved> OR <caller is admin>
--
-- The first clause checks nothing at all, so every focus point attached to no
-- class was readable by ANY signed in account. Measured in production: as a
-- dancer who joined this week, I read another student's 43 focus points —
-- name, subtitle and context, which is what someone was corrected on and can
-- name an injury. 45 such rows today, and the number grows: they are the ones
-- dictated at sign up, created by a coach, or carried over by hand.
--
-- (The second clause did not leak: it looks up class_inputs, which is itself
-- protected, so it only opened classes the reader could already see.)
--
-- The fix is the one word the schema had never used — RESTRICTIVE, which ANDs
-- instead of ORs. The gate finally means what its name says: you may read a
-- focus point when the first policy allows it AND its class has opened.
--
-- Two details that matter:
--
--   · "opened", not "approved" (20260926b): a class also opens four hours
--     after scoring, and its coach must still be able to review it.
--   · the check goes through public.class_is_open(), which is SECURITY
--     DEFINER, so it answers about the CLASS rather than about what the reader
--     is allowed to see. Inlined, the EXISTS would run under the reader's own
--     policies and would hide a student's focus points from their other coach,
--     who cannot read that class row — a right the first policy grants them.

create or replace function public.class_is_open(p_class uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from class_inputs ci
     where ci.id = p_class
       and ci.coach_released_at is not null
  )
$$;

comment on function public.class_is_open(uuid) is
  'Has this class opened to its coach (admin approved, or four hours)? Asked by the RESTRICTIVE read gate on focus points, so it must answer about the class itself and not about what the caller may see.';

grant execute on function public.class_is_open(uuid) to authenticated, service_role;

drop policy if exists focus_points_require_admin_approval on public.focus_points;
create policy focus_points_require_admin_approval
  on public.focus_points
  as restrictive
  for select
  to authenticated
  using (
    class_input_id is null
    or public.class_is_open(class_input_id)
    or ((select auth.jwt()) ->> 'email') = public.admin_email()
  );

-- Same rule for the couple's own focus points. Their permissive policy is
-- properly scoped (the two dancers, their couple coaches, a guardian), so
-- nothing leaked here — but a closed class must not reach anyone either.
drop policy if exists couple_focus_points_require_open_class on public.couple_focus_points;
create policy couple_focus_points_require_open_class
  on public.couple_focus_points
  as restrictive
  for select
  to authenticated
  using (
    class_input_id is null
    or public.class_is_open(class_input_id)
    or ((select auth.jwt()) ->> 'email') = public.admin_email()
  );

-- Rollback:
--   drop policy if exists couple_focus_points_require_open_class on public.couple_focus_points;
--   drop policy if exists focus_points_require_admin_approval on public.focus_points;
--   create policy focus_points_require_admin_approval on public.focus_points
--     for select to authenticated
--     using (class_input_id is null
--            or exists (select 1 from class_inputs ci where ci.id = focus_points.class_input_id and ci.admin_approved_at is not null)
--            or ((select auth.jwt()) ->> 'email') = public.admin_email());
--   drop function if exists public.class_is_open(uuid);
