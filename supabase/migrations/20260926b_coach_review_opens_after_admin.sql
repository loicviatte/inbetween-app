-- The admin goes first, and stops being a bottleneck.
--
-- Until now the order was an intention, not a rule. A class was scored, the
-- coach was notified in the same second, and his review screen let him publish
-- immediately — before the admin had checked that the audio belonged to this
-- class at all. Tonight that is exactly what happened: scored 20:41, coach
-- notified 21:17, coach approved 21:19, admin approved 21:47. The admin gate
-- held the solo side (readiness refuses an unapproved class) and nothing held
-- the couple side, so two focus points reached the dancers 28 minutes before
-- the class was checked.
--
-- So: a class OPENS to its coach, once, and only then does his 18 hour window
-- start. It opens when the admin approves it — or on its own four hours later,
-- because one person checking a queue must not be what stands between a coach
-- and the lesson he just taught. A rejected class never opens.
--
-- The mechanism is the deadline itself. Focus points are now created with
-- coach_review_deadline NULL: no deadline, nothing to expire, nothing the
-- 18 hour auto publish can pick up. Opening the class is what writes the
-- deadline. That replaces the separate "is the parent class approved" check
-- the auto publish carried, which the couple side never had.
--
-- What follows for a class the admin never touches: it opens after 4 hours,
-- the coach has his 18 hours, and its focus points reach the dancers after
-- that — the admin's window to object is those first four hours.

alter table public.class_inputs
  add column if not exists coach_released_at timestamptz;

comment on column public.class_inputs.coach_released_at is
  'When this class opened to its coach: the admin approved it, or four hours passed without the admin touching it. The coach''s 18 hour review window starts here, and focus points carry no deadline before it. Null = still the admin''s, or rejected.';

-- ─── Opening a class ────────────────────────────────────────────────────────
-- Idempotent: a class opens once. Returns how many focus points it started the
-- clock on.
create or replace function public.release_class_to_coach(p_class uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_class      record;
  v_deadline   timestamptz := now() + interval '18 hours';
  v_opened     integer := 0;
  v_coach      uuid;
  r            record;
begin
  select ci.id, ci.user_id, ci.lesson_type, ci.couple_id, ci.dance,
         ci.admin_rejected_at, ci.coach_released_at, ci.is_deleted
    into v_class
    from class_inputs ci where ci.id = p_class;

  if v_class.id is null then return 0; end if;
  if v_class.is_deleted is true then return 0; end if;
  if v_class.admin_rejected_at is not null then return 0; end if;  -- never opens
  if v_class.coach_released_at is not null then return 0; end if;  -- already open

  update class_inputs set coach_released_at = now() where id = p_class;

  -- The 18 hour window starts now, for everything this class left pending.
  update focus_points
     set coach_review_deadline = v_deadline
   where class_input_id = p_class
     and status = 'pending_coach'
     and is_deleted is not true;
  get diagnostics v_opened = row_count;

  update couple_focus_points
     set coach_review_deadline = v_deadline
   where class_input_id = p_class
     and status = 'pending_coach'
     and is_deleted is not true;

  -- Tell the coach now — not when the class was scored, which is what used to
  -- put him ahead of the admin. One notification per student, as before.
  for r in
    select fp.user_id as student_id,
           coalesce(u.name, 'your student') as student_name,
           count(*) as n
      from focus_points fp
      left join users u on u.id = fp.user_id
     where fp.class_input_id = p_class
       and fp.status = 'pending_coach'
       and fp.is_deleted is not true
       and fp.is_other = false
     group by 1, 2
  loop
    -- The coach who taught it, or the student's coach for this style.
    select case when owner.role = 'coach' then owner.id
                else coalesce(su.latin_coach_id, su.ballroom_coach_id) end
      into v_coach
      from users owner, users su
     where owner.id = v_class.user_id and su.id = r.student_id;

    if v_coach is not null then
      insert into notifications (user_id, type, title, body, data)
      values (v_coach, 'focus_points_added', 'New focus points added',
              r.n || ' new focus point' || case when r.n > 1 then 's' else '' end ||
              ' for ' || r.student_name || '. Review before they publish to the student.',
              jsonb_build_object('student_id', r.student_id, 'class_input_id', p_class));
    end if;
  end loop;

  -- The couple's own points go to the couple's coaches, once.
  if v_class.couple_id is not null then
    declare
      v_n integer;
    begin
      select count(*) into v_n
        from couple_focus_points cfp
       where cfp.class_input_id = p_class
         and cfp.status = 'pending_coach'
         and cfp.is_deleted is not true
         and cfp.is_other = false;
      if v_n > 0 then
        insert into notifications (user_id, type, title, body, data)
        select distinct c_id, 'focus_points_added', 'New couple focus points',
               v_n || ' new couple focus point' || case when v_n > 1 then 's' else '' end ||
               '. Review before they publish.',
               jsonb_build_object('couple_id', v_class.couple_id, 'class_input_id', p_class)
          from (
            select unnest(array[c.latin_couple_coach_id, c.ballroom_couple_coach_id]) as c_id
              from couples c where c.id = v_class.couple_id
          ) s
         where c_id is not null;
      end if;
    end;
  end if;

  -- The "possible duplicate" prompts from this class wait with everything else:
  -- the coach hears nothing about a lesson until it opens.
  insert into notifications (user_id, type, title, body, data)
  select distinct on (mr.id)
         case when owner.role = 'coach' then owner.id
              else coalesce(su.latin_coach_id, su.ballroom_coach_id) end,
         'merge_request', 'Possible duplicate focus point',
         '"' || fb.name || '" may overlap with an existing focus point for ' ||
           coalesce(su.name, 'your student') || '.',
         jsonb_build_object('student_id', mr.student_id, 'focus_a', mr.focus_a, 'focus_b', mr.focus_b)
    from merge_requests mr
    join focus_points fb on fb.id = mr.focus_b
    join users su on su.id = mr.student_id
    join users owner on owner.id = v_class.user_id
   where fb.class_input_id = p_class
     and mr.status = 'pending_coach'
     and case when owner.role = 'coach' then owner.id
              else coalesce(su.latin_coach_id, su.ballroom_coach_id) end is not null;

  return v_opened;
end;
$$;

revoke execute on function public.release_class_to_coach(uuid) from public, anon, authenticated;

-- ─── The admin's approval opens it ──────────────────────────────────────────
create or replace function public.trg_release_on_admin_approval()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.admin_approved_at is not null and old.admin_approved_at is null then
    perform public.release_class_to_coach(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists release_on_admin_approval on public.class_inputs;
create trigger release_on_admin_approval
  after update of admin_approved_at on public.class_inputs
  for each row execute function public.trg_release_on_admin_approval();

-- ─── …or four hours of silence ──────────────────────────────────────────────
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
       and ci.admin_approved_at is null
       and ci.admin_rejected_at is null
       and ci.is_deleted is not true
       and ci.status in ('extracted', 'scored')
       and coalesce(ci.processed_at, ci.created_at) < now() - interval '4 hours'
     order by ci.created_at
     limit 200
  loop
    perform public.release_class_to_coach(r.id);
    v_count := v_count + 1;
  end loop;
  if v_count > 0 then
    raise notice 'release_stale_classes: opened % class(es) the admin had not reached', v_count;
  end if;
  return v_count;
end;
$$;

revoke execute on function public.release_stale_classes() from public, anon, authenticated;

select cron.unschedule('release-stale-classes')
 where exists (select 1 from cron.job where jobname = 'release-stale-classes');
select cron.schedule('release-stale-classes', '*/10 * * * *', $cron$ select public.release_stale_classes(); $cron$);

-- ─── The existing rows ──────────────────────────────────────────────────────
-- Every class in production is either approved (78) or rejected (3); there is
-- no unapproved backlog to open by surprise. An approved class opened when it
-- was approved.
update class_inputs
   set coach_released_at = admin_approved_at
 where admin_approved_at is not null
   and coach_released_at is null;

-- A rejected class's focus points were held only by the auto publish's own
-- approval check, which the deadline now replaces. Take their deadline away so
-- nothing can ever pick them up: 19 rows, all expired, all on rejected classes.
update focus_points
   set coach_review_deadline = null
 where status = 'pending_coach'
   and is_deleted is not true
   and class_input_id in (select id from class_inputs where admin_rejected_at is not null);

update couple_focus_points
   set coach_review_deadline = null
 where status = 'pending_coach'
   and is_deleted is not true
   and class_input_id in (select id from class_inputs where admin_rejected_at is not null);

-- Rollback:
--   select cron.unschedule('release-stale-classes');
--   drop trigger if exists release_on_admin_approval on public.class_inputs;
--   drop function if exists public.trg_release_on_admin_approval();
--   drop function if exists public.release_stale_classes();
--   drop function if exists public.release_class_to_coach(uuid);
--   alter table public.class_inputs drop column coach_released_at;
--   (and re-apply the previous get_lesson_readiness / publishExpiredFocusPoints)
