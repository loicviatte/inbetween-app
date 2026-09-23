-- A deletion request has to actually delete.
--
-- Until now there was no deletion path at all: no function, no button, no
-- script. The foreign keys were built for it — public.users.id references
-- auth.users on delete cascade, and almost every table cascades from
-- public.users — but four references are NO ACTION and would simply refuse the
-- delete, and nothing at all reaches into storage. So a "deletion" would have
-- failed with a foreign-key error, or half-succeeded and left the audio.
--
-- This function is the erasure itself, in one transaction. The caller (the
-- erase-user edge function) deletes the storage objects first, because storage
-- is not transactional and files are the one thing that cannot be recovered by
-- re-running.
--
-- What goes:
--   · the account (auth + profile) and, by cascade, every row keyed to it —
--     focus points, practice logs, notes, notifications, push tokens, events,
--     coach knowledge, attendance, merge requests, score history, couples…
--   · lessons the person OWNS (class_inputs.user_id) with their transcripts,
--     summaries and recordings
--   · private lessons ABOUT them taught by someone else
--     (class_inputs.student_id): the transcript is a recording of them
--
-- What stays, deliberately:
--   · group lessons taught by someone else — other students' data. The erased
--     person is removed from the roster and from student_ids; the lesson and
--     its transcript remain the coach's record of the other dancers
--   · parental_consents, whose user references are SET NULL: the proof that
--     permission was given and withdrawn outlives the data, exactly as the
--     consent text promises
--   · ai_call_logs rows (user_id SET NULL): token counts and costs, no content
--   · one data_erasures row: counts, never content
--
-- There is no model-side cache to clear: prompts are sent per request and
-- Anthropic's prompt cache is ephemeral and keyed to the request, nothing of a
-- user is persisted with the provider between calls.
--
-- p_dry_run = true counts everything and changes nothing.

create or replace function public.erase_user(
  p_user uuid,
  p_dry_run boolean default true,
  p_requested_by text default 'support'
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_email text;
  v_role text;
  v_counts jsonb;
begin
  if p_user is null then
    raise exception 'erase_user: no user';
  end if;

  select u.email, u.role into v_email, v_role from public.users u where u.id = p_user;
  if v_email is null then
    select au.email into v_email from auth.users au where au.id = p_user;
  end if;
  if v_email is null then
    return jsonb_build_object('error', 'no such user', 'user_id', p_user);
  end if;

  -- What is about to go. Counted before anything is touched, so a dry run and
  -- a real run report the same numbers.
  select jsonb_build_object(
    'class_inputs_owned',      (select count(*) from class_inputs where user_id = p_user),
    'class_inputs_about',      (select count(*) from class_inputs where student_id = p_user),
    'group_lessons_unlinked',  (select count(*) from class_inputs where student_ids @> array[p_user] and user_id <> p_user and student_id is distinct from p_user),
    'class_recordings',        (select count(*) from class_recordings where user_id = p_user),
    'class_recording_chunks',  (select count(*) from class_recording_chunks c join class_recordings r on r.id = c.recording_id where r.user_id = p_user),
    'focus_points',            (select count(*) from focus_points where user_id = p_user),
    'focus_score_history',     (select count(*) from focus_score_history where user_id = p_user),
    'practice_logs',           (select count(*) from practice_logs where student_id = p_user),
    'notes',                   (select count(*) from notes where user_id = p_user),
    'coach_knowledge',         (select count(*) from coach_knowledge where coach_id = p_user),
    'coach_messages',          (select count(*) from coach_messages where student_id = p_user or coach_id = p_user),
    'notifications',           (select count(*) from notifications where user_id = p_user),
    'user_events',             (select count(*) from user_events where user_id = p_user),
    'push_tokens',             (select count(*) from push_tokens where user_id = p_user),
    'attendance_responses',    (select count(*) from attendance_responses where student_id = p_user),
    'unmatched_recordings',    (select count(*) from unmatched_recordings where user_id = p_user)
  ) into v_counts;

  if p_dry_run then
    return jsonb_build_object(
      'dry_run', true, 'user_id', p_user, 'email', v_email, 'role', v_role, 'counts', v_counts
    );
  end if;

  -- 1. Lessons that are ABOUT this person, taught by someone else. A private
  --    lesson's transcript is a recording of them, so it goes with them; this
  --    also clears the NO ACTION reference that would otherwise refuse the
  --    delete outright.
  delete from class_inputs where student_id = p_user;

  -- 2. Group lessons stay for the other dancers — the person is taken out of
  --    them instead.
  update class_inputs
     set student_ids = array_remove(student_ids, p_user)
   where student_ids @> array[p_user];

  -- 3. Private recordings OF this person, taught by someone else. Same rule as
  --    their class_inputs above — and the constraint leaves no choice:
  --    class_recordings_private_has_student forbids a private recording with a
  --    null student, which is what the SET NULL foreign key would produce.
  delete from class_recordings where student_id = p_user and lesson_type = 'private';
  update class_recordings set student_id = null where student_id = p_user;

  -- 4. The partnership goes with the person. couples.leader_user_id is NOT
  --    NULL, so it cannot be blanked, and the row would be deleted by the
  --    cascade on user_a_id / user_b_id anyway — do it here, in the open,
  --    including the couples this person only led or coached.
  delete from couples
   where user_a_id = p_user or user_b_id = p_user or leader_user_id = p_user;
  delete from couple_requests
   where requester_id = p_user or target_id = p_user or proposed_leader_id = p_user;

  -- 5. The remaining NO ACTION references: the "edited by" / "approved by"
  --    audit stamps, which have no business keeping an erased person's id
  --    alive.
  update class_inputs set admin_approved_by = null where admin_approved_by = p_user;
  delete from class_input_edits where edited_by = p_user;
  delete from focus_point_edits where edited_by = p_user;

  -- 6. The account. public.users.id references auth.users on delete cascade,
  --    so one delete takes the profile and every table keyed to it.
  delete from auth.users where id = p_user;

  insert into public.data_erasures (subject_id, subject_email, subject_role, requested_by, deleted)
  values (p_user, v_email, v_role, p_requested_by, v_counts);

  return jsonb_build_object(
    'dry_run', false, 'user_id', p_user, 'email', v_email, 'role', v_role, 'counts', v_counts
  );
end;
$$;

revoke execute on function public.erase_user(uuid, boolean, text) from public, anon, authenticated;

-- Every audio object belonging to a user, for the storage half of the erasure
-- (the edge function deletes these before calling erase_user). Service-role
-- only, like expired_audio_objects.
create or replace function public.user_audio_objects(p_user uuid)
returns table (bucket text, name text)
language sql
security definer
set search_path = storage, pg_temp
as $$
  select o.bucket_id, o.name
    from storage.objects o
   where o.bucket_id in ('class-audio', 'avatars')
     and o.name like p_user::text || '/%'
$$;

revoke execute on function public.user_audio_objects(uuid) from public, anon, authenticated;

-- Rollback:
--   drop function if exists public.erase_user(uuid, boolean, text);
--   drop function if exists public.user_audio_objects(uuid);
