-- A focus point cannot be published before its class opens.
--
-- 20260926b made the coach's window start when the class opens (the admin's
-- approval, or four hours). The app will stop offering the review until then,
-- but a screen already loaded, an old build, or a direct call would still let
-- a coach publish a focus point from a class nobody has checked — which is the
-- thing the admin gate exists to prevent, and exactly what happened tonight.
--
-- So the rule lives in the database: pending_coach → active is refused while
-- the class is closed. Nothing else is touched — retiring to 'past', holding,
-- editing, deleting all behave as before, and a focus point with no class
-- (the onboarding recall, a coach's own) has nothing to wait for.
--
-- The 18 hour auto publish is unaffected: it only picks up a deadline, and a
-- deadline only exists once the class has opened.

create or replace function public.refuse_publish_before_release()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.status = 'pending_coach'
     and new.status = 'active'
     and new.class_input_id is not null
     and not exists (
       select 1 from class_inputs ci
        where ci.id = new.class_input_id
          and ci.coach_released_at is not null
     )
  then
    raise exception 'This lesson is still being checked. Its focus points open for review once that is done.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists refuse_publish_before_release on public.focus_points;
create trigger refuse_publish_before_release
  before update of status on public.focus_points
  for each row execute function public.refuse_publish_before_release();

drop trigger if exists refuse_publish_before_release on public.couple_focus_points;
create trigger refuse_publish_before_release
  before update of status on public.couple_focus_points
  for each row execute function public.refuse_publish_before_release();

-- Rollback:
--   drop trigger if exists refuse_publish_before_release on public.focus_points;
--   drop trigger if exists refuse_publish_before_release on public.couple_focus_points;
--   drop function if exists public.refuse_publish_before_release();
