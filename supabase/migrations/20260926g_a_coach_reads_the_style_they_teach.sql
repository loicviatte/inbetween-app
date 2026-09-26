-- A coach reads the style they teach that dancer, and nothing else.
--
-- Esther has two coaches: Tanya for Latin, Nataliia for Ballroom. The app has
-- always shown each of them only their own style — the roster, the metrics and
-- the readiness are all filtered by the coach's category. The database was not:
-- the read policy says "my students' focus points", full stop. Signed in as
-- Nataliia, a Ballroom coach, I read 169 Latin focus points belonging to her
-- four students, taught by Tanya and by Marius, against 18 of her own.
--
-- That is the same shape as the leak closed an hour ago in 20260926f, and the
-- same shape the legal review flagged for the knowledge base in September: a
-- boundary that exists in the client and not in the data. It holds until
-- someone calls the API directly, or until one screen forgets its filter.
--
-- The rule, as a second RESTRICTIVE policy — the dancer, their guardian and
-- the admin keep everything, and a coach gets:
--
--   · what they taught. The class is theirs, so is what came out of it,
--     whatever style it was tagged with (a Latin group class taught to a
--     dancer you coach in Ballroom is still your lesson).
--   · the style they coach that dancer in, from the accepted coach_request's
--     category, or from users.latin_coach_id / ballroom_coach_id. A focus
--     point with no dance belongs to no style and stays visible to both, which
--     is what the app already does with untagged focuses.
--
-- The couple table gets the same rule against the couple's two coach columns.

create or replace function public.focus_category_of(p_dance text[])
returns text
language sql
immutable
as $$
  select case
    when p_dance is null or cardinality(p_dance) = 0 then null
    when p_dance && array['Cha Cha','Samba','Rumba','Paso Doble','Jive'] then 'latin'
    else 'ballroom'
  end
$$;

comment on function public.focus_category_of(text[]) is
  'Latin, Ballroom, or null for an untagged focus point. Same rule as get_lesson_readiness and the app''s danceCategory helper: anything that is not one of the five Latin dances is Ballroom.';

create or replace function public.coach_sees_focus(p_student uuid, p_dance text[], p_class uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    -- The lesson is theirs, so is what it produced.
    exists (
      select 1 from class_inputs ci
       where ci.id = p_class and ci.user_id = (select auth.uid())
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

grant execute on function public.focus_category_of(text[]) to authenticated, service_role;
grant execute on function public.coach_sees_focus(uuid, text[], uuid) to authenticated, service_role;

drop policy if exists focus_points_style_boundary on public.focus_points;
create policy focus_points_style_boundary
  on public.focus_points
  as restrictive
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or public.is_guardian_of(user_id)
    or ((select auth.jwt()) ->> 'email') = public.admin_email()
    or public.coach_sees_focus(user_id, dance, class_input_id)
  );

-- The couple's own focus points, against the couple's two coach columns.
create or replace function public.coach_sees_couple_focus(p_couple uuid, p_dance text[])
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from couples c
     where c.id = p_couple
       and (
         (c.latin_couple_coach_id = (select auth.uid())
            and public.focus_category_of(p_dance) is distinct from 'ballroom')
         or (c.ballroom_couple_coach_id = (select auth.uid())
            and public.focus_category_of(p_dance) is distinct from 'latin')
       )
  )
$$;

grant execute on function public.coach_sees_couple_focus(uuid, text[]) to authenticated, service_role;

drop policy if exists couple_focus_points_style_boundary on public.couple_focus_points;
create policy couple_focus_points_style_boundary
  on public.couple_focus_points
  as restrictive
  for select
  to authenticated
  using (
    public.is_guardian_of_couple(couple_id)
    or exists (
      select 1 from couples c
       where c.id = couple_focus_points.couple_id
         and (select auth.uid()) = any (array[c.user_a_id, c.user_b_id])
    )
    or ((select auth.jwt()) ->> 'email') = public.admin_email()
    or public.coach_sees_couple_focus(couple_id, dance)
  );

-- Rollback:
--   drop policy if exists focus_points_style_boundary on public.focus_points;
--   drop policy if exists couple_focus_points_style_boundary on public.couple_focus_points;
--   drop function if exists public.coach_sees_focus(uuid, text[], uuid);
--   drop function if exists public.coach_sees_couple_focus(uuid, text[]);
--   drop function if exists public.focus_category_of(text[]);
