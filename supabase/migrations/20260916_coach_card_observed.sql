-- What a coach actually does, for the parts of his card that unlock with use.
-- The card's declared answers are his; these figures come from his captured
-- lessons, so a prospect reads evidence rather than a promise.
--
-- Aggregates only — category and dance counts, lesson and student totals —
-- never a student's name or a correction's text. Security definer so the
-- counts can span his students' focus points, which RLS rightly hides from
-- everyone else; readable by the coach himself, or by anyone once his card is
-- published, since the published card is what shows them.
create or replace function public.coach_card_observed(target uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with allowed as (
    select 1
    where target = auth.uid()
       or exists (select 1 from public.coach_cards c where c.user_id = target and c.published)
  ),
  lessons as (
    -- a lesson counts once it has been processed and not rejected
    select ci.id
      from public.class_inputs ci
     where ci.user_id = target
       and coalesce(ci.is_deleted, false) = false
       and ci.status in ('scored', 'extracted')
       and ci.admin_rejected_at is null
  ),
  corrections as (
    select fp.category, fp.dance, fp.user_id
      from public.focus_points fp
     where fp.class_input_id in (select id from lessons)
       and coalesce(fp.is_deleted, false) = false
       and coalesce(fp.is_other, false) = false
  )
  select case when not exists (select 1 from allowed) then null else jsonb_build_object(
    'lessons', (select count(*) from lessons),
    'students', (select count(distinct user_id) from corrections),
    'corrections', (select count(*) from corrections),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object('name', category, 'count', n) order by n desc)
        from (select category, count(*) n from corrections where category is not null group by category) x
    ), '[]'::jsonb),
    'dances', coalesce((
      select jsonb_agg(jsonb_build_object('name', d, 'count', n) order by n desc)
        from (select d, count(*) n from corrections, unnest(coalesce(dance, '{}')) d group by d) y
    ), '[]'::jsonb)
  ) end;
$$;
revoke all on function public.coach_card_observed(uuid) from public;
grant execute on function public.coach_card_observed(uuid) to anon, authenticated;
