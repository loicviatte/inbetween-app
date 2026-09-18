-- Coach ▸ Students ▸ Links ▸ Edit: a coach changes the styles they coach a
-- student (or a couple) in, or removes them.
--
-- The coach can't write users.latin_coach_id / ballroom_coach_id (no RLS
-- policy lets them), so both changes go through these SECURITY DEFINER
-- functions, which only act on the caller's own links:
--   * a style is added only if no other coach holds it — a coach never takes a
--     student from another coach. A student who didn't dance it yet now does
--     (Latin → Latin & Ballroom); a couple must already dance it (their dance
--     types change only with both partners' approval);
--   * turning every style off removes the link altogether.
-- The student (both dancers) get a notification saying what changed.

-- A link written as already accepted is not a request: don't tell the coach
-- they have a new one (every other insert is 'pending').
create or replace function public.notify_coach_request()
returns trigger
language plpgsql
security definer
as $function$
declare
  v_student_name text;
begin
  if new.status is distinct from 'pending' then
    return new;
  end if;

  select name into v_student_name from public.users where id = new.student_id;

  insert into public.notifications (user_id, type, title, body, data)
  values (
    new.coach_id,
    'coach_request_received',
    'New student request',
    coalesce(v_student_name, 'Someone') || ' wants to add you as their coach.',
    jsonb_build_object('request_id', new.id, 'student_id', new.student_id)
  );

  return new;
end;
$function$;

create or replace function public.coach_set_student_link(p_student uuid, p_latin boolean, p_ballroom boolean)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_coach uuid := auth.uid();
  v_coach_name text;
  u public.users;
  v_dances text[];
  v_has_latin boolean;
  v_has_ballroom boolean;
  v_added text[] := '{}';
  v_removed text[] := '{}';
  v_cat text;
  v_want boolean;
  v_has boolean;
  v_holder uuid;
  v_new_dance boolean := false;
begin
  if v_coach is null then raise exception 'Not signed in.'; end if;

  select * into u from public.users where id = p_student;
  if not found then raise exception 'Student not found.'; end if;

  -- Styles held now: accepted requests by category, or the users column.
  v_has_latin := coalesce(u.latin_coach_id = v_coach, false) or exists (
    select 1 from public.coach_requests
    where coach_id = v_coach and student_id = p_student and status = 'accepted' and category = 'latin');
  v_has_ballroom := coalesce(u.ballroom_coach_id = v_coach, false) or exists (
    select 1 from public.coach_requests
    where coach_id = v_coach and student_id = p_student and status = 'accepted' and category = 'ballroom');

  if not (v_has_latin or v_has_ballroom or exists (
    select 1 from public.coach_requests
    where coach_id = v_coach and student_id = p_student and status = 'accepted')) then
    raise exception 'This student isn''t linked to you.';
  end if;

  -- A legacy request with no style meant "both": count it as the styles the
  -- student dances, so it can be edited like the others.
  if exists (select 1 from public.coach_requests
             where coach_id = v_coach and student_id = p_student and status = 'accepted' and category is null) then
    if not (v_has_latin or v_has_ballroom) then
      v_has_latin := coalesce(u.dance_style, '') <> 'Ballroom';
      v_has_ballroom := coalesce(u.dance_style, '') <> 'Latin';
    end if;
  end if;

  v_dances := case u.dance_style
    when 'Latin' then array['latin']
    when 'Ballroom' then array['ballroom']
    else array['latin', 'ballroom'] end;

  select name into v_coach_name from public.users where id = v_coach;

  -- Rewrite the links style by style.
  delete from public.coach_requests
  where coach_id = v_coach and student_id = p_student and status = 'accepted' and category is null;

  foreach v_cat in array array['latin', 'ballroom'] loop
    v_want := case v_cat when 'latin' then coalesce(p_latin, false) else coalesce(p_ballroom, false) end;
    v_has := case v_cat when 'latin' then v_has_latin else v_has_ballroom end;
    v_holder := case v_cat when 'latin' then u.latin_coach_id else u.ballroom_coach_id end;

    if v_want and not v_has then
      if not (v_cat = any (v_dances)) then
        v_new_dance := true;
      end if;
      if (v_holder is not null and v_holder <> v_coach) or exists (
        select 1 from public.coach_requests
        where student_id = p_student and coach_id <> v_coach and category = v_cat and status = 'accepted') then
        raise exception 'This student already has a % coach.', initcap(v_cat);
      end if;
      v_added := v_added || v_cat;
    elsif not v_want and v_has then
      v_removed := v_removed || v_cat;
    end if;

    if v_want then
      insert into public.coach_requests (coach_id, student_id, category, status)
      values (v_coach, p_student, v_cat, 'accepted')
      on conflict (student_id, coach_id, (coalesce(category, ''))) do update set status = 'accepted';
      if v_cat = 'latin' then
        update public.users set latin_coach_id = v_coach
        where id = p_student and (latin_coach_id is null or latin_coach_id = v_coach);
      else
        update public.users set ballroom_coach_id = v_coach
        where id = p_student and (ballroom_coach_id is null or ballroom_coach_id = v_coach);
      end if;
    elsif v_has then
      delete from public.coach_requests where coach_id = v_coach and student_id = p_student and category = v_cat;
      if v_cat = 'latin' then
        update public.users set latin_coach_id = null where id = p_student and latin_coach_id = v_coach;
      else
        update public.users set ballroom_coach_id = null where id = p_student and ballroom_coach_id = v_coach;
      end if;
    end if;
  end loop;

  -- Coached in a style they didn't dance yet: they dance both now.
  if v_new_dance then
    update public.users set dance_style = 'Latin & Ballroom' where id = p_student;
  end if;

  -- Nothing left: no request of any kind stays between them.
  if not coalesce(p_latin, false) and not coalesce(p_ballroom, false) then
    delete from public.coach_requests where coach_id = v_coach and student_id = p_student;
  end if;

  if cardinality(v_added) > 0 or cardinality(v_removed) > 0 then
    insert into public.notifications (user_id, type, title, body, data)
    values (
      p_student,
      'coach_link_changed',
      'Coach update',
      case
        when not coalesce(p_latin, false) and not coalesce(p_ballroom, false)
          then coalesce(v_coach_name, 'Your coach') || ' is no longer your coach.'
        when cardinality(v_added) > 0 and cardinality(v_removed) = 0
          then coalesce(v_coach_name, 'Your coach') || ' now coaches you in ' || array_to_string(array(select initcap(x) from unnest(v_added) x), ' and ') || ' too.'
        when cardinality(v_added) = 0
          then coalesce(v_coach_name, 'Your coach') || ' no longer coaches you in ' || array_to_string(array(select initcap(x) from unnest(v_removed) x), ' and ') || '.'
        else coalesce(v_coach_name, 'Your coach') || ' now coaches you in ' || array_to_string(array(select initcap(x) from unnest(v_added) x), ' and ')
          || ' instead of ' || array_to_string(array(select initcap(x) from unnest(v_removed) x), ' and ') || '.'
      end,
      jsonb_build_object('coach_id', v_coach, 'added', to_jsonb(v_added), 'removed', to_jsonb(v_removed))
    );
  end if;

  return jsonb_build_object('added', to_jsonb(v_added), 'removed', to_jsonb(v_removed));
end;
$function$;

create or replace function public.coach_set_couple_link(p_couple uuid, p_latin boolean, p_ballroom boolean)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_coach uuid := auth.uid();
  v_coach_name text;
  c public.couples;
  v_added text[] := '{}';
  v_removed text[] := '{}';
  v_cat text;
  v_want boolean;
  v_holder uuid;
  v_dances boolean;
begin
  if v_coach is null then raise exception 'Not signed in.'; end if;

  select * into c from public.couples where id = p_couple and unpaired_at is null;
  if not found then raise exception 'Couple not found.'; end if;
  if v_coach is distinct from c.latin_couple_coach_id and v_coach is distinct from c.ballroom_couple_coach_id then
    raise exception 'This couple isn''t linked to you.';
  end if;

  select name into v_coach_name from public.users where id = v_coach;

  foreach v_cat in array array['latin', 'ballroom'] loop
    v_want := case v_cat when 'latin' then coalesce(p_latin, false) else coalesce(p_ballroom, false) end;
    v_holder := case v_cat when 'latin' then c.latin_couple_coach_id else c.ballroom_couple_coach_id end;
    v_dances := case v_cat when 'latin' then c.does_latin else c.does_ballroom end;

    if v_want and v_holder is distinct from v_coach then
      if not coalesce(v_dances, false) then
        raise exception 'This couple doesn''t dance %.', initcap(v_cat);
      end if;
      if v_holder is not null then
        raise exception 'This couple already has a % couple coach.', initcap(v_cat);
      end if;
      if v_cat = 'latin' then
        update public.couples set latin_couple_coach_id = v_coach where id = p_couple;
      else
        update public.couples set ballroom_couple_coach_id = v_coach where id = p_couple;
      end if;
      v_added := v_added || v_cat;
    elsif not v_want and v_holder = v_coach then
      if v_cat = 'latin' then
        update public.couples set latin_couple_coach_id = null where id = p_couple;
      else
        update public.couples set ballroom_couple_coach_id = null where id = p_couple;
      end if;
      delete from public.couple_coach_requests where couple_id = p_couple and coach_id = v_coach and category = v_cat;
      v_removed := v_removed || v_cat;
    end if;
  end loop;

  if cardinality(v_added) > 0 or cardinality(v_removed) > 0 then
    insert into public.notifications (user_id, type, title, body, data)
    select uid, 'couple_coach_link_changed', 'Couple coach update',
      case
        when not coalesce(p_latin, false) and not coalesce(p_ballroom, false)
          then coalesce(v_coach_name, 'Your coach') || ' is no longer your couple coach.'
        when cardinality(v_added) > 0 and cardinality(v_removed) = 0
          then coalesce(v_coach_name, 'Your coach') || ' is now your ' || array_to_string(array(select initcap(x) from unnest(v_added) x), ' and ') || ' couple coach too.'
        when cardinality(v_added) = 0
          then coalesce(v_coach_name, 'Your coach') || ' is no longer your ' || array_to_string(array(select initcap(x) from unnest(v_removed) x), ' and ') || ' couple coach.'
        else coalesce(v_coach_name, 'Your coach') || ' is now your ' || array_to_string(array(select initcap(x) from unnest(v_added) x), ' and ')
          || ' couple coach instead of ' || array_to_string(array(select initcap(x) from unnest(v_removed) x), ' and ') || '.'
      end,
      jsonb_build_object('couple_id', p_couple, 'coach_id', v_coach, 'added', to_jsonb(v_added), 'removed', to_jsonb(v_removed))
    from (values (c.user_a_id), (c.user_b_id)) as m(uid)
    where uid is not null;
  end if;

  return jsonb_build_object('added', to_jsonb(v_added), 'removed', to_jsonb(v_removed));
end;
$function$;

revoke all on function public.coach_set_student_link(uuid, boolean, boolean) from public, anon;
grant execute on function public.coach_set_student_link(uuid, boolean, boolean) to authenticated;
revoke all on function public.coach_set_couple_link(uuid, boolean, boolean) from public, anon;
grant execute on function public.coach_set_couple_link(uuid, boolean, boolean) to authenticated;
