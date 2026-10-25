-- ============================================================
-- A lesson a dancer logs goes to the coach it names, whatever its style.
--
-- Sanna logged her Friday lesson with Fabio on 24 Oct and tagged it Cha Cha.
-- Fabio is her Ballroom coach. student-class-score sent him its two focus
-- points to review (he is the teacher she named), the release told him twice,
-- and the style boundary (20260926g) hid both points from him: a Ballroom
-- coach doesn't read Latin. He got "Review 2 focus points" and an empty review
-- screen ("All clear"), and the notification, which stays unread until the
-- points are reviewed, could never go out.
--
-- 1. class_inputs.reviewer_coach_id: the coach a logged lesson went to for
--    review (student-class-score sets it). That lesson is his the way a lesson
--    he recorded is his: coach_sees_focus lets him read what it produced, and
--    he can read the lesson itself.
-- 2. The release tells that coach, once: "Sanna Saidy logged a class".
--    student-class-score no longer sends its own copy (it doubled this one).
-- 3. A "to validate" notification is marked read once nothing it announced is
--    still waiting: approved, rejected, or published at the deadline. Before,
--    only the app's Approve did that, so every point that published itself
--    left the coach's bell lit for good.
-- ============================================================

-- ─── 1. The coach a logged lesson went to ────────────────────────────────────

alter table public.class_inputs
  add column if not exists reviewer_coach_id uuid references public.users(id) on delete set null;

comment on column public.class_inputs.reviewer_coach_id is
  'A lesson the dancer logged: the coach its focus points went to for review (student-class-score). Null for a recorded lesson (its coach is user_id) and for a logged lesson with no coach to review it.';

-- Logged lessons so far: the coach whose name the dancer typed, among their
-- accepted coaches (student-class-score's own rule).
update public.class_inputs ci
   set reviewer_coach_id = c.id
  from public.users s, public.coach_requests cr, public.users c
 where s.id = ci.user_id
   and s.role = 'student'
   and ci.teacher_name is not null
   and ci.reviewer_coach_id is null
   and cr.student_id = ci.user_id
   and cr.status = 'accepted'
   and c.id = cr.coach_id
   and lower(trim(c.name)) = lower(trim(ci.teacher_name));

create or replace function public.coach_sees_focus(p_student uuid, p_dance text[], p_class uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    -- The lesson is theirs, so is what it produced: they recorded it, or the
    -- dancer logged it and sent it to them.
    exists (
      select 1 from class_inputs ci
       where ci.id = p_class
         and (ci.user_id = (select auth.uid()) or ci.reviewer_coach_id = (select auth.uid()))
    )
    -- …or they coach this dancer in this focus point's style.
    or exists (
      select 1 from coach_requests cr
       where cr.coach_id = (select auth.uid())
         and cr.student_id = p_student
         and cr.status = 'accepted'
         and (
           public.focus_category_of(p_dance) is null
           or cr.category is null
           or cr.category::text = public.focus_category_of(p_dance)
         )
    )
    or exists (
      select 1 from users u
       where u.id = p_student
         and (
           (u.latin_coach_id = (select auth.uid())
              and public.focus_category_of(p_dance) is distinct from 'ballroom')
           or (u.ballroom_coach_id = (select auth.uid())
              and public.focus_category_of(p_dance) is distinct from 'latin')
         )
    )
$$;

drop policy if exists class_inputs_reviewer_select on public.class_inputs;
create policy class_inputs_reviewer_select on public.class_inputs
  for select to authenticated
  using (reviewer_coach_id = (select auth.uid()));

-- ─── 2. One notification, to that coach ──────────────────────────────────────

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
  v_logged     boolean;
  v_coach      uuid;
  r            record;
begin
  select ci.id, ci.user_id, ci.lesson_type, ci.couple_id, ci.dance,
         ci.admin_rejected_at, ci.coach_released_at, ci.is_deleted,
         ci.reviewer_coach_id
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

  -- A lesson the dancer logged rather than a coach recorded.
  select coalesce(owner.role, '') <> 'coach' into v_logged
    from users owner where owner.id = v_class.user_id;

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
    -- The coach who taught it: the one who recorded it, or the one the dancer
    -- sent their logged lesson to (older logged lessons: their coach column).
    select case when not v_logged then v_class.user_id
                else coalesce(v_class.reviewer_coach_id, su.latin_coach_id, su.ballroom_coach_id) end
      into v_coach
      from users su
     where su.id = r.student_id;

    if v_coach is not null then
      insert into notifications (user_id, type, title, body, data)
      values (v_coach, 'focus_points_added',
              case when v_logged then r.student_name || ' logged a class'
                   else 'New focus points added' end,
              r.n || ' new focus point' || case when r.n > 1 then 's' else '' end ||
              case when v_logged then ' from that lesson'
                   else ' for ' || r.student_name end ||
              '. Review before they publish to the student.',
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
         case when not v_logged then v_class.user_id
              else coalesce(v_class.reviewer_coach_id, su.latin_coach_id, su.ballroom_coach_id) end,
         'merge_request', 'Possible duplicate focus point',
         '"' || fb.name || '" may overlap with an existing focus point for ' ||
           coalesce(su.name, 'your student') || '.',
         jsonb_build_object('student_id', mr.student_id, 'focus_a', mr.focus_a, 'focus_b', mr.focus_b)
    from merge_requests mr
    join focus_points fb on fb.id = mr.focus_b
    join users su on su.id = mr.student_id
   where fb.class_input_id = p_class
     and mr.status = 'pending_coach'
     and case when not v_logged then v_class.user_id
              else coalesce(v_class.reviewer_coach_id, su.latin_coach_id, su.ballroom_coach_id) end is not null;

  return v_opened;
end;
$$;

-- ─── 3. The bell goes out when nothing is left to review ─────────────────────

create or replace function public.clear_reviewed_focus_notifications()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_student uuid := case when tg_op = 'DELETE' then old.user_id else new.user_id end;
begin
  update notifications n
     set read = true
   where n.read = false
     and n.type in ('focus_points_added', 'focus_point_added')
     and n.data->>'student_id' = v_student::text
     and not exists (
       select 1 from focus_points f
        where f.user_id = v_student
          and f.status = 'pending_coach'
          and f.is_deleted is not true
          and f.is_other = false
          -- One lesson's notification waits for that lesson's points only.
          and (n.data->>'class_input_id' is null
               or f.class_input_id::text = n.data->>'class_input_id')
     );
  return null;
end;
$$;

drop trigger if exists focus_review_clears_notifications on public.focus_points;
create trigger focus_review_clears_notifications
  after update of status, is_deleted on public.focus_points
  for each row
  when (old.status = 'pending_coach'
        and (new.status is distinct from 'pending_coach' or new.is_deleted is true))
  execute function public.clear_reviewed_focus_notifications();

drop trigger if exists focus_review_clears_notifications_on_delete on public.focus_points;
create trigger focus_review_clears_notifications_on_delete
  after delete on public.focus_points
  for each row
  when (old.status = 'pending_coach')
  execute function public.clear_reviewed_focus_notifications();

-- The couple's points, the same way.
create or replace function public.clear_reviewed_couple_focus_notifications()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_couple uuid := case when tg_op = 'DELETE' then old.couple_id else new.couple_id end;
begin
  update notifications n
     set read = true
   where n.read = false
     and n.type = 'focus_points_added'
     and n.data->>'couple_id' = v_couple::text
     and not exists (
       select 1 from couple_focus_points f
        where f.couple_id = v_couple
          and f.status = 'pending_coach'
          and f.is_deleted is not true
          and f.is_other = false
          and (n.data->>'class_input_id' is null
               or f.class_input_id::text = n.data->>'class_input_id')
     );
  return null;
end;
$$;

drop trigger if exists couple_focus_review_clears_notifications on public.couple_focus_points;
create trigger couple_focus_review_clears_notifications
  after update of status, is_deleted on public.couple_focus_points
  for each row
  when (old.status = 'pending_coach'
        and (new.status is distinct from 'pending_coach' or new.is_deleted is true))
  execute function public.clear_reviewed_couple_focus_notifications();

drop trigger if exists couple_focus_review_clears_notifications_on_delete on public.couple_focus_points;
create trigger couple_focus_review_clears_notifications_on_delete
  after delete on public.couple_focus_points
  for each row
  when (old.status = 'pending_coach')
  execute function public.clear_reviewed_couple_focus_notifications();

-- Bells already lit for nothing.
update public.notifications n
   set read = true
 where n.read = false
   and n.type in ('focus_points_added', 'focus_point_added')
   and n.data ? 'student_id'
   and not exists (
     select 1 from public.focus_points f
      where f.user_id::text = n.data->>'student_id'
        and f.status = 'pending_coach'
        and f.is_deleted is not true
        and f.is_other = false
        and (n.data->>'class_input_id' is null
             or f.class_input_id::text = n.data->>'class_input_id')
   );

update public.notifications n
   set read = true
 where n.read = false
   and n.type = 'focus_points_added'
   and n.data ? 'couple_id'
   and not exists (
     select 1 from public.couple_focus_points f
      where f.couple_id::text = n.data->>'couple_id'
        and f.status = 'pending_coach'
        and f.is_deleted is not true
        and f.is_other = false
        and (n.data->>'class_input_id' is null
             or f.class_input_id::text = n.data->>'class_input_id')
   );
