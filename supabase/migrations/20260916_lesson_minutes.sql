-- Lessons shows how long each lesson ran, and the time on the floor. That time
-- lives on class_recordings, which only the recording coach can read. This hands
-- back just the minutes, and only for lessons the caller can already see: the
-- visibility check is the union of class_inputs' SELECT policies, spelled out
-- because a security definer function doesn't go through them.
--
-- Minutes: the mic file's length when the audio came from the mic, else the
-- recording's start → end; several recordings of one lesson (retries) count
-- once, the longest; a recording left running is capped at three hours.
create or replace function public.lesson_minutes(p_ids uuid[])
returns table (class_input_id uuid, minutes int)
language sql
stable
security definer
set search_path = public
as $$
  with visible as (
    select ci.id
      from public.class_inputs ci
     where ci.id = any(p_ids)
       and (
         ci.user_id = auth.uid()
         or ci.student_id = auth.uid()
         or exists (select 1 from public.users u
                     where u.id = ci.user_id
                       and (u.latin_coach_id = auth.uid() or u.ballroom_coach_id = auth.uid()))
         or exists (select 1 from public.users u
                     where u.id = auth.uid()
                       and (u.latin_coach_id = ci.user_id or u.ballroom_coach_id = ci.user_id)
                       and (ci.student_id = auth.uid() or ci.student_id is null))
         or (ci.couple_id is not null and public.is_couple_participant(ci.couple_id))
         or public.guardian_can_read_class_input(ci.id)
         or ci.user_id in (select cr.student_id from public.coach_requests cr
                            where cr.coach_id = auth.uid() and cr.status = 'accepted')
       )
  )
  select r.class_input_id,
         max(least(180, greatest(1, round(coalesce(
           r.mic_file_duration_sec::numeric / 60,
           extract(epoch from (r.ended_at - r.started_at)) / 60)))))::int as minutes
    from public.class_recordings r
    join visible v on v.id = r.class_input_id
   where r.mic_file_duration_sec is not null
      or (r.started_at is not null and r.ended_at is not null)
   group by r.class_input_id;
$$;

revoke all on function public.lesson_minutes(uuid[]) from public;
grant execute on function public.lesson_minutes(uuid[]) to authenticated;
