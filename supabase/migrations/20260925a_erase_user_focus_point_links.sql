-- The erasure fell over on a focus point pointing at the lesson it came from.
--
-- `erase_user` starts by deleting the private lessons that are ABOUT the person
-- (their transcript is a recording of them). But focus_points.class_input_id is
-- a NO ACTION reference: while a focus point still names that lesson, the
-- lesson cannot go, and the whole transaction rolls back with
--
--   violates foreign key constraint "focus_points_class_input_id_fkey"
--
-- The account that the original was verified on happened to have no focus point
-- attached to a lesson taught by someone else, so the case never came up. The
-- first real deletion of a student with a coach hit it immediately.
--
-- Two references are added here, both of the same shape — a row that survives
-- the erasure holding a key to a row that does not:
--
--   · focus_points.class_input_id → the lessons about to be deleted. A private
--     lesson has exactly one student, so these focus points are the erased
--     person's own and go with them. Anything else found there belongs to
--     someone else and is unlinked, not deleted: losing the lesson reference is
--     the lesser harm.
--   · focus_points.alias_of / .merge_candidate_id → the erased person's own
--     focus points, from another person's row. These exist because a couple's
--     two plans get merged, so a partner's focus point can point at theirs; the
--     cascade that removes this person's focus points would be refused by their
--     partner's. Unlinked, again, rather than deleted — the partner keeps the
--     focus point, it just stops being an alias of a row that no longer exists.
--
-- Everything else about the function is unchanged, including what it keeps.

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

  -- 1. The focus points that name a lesson about to be deleted. NO ACTION, so
  --    they have to move first — their own go, anyone else's is only unlinked.
  delete from focus_points
   where user_id = p_user
     and class_input_id in (select id from class_inputs where student_id = p_user);
  update focus_points
     set class_input_id = null
   where class_input_id in (select id from class_inputs where student_id = p_user);

  -- 2. Lessons that are ABOUT this person, taught by someone else. A private
  --    lesson's transcript is a recording of them, so it goes with them; this
  --    also clears the NO ACTION reference that would otherwise refuse the
  --    delete outright.
  delete from class_inputs where student_id = p_user;

  -- 3. Group lessons stay for the other dancers — the person is taken out of
  --    them instead.
  update class_inputs
     set student_ids = array_remove(student_ids, p_user)
   where student_ids @> array[p_user];

  -- 4. Private recordings OF this person, taught by someone else. Same rule as
  --    their class_inputs above — and the constraint leaves no choice:
  --    class_recordings_private_has_student forbids a private recording with a
  --    null student, which is what the SET NULL foreign key would produce.
  delete from class_recordings where student_id = p_user and lesson_type = 'private';
  update class_recordings set student_id = null where student_id = p_user;

  -- 5. The partnership goes with the person. couples.leader_user_id is NOT
  --    NULL, so it cannot be blanked, and the row would be deleted by the
  --    cascade on user_a_id / user_b_id anyway — do it here, in the open,
  --    including the couples this person only led or coached.
  delete from couples
   where user_a_id = p_user or user_b_id = p_user or leader_user_id = p_user;
  delete from couple_requests
   where requester_id = p_user or target_id = p_user or proposed_leader_id = p_user;

  -- 6. A partner's focus point can be an alias of, or a merge candidate for,
  --    one of this person's — that is what merging a couple's two plans leaves
  --    behind. Both references are NO ACTION and would refuse the cascade.
  --    The partner keeps their focus point; it simply stops pointing at a row
  --    that no longer exists.
  update focus_points
     set alias_of = null
   where alias_of in (select id from focus_points where user_id = p_user)
     and user_id <> p_user;
  update focus_points
     set merge_candidate_id = null
   where merge_candidate_id in (select id from focus_points where user_id = p_user)
     and user_id <> p_user;

  -- 7. The remaining NO ACTION references: the "edited by" / "approved by"
  --    audit stamps, which have no business keeping an erased person's id
  --    alive.
  update class_inputs set admin_approved_by = null where admin_approved_by = p_user;
  delete from class_input_edits where edited_by = p_user;
  delete from focus_point_edits where edited_by = p_user;

  -- 8. The account. public.users.id references auth.users on delete cascade,
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

-- Rollback: re-apply 20260923e, which is this function without steps 1 and 6.
