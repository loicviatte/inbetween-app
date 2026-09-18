-- A group lesson's focus points hold until the same coach's next group lesson.
--
-- The moment a focus point from a newer group lesson goes live for a student
-- (the coach approves it, the 18h window publishes it, or a late attendance
-- confirmation brings it in), that student's active focus points from the same
-- coach's earlier group lessons move to past — still trainable from the Past
-- section, no longer on the Group side. A lesson the coach approves late, after
-- a newer one is already live, goes straight to past.
--
-- "Same coach" is the coach who recorded both lessons (class_inputs.user_id with
-- role coach); lessons a student logged themselves are left alone. Latin and
-- Ballroom are kept apart: a Ballroom group lesson doesn't retire the Latin
-- one. A focus point with no dance counts as either.
--
-- Nothing else fires on active → past: the "mastered" push keys on is_archived,
-- the "new focus point" one on pending_coach → active.

create or replace function public.retire_superseded_group_focus()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  latin constant text[] := array['Cha Cha', 'Samba', 'Rumba', 'Paso Doble', 'Jive'];
  v_cls   uuid := coalesce(new.source_class_input_id, new.class_input_id);
  v_cat   text := case
    when new.dance is null or cardinality(new.dance) = 0 then null
    when new.dance && latin then 'latin'
    else 'ballroom'
  end;
  v_coach uuid;
  v_at    timestamptz;
begin
  if new.user_id is null or v_cls is null then
    return new;
  end if;

  select ci.user_id, ci.created_at into v_coach, v_at
  from class_inputs ci
  join users u on u.id = ci.user_id and u.role = 'coach'
  where ci.id = v_cls
    and ci.lesson_type in ('group', 'public')
    and ci.is_deleted is not true;
  if v_coach is null then
    return new;
  end if;

  -- The student already has this coach's newer group lesson live.
  if exists (
    select 1
    from focus_points o
    join class_inputs oc on oc.id = coalesce(o.source_class_input_id, o.class_input_id)
    where o.user_id = new.user_id
      and o.id <> new.id
      and o.group_fp and o.status = 'active' and not o.is_deleted and not o.is_other
      and oc.user_id = v_coach
      and oc.lesson_type in ('group', 'public')
      and oc.is_deleted is not true
      and oc.created_at > v_at
      and (v_cat is null or o.dance is null or cardinality(o.dance) = 0
           or (o.dance && latin) = (v_cat = 'latin'))
  ) then
    new.status := 'past';
    return new;
  end if;

  update focus_points o
  set status = 'past'
  from class_inputs oc
  where oc.id = coalesce(o.source_class_input_id, o.class_input_id)
    and o.user_id = new.user_id
    and o.id <> new.id
    and o.group_fp and o.status = 'active' and not o.is_deleted and not o.is_other
    and oc.user_id = v_coach
    and oc.lesson_type in ('group', 'public')
    and oc.is_deleted is not true
    and oc.created_at < v_at
    and (v_cat is null or o.dance is null or cardinality(o.dance) = 0
         or (o.dance && latin) = (v_cat = 'latin'));

  return new;
end;
$$;

-- A trigger fires whatever the caller's EXECUTE privilege (see zz3_audit_trigger_grants).
revoke execute on function public.retire_superseded_group_focus() from public, anon, authenticated;

drop trigger if exists trg_retire_superseded_group_focus on public.focus_points;
create trigger trg_retire_superseded_group_focus
  before insert or update of status on public.focus_points
  for each row
  when (new.group_fp is true and new.status = 'active')
  execute function public.retire_superseded_group_focus();

-- Rollback:
--   drop trigger if exists trg_retire_superseded_group_focus on public.focus_points;
--   drop function if exists public.retire_superseded_group_focus();
