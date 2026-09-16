-- Which of this coach's students are waiting on them to look at their age
-- again — so the roster can show them in yellow rather than grey.
create or replace function public.coach_pending_age_reviews()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select distinct r.student_id
    from public.age_reviews r
   where r.coach_id = auth.uid() and r.kind = 'coach' and r.status = 'pending';
$$;
revoke all on function public.coach_pending_age_reviews() from public, anon;
grant execute on function public.coach_pending_age_reviews() to authenticated;
