-- Coach ▸ Settings ▸ Dance studio: a coach who moves studio leaves their
-- current students and couples behind. One call changes the studio and ends
-- every link — accepted and pending requests, the students' coach slots, the
-- couples' couple-coach slots — and tells each dancer once. The app asks the
-- coach to hold a button for 3 seconds before calling it.

create or replace function public.coach_change_studio(p_studio uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_coach uuid := auth.uid();
  v_name text;
  v_old uuid;
  v_role text;
  v_students uuid[];
  v_couples uuid[];
  v_dancers uuid[];
begin
  if v_coach is null then raise exception 'Not signed in.'; end if;

  select name, studio_id, role into v_name, v_old, v_role from public.users where id = v_coach;
  if v_role is distinct from 'coach' then raise exception 'Only a coach can do this.'; end if;
  if p_studio is not distinct from v_old then
    return jsonb_build_object('students', 0, 'couples', 0);
  end if;
  if p_studio is not null and not exists (select 1 from public.studios where id = p_studio) then
    raise exception 'Studio not found.';
  end if;

  select coalesce(array_agg(distinct sid), '{}') into v_students from (
    select student_id as sid from public.coach_requests where coach_id = v_coach and status = 'accepted'
    union
    select id from public.users where latin_coach_id = v_coach or ballroom_coach_id = v_coach
  ) s where sid is not null;

  select coalesce(array_agg(id), '{}') into v_couples
  from public.couples
  where unpaired_at is null and v_coach in (latin_couple_coach_id, ballroom_couple_coach_id);

  select coalesce(array_agg(distinct uid), '{}') into v_dancers from (
    select unnest(array[user_a_id, user_b_id]) as uid from public.couples where id = any (v_couples)
  ) d where uid is not null and not (uid = any (v_students));

  delete from public.coach_requests where coach_id = v_coach;
  update public.users set latin_coach_id = null where latin_coach_id = v_coach;
  update public.users set ballroom_coach_id = null where ballroom_coach_id = v_coach;

  update public.couples set latin_couple_coach_id = null where latin_couple_coach_id = v_coach;
  update public.couples set ballroom_couple_coach_id = null where ballroom_couple_coach_id = v_coach;
  delete from public.couple_coach_requests where coach_id = v_coach;

  update public.users set studio_id = p_studio where id = v_coach;

  insert into public.notifications (user_id, type, title, body, data)
  select uid, 'coach_link_changed', 'Coach update',
    coalesce(v_name, 'Your coach') || ' changed studio and is no longer your coach.',
    jsonb_build_object('coach_id', v_coach, 'reason', 'studio')
  from unnest(v_students || v_dancers) as uid;

  return jsonb_build_object('students', cardinality(v_students), 'couples', cardinality(v_couples));
end;
$function$;

revoke all on function public.coach_change_studio(uuid) from public, anon;
grant execute on function public.coach_change_studio(uuid) to authenticated;
