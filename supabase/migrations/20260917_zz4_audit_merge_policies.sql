-- Audit 2026-09-17 (performance): tables with several permissive policies for
-- the same command made Postgres evaluate each one separately (Supabase advisor
-- multiple_permissive_policies). Each table below now has one policy per
-- command whose expression is the OR of the policies it replaces — exactly the
-- rule Postgres applied to them (a row passes if any permissive policy lets it;
-- a policy without WITH CHECK checks new rows with its USING). The restrictive
-- focus_points_require_admin_approval is left as it was.
--
-- Verified before applying, in one rolled-back transaction: for six real
-- accounts and anon, on every table below — rows visible, rows updatable, rows
-- deletable, and for every existing row whether an insert passes the policies —
-- identical before and after.


-- attendance_responses: replaces attendance_responses_coach_select, attendance_responses_guardian_read, attendance_responses_student_insert, attendance_responses_student_select
drop policy "attendance_responses_coach_select" on public.attendance_responses;
drop policy "attendance_responses_guardian_read" on public.attendance_responses;
drop policy "attendance_responses_student_insert" on public.attendance_responses;
drop policy "attendance_responses_student_select" on public.attendance_responses;
create policy "attendance_responses_select" on public.attendance_responses for select to public
  using (((EXISTS ( SELECT 1
   FROM class_inputs ci
  WHERE ((ci.id = attendance_responses.class_input_id) AND (ci.user_id = ( SELECT auth.uid() AS uid))))))
    or (is_guardian_of(student_id))
    or ((student_id = ( SELECT auth.uid() AS uid))));
create policy "attendance_responses_insert" on public.attendance_responses for insert to public
  with check ((student_id = ( SELECT auth.uid() AS uid)));

-- class_input_students: replaces cis_owner_all, cis_student_read_own, cis_student_update_own, class_input_students_guardian_read
drop policy "cis_owner_all" on public.class_input_students;
drop policy "cis_student_read_own" on public.class_input_students;
drop policy "cis_student_update_own" on public.class_input_students;
drop policy "class_input_students_guardian_read" on public.class_input_students;
create policy "class_input_students_select" on public.class_input_students for select to public
  using (((EXISTS ( SELECT 1
   FROM class_inputs ci
  WHERE ((ci.id = class_input_students.class_input_id) AND (ci.user_id = ( SELECT auth.uid() AS uid))))))
    or ((student_id = ( SELECT auth.uid() AS uid)))
    or (is_guardian_of(student_id)));
create policy "class_input_students_insert" on public.class_input_students for insert to public
  with check ((EXISTS ( SELECT 1
   FROM class_inputs ci
  WHERE ((ci.id = class_input_students.class_input_id) AND (ci.user_id = ( SELECT auth.uid() AS uid))))));
create policy "class_input_students_update" on public.class_input_students for update to public
  using (((EXISTS ( SELECT 1
   FROM class_inputs ci
  WHERE ((ci.id = class_input_students.class_input_id) AND (ci.user_id = ( SELECT auth.uid() AS uid))))))
    or ((student_id = ( SELECT auth.uid() AS uid))))
  with check (((EXISTS ( SELECT 1
   FROM class_inputs ci
  WHERE ((ci.id = class_input_students.class_input_id) AND (ci.user_id = ( SELECT auth.uid() AS uid))))))
    or ((student_id = ( SELECT auth.uid() AS uid))));
create policy "class_input_students_delete" on public.class_input_students for delete to public
  using ((EXISTS ( SELECT 1
   FROM class_inputs ci
  WHERE ((ci.id = class_input_students.class_input_id) AND (ci.user_id = ( SELECT auth.uid() AS uid))))));

-- class_inputs: replaces class_inputs_couple_read, class_inputs_guardian_read, class_inputs_insert, class_inputs_read, class_inputs_select, class_inputs_trainer_insert, class_inputs_trainer_read_all, class_inputs_update, coach_reads_student_classes
drop policy "class_inputs_couple_read" on public.class_inputs;
drop policy "class_inputs_guardian_read" on public.class_inputs;
drop policy "class_inputs_insert" on public.class_inputs;
drop policy "class_inputs_read" on public.class_inputs;
drop policy "class_inputs_select" on public.class_inputs;
drop policy "class_inputs_trainer_insert" on public.class_inputs;
drop policy "class_inputs_trainer_read_all" on public.class_inputs;
drop policy "class_inputs_update" on public.class_inputs;
drop policy "coach_reads_student_classes" on public.class_inputs;
create policy "class_inputs_select" on public.class_inputs for select to public
  using ((((couple_id IS NOT NULL) AND is_couple_participant(couple_id)))
    or (guardian_can_read_class_input(id))
    or (((user_id = ( SELECT auth.uid() AS uid)) OR (student_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = class_inputs.user_id) AND ((u.latin_coach_id = ( SELECT auth.uid() AS uid)) OR (u.ballroom_coach_id = ( SELECT auth.uid() AS uid)))))) OR (EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = ( SELECT auth.uid() AS uid)) AND ((u.latin_coach_id = class_inputs.user_id) OR (u.ballroom_coach_id = class_inputs.user_id)) AND ((class_inputs.student_id = ( SELECT auth.uid() AS uid)) OR (class_inputs.student_id IS NULL)))))))
    or ((( SELECT auth.uid() AS uid) = user_id))
    or (((( SELECT auth.jwt() AS jwt) ->> 'email'::text) = 'loic@danceuniteduk.com'::text))
    or ((user_id IN ( SELECT coach_requests.student_id
   FROM coach_requests
  WHERE ((coach_requests.coach_id = ( SELECT auth.uid() AS uid)) AND (coach_requests.status = 'accepted'::text))))));
create policy "class_inputs_insert" on public.class_inputs for insert to public
  with check (((( SELECT auth.uid() AS uid) = user_id))
    or (((( SELECT auth.jwt() AS jwt) ->> 'email'::text) = 'loic@danceuniteduk.com'::text)));
create policy "class_inputs_update" on public.class_inputs for update to public
  using ((( SELECT auth.uid() AS uid) = user_id))
  with check ((( SELECT auth.uid() AS uid) = user_id));

-- coach_cards: replaces coach_cards_own, coach_cards_public_read
drop policy "coach_cards_own" on public.coach_cards;
drop policy "coach_cards_public_read" on public.coach_cards;
create policy "coach_cards_select" on public.coach_cards for select to public
  using (((user_id = ( SELECT auth.uid() AS uid)))
    or (published));
create policy "coach_cards_insert" on public.coach_cards for insert to public
  with check ((user_id = ( SELECT auth.uid() AS uid)));
create policy "coach_cards_update" on public.coach_cards for update to public
  using ((user_id = ( SELECT auth.uid() AS uid)))
  with check ((user_id = ( SELECT auth.uid() AS uid)));
create policy "coach_cards_delete" on public.coach_cards for delete to public
  using ((user_id = ( SELECT auth.uid() AS uid)));

-- coach_knowledge: replaces Coaches manage own knowledge, Students read their coach knowledge
drop policy "Coaches manage own knowledge" on public.coach_knowledge;
drop policy "Students read their coach knowledge" on public.coach_knowledge;
create policy "coach_knowledge_select" on public.coach_knowledge for select to public
  using (((coach_id = ( SELECT auth.uid() AS uid)))
    or ((EXISTS ( SELECT 1
   FROM users
  WHERE ((users.id = ( SELECT auth.uid() AS uid)) AND ((users.latin_coach_id = coach_knowledge.coach_id) OR (users.ballroom_coach_id = coach_knowledge.coach_id)))))));
create policy "coach_knowledge_insert" on public.coach_knowledge for insert to public
  with check ((coach_id = ( SELECT auth.uid() AS uid)));
create policy "coach_knowledge_update" on public.coach_knowledge for update to public
  using ((coach_id = ( SELECT auth.uid() AS uid)))
  with check ((coach_id = ( SELECT auth.uid() AS uid)));
create policy "coach_knowledge_delete" on public.coach_knowledge for delete to public
  using ((coach_id = ( SELECT auth.uid() AS uid)));

-- coach_messages: replaces coach_messages_coach, coach_messages_insert, coach_messages_read, coach_messages_student, coach_messages_update
drop policy "coach_messages_coach" on public.coach_messages;
drop policy "coach_messages_insert" on public.coach_messages;
drop policy "coach_messages_read" on public.coach_messages;
drop policy "coach_messages_student" on public.coach_messages;
drop policy "coach_messages_update" on public.coach_messages;
create policy "coach_messages_select" on public.coach_messages for select to public
  using (((coach_id = ( SELECT auth.uid() AS uid)))
    or (((student_id = ( SELECT auth.uid() AS uid)) OR (coach_id = ( SELECT auth.uid() AS uid))))
    or ((student_id = ( SELECT auth.uid() AS uid))));
create policy "coach_messages_insert" on public.coach_messages for insert to public
  with check (((coach_id = ( SELECT auth.uid() AS uid)))
    or ((student_id = ( SELECT auth.uid() AS uid))));
create policy "coach_messages_update" on public.coach_messages for update to public
  using (((coach_id = ( SELECT auth.uid() AS uid)))
    or ((student_id = ( SELECT auth.uid() AS uid))))
  with check (((coach_id = ( SELECT auth.uid() AS uid)))
    or ((student_id = ( SELECT auth.uid() AS uid))));
create policy "coach_messages_delete" on public.coach_messages for delete to public
  using (((coach_id = ( SELECT auth.uid() AS uid)))
    or ((student_id = ( SELECT auth.uid() AS uid))));

-- coach_requests: replaces coach_requests_coach_respond, coach_requests_guardian_read, coach_requests_read, coach_requests_student_delete, coach_requests_student_insert, coach_requests_trainer_read_all
drop policy "coach_requests_coach_respond" on public.coach_requests;
drop policy "coach_requests_guardian_read" on public.coach_requests;
drop policy "coach_requests_read" on public.coach_requests;
drop policy "coach_requests_student_delete" on public.coach_requests;
drop policy "coach_requests_student_insert" on public.coach_requests;
drop policy "coach_requests_trainer_read_all" on public.coach_requests;
create policy "coach_requests_select" on public.coach_requests for select to public
  using ((is_guardian_of(student_id))
    or (((student_id = ( SELECT auth.uid() AS uid)) OR (coach_id = ( SELECT auth.uid() AS uid))))
    or (((( SELECT auth.jwt() AS jwt) ->> 'email'::text) = 'loic@danceuniteduk.com'::text)));
create policy "coach_requests_insert" on public.coach_requests for insert to authenticated
  with check (((student_id = ( SELECT auth.uid() AS uid)) AND (status = 'pending'::text) AND (coach_id <> ( SELECT auth.uid() AS uid)) AND is_coach(coach_id)));
create policy "coach_requests_update" on public.coach_requests for update to authenticated
  using ((coach_id = ( SELECT auth.uid() AS uid)))
  with check (((coach_id = ( SELECT auth.uid() AS uid)) AND (status = ANY (ARRAY['pending'::text, 'accepted'::text, 'declined'::text]))));
create policy "coach_requests_delete" on public.coach_requests for delete to public
  using ((student_id = ( SELECT auth.uid() AS uid)));

-- couple_focus_locks: replaces cfl_guardian_read, cfl_select
drop policy "cfl_guardian_read" on public.couple_focus_locks;
drop policy "cfl_select" on public.couple_focus_locks;
create policy "couple_focus_locks_select" on public.couple_focus_locks for select to public
  using ((is_guardian_of_couple(couple_id))
    or (is_couple_participant(couple_id)));

-- couple_focus_points: replaces cfp_guardian_read, cfp_insert, cfp_select, cfp_update
drop policy "cfp_guardian_read" on public.couple_focus_points;
drop policy "cfp_insert" on public.couple_focus_points;
drop policy "cfp_select" on public.couple_focus_points;
drop policy "cfp_update" on public.couple_focus_points;
create policy "couple_focus_points_select" on public.couple_focus_points for select to public
  using ((is_guardian_of_couple(couple_id))
    or (is_couple_participant(couple_id)));
create policy "couple_focus_points_insert" on public.couple_focus_points for insert to public
  with check (is_couple_coach(couple_id));
create policy "couple_focus_points_update" on public.couple_focus_points for update to public
  using (is_couple_coach(couple_id))
  with check (is_couple_coach(couple_id));

-- couple_practice_logs: replaces cpl_guardian_read, cpl_insert, cpl_select
drop policy "cpl_guardian_read" on public.couple_practice_logs;
drop policy "cpl_insert" on public.couple_practice_logs;
drop policy "cpl_select" on public.couple_practice_logs;
create policy "couple_practice_logs_select" on public.couple_practice_logs for select to public
  using ((is_guardian_of_couple(couple_id))
    or (is_couple_participant(couple_id)));
create policy "couple_practice_logs_insert" on public.couple_practice_logs for insert to public
  with check (is_couple_member(couple_id));

-- couple_requests: replaces couple_requests_delete, couple_requests_guardian_read, couple_requests_insert, couple_requests_select, couple_requests_update
drop policy "couple_requests_delete" on public.couple_requests;
drop policy "couple_requests_guardian_read" on public.couple_requests;
drop policy "couple_requests_insert" on public.couple_requests;
drop policy "couple_requests_select" on public.couple_requests;
drop policy "couple_requests_update" on public.couple_requests;
create policy "couple_requests_select" on public.couple_requests for select to public
  using (((is_guardian_of(requester_id) OR is_guardian_of(target_id)))
    or (((requester_id = ( SELECT auth.uid() AS uid)) OR (target_id = ( SELECT auth.uid() AS uid)))));
create policy "couple_requests_insert" on public.couple_requests for insert to public
  with check ((requester_id = ( SELECT auth.uid() AS uid)));
create policy "couple_requests_update" on public.couple_requests for update to public
  using (((requester_id = ( SELECT auth.uid() AS uid)) OR (target_id = ( SELECT auth.uid() AS uid))))
  with check (((requester_id = ( SELECT auth.uid() AS uid)) OR (target_id = ( SELECT auth.uid() AS uid))));
create policy "couple_requests_delete" on public.couple_requests for delete to public
  using (((requester_id = ( SELECT auth.uid() AS uid)) OR (target_id = ( SELECT auth.uid() AS uid))));

-- couples: replaces couples_delete, couples_guardian_read, couples_insert, couples_select
drop policy "couples_delete" on public.couples;
drop policy "couples_guardian_read" on public.couples;
drop policy "couples_insert" on public.couples;
drop policy "couples_select" on public.couples;
create policy "couples_select" on public.couples for select to public
  using (((is_guardian_of(user_a_id) OR is_guardian_of(user_b_id)))
    or (((( SELECT auth.uid() AS uid) = user_a_id) OR (( SELECT auth.uid() AS uid) = user_b_id) OR (( SELECT auth.uid() AS uid) = latin_couple_coach_id) OR (( SELECT auth.uid() AS uid) = ballroom_couple_coach_id))));
create policy "couples_insert" on public.couples for insert to authenticated
  with check ((((( SELECT auth.uid() AS uid) = user_a_id) OR (( SELECT auth.uid() AS uid) = user_b_id)) AND (latin_couple_coach_id IS NULL) AND (ballroom_couple_coach_id IS NULL)));
create policy "couples_delete" on public.couples for delete to public
  using (((( SELECT auth.uid() AS uid) = user_a_id) OR (( SELECT auth.uid() AS uid) = user_b_id)));

-- focus_points: replaces coach_reads_student_focus, coach_updates_student_focus, focus_points_guardian_insert, focus_points_guardian_read, focus_points_guardian_write, focus_points_insert, focus_points_read, focus_points_select, focus_points_trainer_read_all, focus_points_update
drop policy "coach_reads_student_focus" on public.focus_points;
drop policy "coach_updates_student_focus" on public.focus_points;
drop policy "focus_points_guardian_insert" on public.focus_points;
drop policy "focus_points_guardian_read" on public.focus_points;
drop policy "focus_points_guardian_write" on public.focus_points;
drop policy "focus_points_insert" on public.focus_points;
drop policy "focus_points_read" on public.focus_points;
drop policy "focus_points_select" on public.focus_points;
drop policy "focus_points_trainer_read_all" on public.focus_points;
drop policy "focus_points_update" on public.focus_points;
create policy "focus_points_select" on public.focus_points for select to public
  using (((user_id IN ( SELECT coach_requests.student_id
   FROM coach_requests
  WHERE ((coach_requests.coach_id = ( SELECT auth.uid() AS uid)) AND (coach_requests.status = 'accepted'::text)))))
    or (is_guardian_of(user_id))
    or (((user_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = focus_points.user_id) AND ((u.latin_coach_id = ( SELECT auth.uid() AS uid)) OR (u.ballroom_coach_id = ( SELECT auth.uid() AS uid)))))) OR (EXISTS ( SELECT 1
   FROM coach_requests cr
  WHERE ((cr.student_id = focus_points.user_id) AND (cr.coach_id = ( SELECT auth.uid() AS uid)) AND (cr.status = 'accepted'::text))))))
    or ((( SELECT auth.uid() AS uid) = user_id))
    or (((( SELECT auth.jwt() AS jwt) ->> 'email'::text) = 'loic@danceuniteduk.com'::text)));
create policy "focus_points_insert" on public.focus_points for insert to public
  with check ((is_guardian_of(user_id))
    or ((( SELECT auth.uid() AS uid) = user_id)));
create policy "focus_points_update" on public.focus_points for update to public
  using (((user_id IN ( SELECT coach_requests.student_id
   FROM coach_requests
  WHERE ((coach_requests.coach_id = ( SELECT auth.uid() AS uid)) AND (coach_requests.status = 'accepted'::text)))))
    or (is_guardian_of(user_id))
    or ((( SELECT auth.uid() AS uid) = user_id)))
  with check (((user_id IN ( SELECT coach_requests.student_id
   FROM coach_requests
  WHERE ((coach_requests.coach_id = ( SELECT auth.uid() AS uid)) AND (coach_requests.status = 'accepted'::text)))))
    or (is_guardian_of(user_id))
    or ((( SELECT auth.uid() AS uid) = user_id)));

-- focus_score_history: replaces owner_read_score_history, trainer_read_score_history
drop policy "owner_read_score_history" on public.focus_score_history;
drop policy "trainer_read_score_history" on public.focus_score_history;
create policy "focus_score_history_select" on public.focus_score_history for select to public
  using (((( SELECT auth.uid() AS uid) = user_id))
    or (((( SELECT auth.jwt() AS jwt) ->> 'email'::text) = 'loic@danceuniteduk.com'::text)));

-- merge_requests: replaces Users can read own merge requests, merge_requests_coach_read, merge_requests_coach_update
drop policy "Users can read own merge requests" on public.merge_requests;
drop policy "merge_requests_coach_read" on public.merge_requests;
drop policy "merge_requests_coach_update" on public.merge_requests;
create policy "merge_requests_select" on public.merge_requests for select to public
  using (((( SELECT auth.uid() AS uid) = student_id))
    or (((EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = merge_requests.student_id) AND ((u.latin_coach_id = ( SELECT auth.uid() AS uid)) OR (u.ballroom_coach_id = ( SELECT auth.uid() AS uid)))))) OR (EXISTS ( SELECT 1
   FROM coach_requests cr
  WHERE ((cr.student_id = merge_requests.student_id) AND (cr.coach_id = ( SELECT auth.uid() AS uid)) AND (cr.status = 'accepted'::text)))))));
create policy "merge_requests_update" on public.merge_requests for update to public
  using (((EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = merge_requests.student_id) AND ((u.latin_coach_id = ( SELECT auth.uid() AS uid)) OR (u.ballroom_coach_id = ( SELECT auth.uid() AS uid)))))) OR (EXISTS ( SELECT 1
   FROM coach_requests cr
  WHERE ((cr.student_id = merge_requests.student_id) AND (cr.coach_id = ( SELECT auth.uid() AS uid)) AND (cr.status = 'accepted'::text))))))
  with check (((EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = merge_requests.student_id) AND ((u.latin_coach_id = ( SELECT auth.uid() AS uid)) OR (u.ballroom_coach_id = ( SELECT auth.uid() AS uid)))))) OR (EXISTS ( SELECT 1
   FROM coach_requests cr
  WHERE ((cr.student_id = merge_requests.student_id) AND (cr.coach_id = ( SELECT auth.uid() AS uid)) AND (cr.status = 'accepted'::text))))));

-- notifications: replaces coach_insert_student_notifications, users_own_notifications
drop policy "coach_insert_student_notifications" on public.notifications;
drop policy "users_own_notifications" on public.notifications;
create policy "notifications_select" on public.notifications for select to public
  using ((( SELECT auth.uid() AS uid) = user_id));
create policy "notifications_insert" on public.notifications for insert to public
  with check (((EXISTS ( SELECT 1
   FROM coach_requests cr
  WHERE ((cr.coach_id = ( SELECT auth.uid() AS uid)) AND (cr.student_id = notifications.user_id) AND (cr.status = 'accepted'::text)))))
    or ((( SELECT auth.uid() AS uid) = user_id)));
create policy "notifications_update" on public.notifications for update to public
  using ((( SELECT auth.uid() AS uid) = user_id))
  with check ((( SELECT auth.uid() AS uid) = user_id));
create policy "notifications_delete" on public.notifications for delete to public
  using ((( SELECT auth.uid() AS uid) = user_id));

-- practice_logs: replaces Users can manage own practice logs, practice_logs_coach_read, practice_logs_guardian_all
drop policy "Users can manage own practice logs" on public.practice_logs;
drop policy "practice_logs_coach_read" on public.practice_logs;
drop policy "practice_logs_guardian_all" on public.practice_logs;
create policy "practice_logs_select" on public.practice_logs for select to public
  using (((( SELECT auth.uid() AS uid) = student_id))
    or (((EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = practice_logs.student_id) AND ((u.latin_coach_id = ( SELECT auth.uid() AS uid)) OR (u.ballroom_coach_id = ( SELECT auth.uid() AS uid)))))) OR (EXISTS ( SELECT 1
   FROM coach_requests cr
  WHERE ((cr.student_id = practice_logs.student_id) AND (cr.coach_id = ( SELECT auth.uid() AS uid)) AND (cr.status = 'accepted'::text))))))
    or (is_guardian_of(student_id)));
create policy "practice_logs_insert" on public.practice_logs for insert to public
  with check (((( SELECT auth.uid() AS uid) = student_id))
    or (is_guardian_of(student_id)));
create policy "practice_logs_update" on public.practice_logs for update to public
  using (((( SELECT auth.uid() AS uid) = student_id))
    or (is_guardian_of(student_id)))
  with check (((( SELECT auth.uid() AS uid) = student_id))
    or (is_guardian_of(student_id)));
create policy "practice_logs_delete" on public.practice_logs for delete to public
  using (((( SELECT auth.uid() AS uid) = student_id))
    or (is_guardian_of(student_id)));

-- users: replaces users_coach_reads_studio_members, users_coach_reads_via_requests, users_couple_read, users_guardian_read, users_guardian_sees_child_circle, users_guardian_update, users_insert, users_invite_code_lookup, users_read_own_or_student, users_select, users_self, users_student_reads_coach, users_trainer_read_all, users_update, users_update_own
drop policy "users_coach_reads_studio_members" on public.users;
drop policy "users_coach_reads_via_requests" on public.users;
drop policy "users_couple_read" on public.users;
drop policy "users_guardian_read" on public.users;
drop policy "users_guardian_sees_child_circle" on public.users;
drop policy "users_guardian_update" on public.users;
drop policy "users_insert" on public.users;
drop policy "users_invite_code_lookup" on public.users;
drop policy "users_read_own_or_student" on public.users;
drop policy "users_select" on public.users;
drop policy "users_self" on public.users;
drop policy "users_student_reads_coach" on public.users;
drop policy "users_trainer_read_all" on public.users;
drop policy "users_update" on public.users;
drop policy "users_update_own" on public.users;
create policy "users_select" on public.users for select to public
  using ((((studio_id IS NOT NULL) AND (studio_id = current_coach_studio_id())))
    or ((id IN ( SELECT coach_requests.student_id
   FROM coach_requests
  WHERE (coach_requests.coach_id = ( SELECT auth.uid() AS uid)))))
    or (((EXISTS ( SELECT 1
   FROM couples c
  WHERE (((users.id = c.user_a_id) OR (users.id = c.user_b_id)) AND ((( SELECT auth.uid() AS uid) = c.user_a_id) OR (( SELECT auth.uid() AS uid) = c.user_b_id) OR (( SELECT auth.uid() AS uid) = c.latin_couple_coach_id) OR (( SELECT auth.uid() AS uid) = c.ballroom_couple_coach_id))))) OR (EXISTS ( SELECT 1
   FROM couple_requests r
  WHERE (((r.requester_id = ( SELECT auth.uid() AS uid)) AND (r.target_id = users.id)) OR ((r.target_id = ( SELECT auth.uid() AS uid)) AND (r.requester_id = users.id)))))))
    or (is_guardian_of(id))
    or (guardian_can_see_user(id))
    or (((invite_code IS NOT NULL) AND (role = 'coach'::text)))
    or (((id = ( SELECT auth.uid() AS uid)) OR (latin_coach_id = ( SELECT auth.uid() AS uid)) OR (ballroom_coach_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM coach_requests cr
  WHERE ((cr.student_id = users.id) AND (cr.coach_id = ( SELECT auth.uid() AS uid)) AND (cr.status = 'accepted'::text))))))
    or ((( SELECT auth.uid() AS uid) = id))
    or ((id = ( SELECT auth.uid() AS uid)))
    or (is_my_coach(id))
    or (((( SELECT auth.jwt() AS jwt) ->> 'email'::text) = 'loic@danceuniteduk.com'::text)));
create policy "users_insert" on public.users for insert to public
  with check (((( SELECT auth.uid() AS uid) = id))
    or ((id = ( SELECT auth.uid() AS uid))));
create policy "users_update" on public.users for update to public
  using ((is_guardian_of(id))
    or ((id = ( SELECT auth.uid() AS uid)))
    or ((( SELECT auth.uid() AS uid) = id)))
  with check ((is_guardian_of(id))
    or ((id = ( SELECT auth.uid() AS uid)))
    or ((( SELECT auth.uid() AS uid) = id)));
create policy "users_delete" on public.users for delete to public
  using ((id = ( SELECT auth.uid() AS uid)));
