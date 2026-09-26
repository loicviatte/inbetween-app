-- A class can be born approved, and then it must be born open.
--
-- 20260926b opened a class on the UPDATE that sets admin_approved_at. But two
-- kinds of class are approved by a BEFORE INSERT trigger
-- (auto_approve_test_classes) and never see that update: anything recorded by
-- the test account, and every class a STUDENT logs themselves — a common,
-- ordinary case. Those classes would have stayed closed forever: their focus
-- points would carry no deadline, never appear for review, and never publish.
-- Caught on a probe before it reached anyone.
--
-- Two additions:
--
--   · the class trigger fires on INSERT as well, so a class that arrives
--     already approved is open from the start;
--   · a focus point inserted into an already open class gets its 18 hour
--     deadline there and then. That is the other order: a class opens before
--     its focus points exist (approved at insert, scored a minute later), and
--     without this they would land deadline-less into an open class.
--
-- Between the two, the rule holds whichever comes first, the class or its
-- focus points. The cron also picks up an approved class that somehow never
-- opened, so no class can be stranded by a deploy landing mid-flight.

create or replace function public.trg_release_on_admin_approval()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.admin_approved_at is not null
     and (tg_op = 'INSERT' or old.admin_approved_at is null)
  then
    perform public.release_class_to_coach(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists release_on_admin_approval on public.class_inputs;
create trigger release_on_admin_approval
  after insert or update of admin_approved_at on public.class_inputs
  for each row execute function public.trg_release_on_admin_approval();

-- A focus point arriving into a class that is already open starts its clock
-- immediately — the class will not open a second time to do it for them.
create or replace function public.start_review_window_if_class_open()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'pending_coach'
     and new.coach_review_deadline is null
     and new.class_input_id is not null
     and exists (
       select 1 from class_inputs ci
        where ci.id = new.class_input_id
          and ci.coach_released_at is not null
     )
  then
    new.coach_review_deadline := now() + interval '18 hours';
  end if;
  return new;
end;
$$;

drop trigger if exists start_review_window_if_class_open on public.focus_points;
create trigger start_review_window_if_class_open
  before insert on public.focus_points
  for each row execute function public.start_review_window_if_class_open();

drop trigger if exists start_review_window_if_class_open on public.couple_focus_points;
create trigger start_review_window_if_class_open
  before insert on public.couple_focus_points
  for each row execute function public.start_review_window_if_class_open();

-- Safety net: an approved class that never opened (a deploy landing between
-- the approval and this migration) opens on the next cron pass, without
-- waiting four hours.
create or replace function public.release_stale_classes()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
  v_count integer := 0;
begin
  for r in
    select ci.id
      from class_inputs ci
     where ci.coach_released_at is null
       and ci.admin_rejected_at is null
       and ci.is_deleted is not true
       and ci.status in ('extracted', 'scored')
       and (
         ci.admin_approved_at is not null                                    -- approved but never opened
         or coalesce(ci.processed_at, ci.created_at) < now() - interval '4 hours'  -- the admin's four hours are up
       )
     order by ci.created_at
     limit 200
  loop
    perform public.release_class_to_coach(r.id);
    v_count := v_count + 1;
  end loop;
  if v_count > 0 then
    raise notice 'release_stale_classes: opened % class(es)', v_count;
  end if;
  return v_count;
end;
$$;

revoke execute on function public.release_stale_classes() from public, anon, authenticated;
revoke execute on function public.start_review_window_if_class_open() from public, anon, authenticated;

-- Rollback: re-apply 20260926b's trigger definition and drop the two
-- start_review_window_if_class_open triggers.
