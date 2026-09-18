-- One-off: apply 20260918b's rule to what was already live. An active group
-- focus point moves to past when the same student has a published (active or
-- past, not deleted) focus point from a newer group lesson of the same coach,
-- in the same style. 27 rows on 2026-09-18 (3 students, all Marius Iepure).

with latin as (
  select array['Cha Cha', 'Samba', 'Rumba', 'Paso Doble', 'Jive']::text[] a
),
g as (
  select fp.id, fp.user_id, fp.status, ci.user_id as coach, ci.created_at as cls_at,
         case when fp.dance is null or cardinality(fp.dance) = 0 then null
              when fp.dance && (select a from latin) then 'latin'
              else 'ballroom' end as cat
  from focus_points fp
  join class_inputs ci on ci.id = coalesce(fp.source_class_input_id, fp.class_input_id)
  join users cu on cu.id = ci.user_id and cu.role = 'coach'
  where fp.group_fp and not fp.is_deleted and not fp.is_other and fp.user_id is not null
    and fp.status in ('active', 'past')
    and ci.lesson_type in ('group', 'public') and ci.is_deleted is not true
)
update focus_points f
set status = 'past'
from g
where f.id = g.id
  and g.status = 'active'
  and exists (
    select 1 from g n
    where n.user_id = g.user_id and n.coach = g.coach and n.cls_at > g.cls_at
      and (g.cat is null or n.cat is null or n.cat = g.cat)
  );
