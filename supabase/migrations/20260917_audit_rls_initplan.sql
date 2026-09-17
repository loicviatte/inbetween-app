-- Audit 2026-09-17 (performance): row-level policies called auth.uid() /
-- auth.jwt() / auth.email() once per row. Wrapped in (select ...) Postgres
-- evaluates them once per query (Supabase advisor auth_rls_initplan). Same
-- rules, same rows visible — verified by comparing every RLS table's visible
-- row count for six real accounts before and after, in one transaction.
-- Generated from the live policy definitions.

alter policy "ai_call_logs_trainer_read" on public.ai_call_logs using ((((select auth.jwt()) ->> 'email'::text) = 'loic@danceuniteduk.com'::text));
alter policy "ai_feedback_trainer_all" on public.ai_feedback using ((((select auth.jwt()) ->> 'email'::text) = 'loic@danceuniteduk.com'::text)) with check ((((select auth.jwt()) ->> 'email'::text) = 'loic@danceuniteduk.com'::text));
alter policy "ai_training_candidates_trainer_all" on public.ai_training_candidates using ((((select auth.jwt()) ->> 'email'::text) = 'loic@danceuniteduk.com'::text)) with check ((((select auth.jwt()) ->> 'email'::text) = 'loic@danceuniteduk.com'::text));
alter policy "attendance_responses_coach_select" on public.attendance_responses using ((EXISTS ( SELECT 1
   FROM class_inputs ci
  WHERE ((ci.id = attendance_responses.class_input_id) AND (ci.user_id = (select auth.uid()))))));
alter policy "attendance_responses_student_insert" on public.attendance_responses with check ((student_id = (select auth.uid())));
alter policy "attendance_responses_student_select" on public.attendance_responses using ((student_id = (select auth.uid())));
alter policy "cis_owner_all" on public.class_input_students using ((EXISTS ( SELECT 1
   FROM class_inputs ci
  WHERE ((ci.id = class_input_students.class_input_id) AND (ci.user_id = (select auth.uid())))))) with check ((EXISTS ( SELECT 1
   FROM class_inputs ci
  WHERE ((ci.id = class_input_students.class_input_id) AND (ci.user_id = (select auth.uid()))))));
alter policy "cis_student_read_own" on public.class_input_students using ((student_id = (select auth.uid())));
alter policy "cis_student_update_own" on public.class_input_students using ((student_id = (select auth.uid())));
alter policy "class_inputs_insert" on public.class_inputs with check (((select auth.uid()) = user_id));
alter policy "class_inputs_read" on public.class_inputs using (((user_id = (select auth.uid())) OR (student_id = (select auth.uid())) OR (EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = class_inputs.user_id) AND ((u.latin_coach_id = (select auth.uid())) OR (u.ballroom_coach_id = (select auth.uid())))))) OR (EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = (select auth.uid())) AND ((u.latin_coach_id = class_inputs.user_id) OR (u.ballroom_coach_id = class_inputs.user_id)) AND ((class_inputs.student_id = (select auth.uid())) OR (class_inputs.student_id IS NULL)))))));
alter policy "class_inputs_select" on public.class_inputs using (((select auth.uid()) = user_id));
alter policy "class_inputs_trainer_insert" on public.class_inputs with check ((((select auth.jwt()) ->> 'email'::text) = 'loic@danceuniteduk.com'::text));
alter policy "class_inputs_trainer_read_all" on public.class_inputs using ((((select auth.jwt()) ->> 'email'::text) = 'loic@danceuniteduk.com'::text));
alter policy "class_inputs_update" on public.class_inputs using (((select auth.uid()) = user_id));
alter policy "coach_reads_student_classes" on public.class_inputs using ((user_id IN ( SELECT coach_requests.student_id
   FROM coach_requests
  WHERE ((coach_requests.coach_id = (select auth.uid())) AND (coach_requests.status = 'accepted'::text)))));
alter policy "own chunks delete" on public.class_recording_chunks using ((EXISTS ( SELECT 1
   FROM class_recordings r
  WHERE ((r.id = class_recording_chunks.recording_id) AND (r.user_id = (select auth.uid()))))));
alter policy "own chunks insert" on public.class_recording_chunks with check ((EXISTS ( SELECT 1
   FROM class_recordings r
  WHERE ((r.id = class_recording_chunks.recording_id) AND (r.user_id = (select auth.uid()))))));
alter policy "own chunks select" on public.class_recording_chunks using ((EXISTS ( SELECT 1
   FROM class_recordings r
  WHERE ((r.id = class_recording_chunks.recording_id) AND (r.user_id = (select auth.uid()))))));
alter policy "own chunks update" on public.class_recording_chunks using ((EXISTS ( SELECT 1
   FROM class_recordings r
  WHERE ((r.id = class_recording_chunks.recording_id) AND (r.user_id = (select auth.uid()))))));
alter policy "own recording students insert" on public.class_recording_students with check ((EXISTS ( SELECT 1
   FROM class_recordings r
  WHERE ((r.id = class_recording_students.recording_id) AND (r.user_id = (select auth.uid()))))));
alter policy "own recording students select" on public.class_recording_students using ((EXISTS ( SELECT 1
   FROM class_recordings r
  WHERE ((r.id = class_recording_students.recording_id) AND (r.user_id = (select auth.uid()))))));
alter policy "own recordings insert" on public.class_recordings with check (((select auth.uid()) = user_id));
alter policy "own recordings select" on public.class_recordings using (((select auth.uid()) = user_id));
alter policy "own recordings update" on public.class_recordings using (((select auth.uid()) = user_id)) with check (((select auth.uid()) = user_id));
alter policy "coach_cards_own" on public.coach_cards using ((user_id = (select auth.uid()))) with check ((user_id = (select auth.uid())));
alter policy "Coaches manage own knowledge" on public.coach_knowledge using ((coach_id = (select auth.uid())));
alter policy "Students read their coach knowledge" on public.coach_knowledge using ((EXISTS ( SELECT 1
   FROM users
  WHERE ((users.id = (select auth.uid())) AND ((users.latin_coach_id = coach_knowledge.coach_id) OR (users.ballroom_coach_id = coach_knowledge.coach_id))))));
alter policy "coach_messages_coach" on public.coach_messages using ((coach_id = (select auth.uid())));
alter policy "coach_messages_insert" on public.coach_messages with check ((student_id = (select auth.uid())));
alter policy "coach_messages_read" on public.coach_messages using (((student_id = (select auth.uid())) OR (coach_id = (select auth.uid()))));
alter policy "coach_messages_student" on public.coach_messages using ((student_id = (select auth.uid())));
alter policy "coach_messages_update" on public.coach_messages using ((coach_id = (select auth.uid())));
alter policy "coach_requests_coach_respond" on public.coach_requests using ((coach_id = (select auth.uid()))) with check (((coach_id = (select auth.uid())) AND (status = ANY (ARRAY['pending'::text, 'accepted'::text, 'declined'::text]))));
alter policy "coach_requests_read" on public.coach_requests using (((student_id = (select auth.uid())) OR (coach_id = (select auth.uid()))));
alter policy "coach_requests_student_delete" on public.coach_requests using ((student_id = (select auth.uid())));
alter policy "coach_requests_student_insert" on public.coach_requests with check (((student_id = (select auth.uid())) AND (status = 'pending'::text) AND (coach_id <> (select auth.uid())) AND is_coach(coach_id)));
alter policy "coach_requests_trainer_read_all" on public.coach_requests using ((((select auth.jwt()) ->> 'email'::text) = 'loic@danceuniteduk.com'::text));
alter policy "ccr_delete" on public.couple_coach_requests using (((coach_id = (select auth.uid())) OR is_couple_member(couple_id)));
alter policy "ccr_select" on public.couple_coach_requests using (((coach_id = (select auth.uid())) OR is_couple_member(couple_id)));
alter policy "couple_requests_delete" on public.couple_requests using (((requester_id = (select auth.uid())) OR (target_id = (select auth.uid()))));
alter policy "couple_requests_insert" on public.couple_requests with check ((requester_id = (select auth.uid())));
alter policy "couple_requests_select" on public.couple_requests using (((requester_id = (select auth.uid())) OR (target_id = (select auth.uid()))));
alter policy "couple_requests_update" on public.couple_requests using (((requester_id = (select auth.uid())) OR (target_id = (select auth.uid()))));
alter policy "couples_delete" on public.couples using ((((select auth.uid()) = user_a_id) OR ((select auth.uid()) = user_b_id)));
alter policy "couples_insert" on public.couples with check (((((select auth.uid()) = user_a_id) OR ((select auth.uid()) = user_b_id)) AND (latin_couple_coach_id IS NULL) AND (ballroom_couple_coach_id IS NULL)));
alter policy "couples_select" on public.couples using ((((((select auth.uid()) = user_a_id) OR ((select auth.uid()) = user_b_id)) OR ((select auth.uid()) = latin_couple_coach_id)) OR ((select auth.uid()) = ballroom_couple_coach_id)));
alter policy "focus_metrics_coach_read" on public.focus_metrics using ((EXISTS ( SELECT 1
   FROM (focus_points fp
     JOIN users u ON ((u.id = fp.user_id)))
  WHERE ((fp.id = focus_metrics.focus_id) AND ((fp.user_id = (select auth.uid())) OR (u.latin_coach_id = (select auth.uid())) OR (u.ballroom_coach_id = (select auth.uid())))))));
alter policy "focus_metrics_insert" on public.focus_metrics with check ((EXISTS ( SELECT 1
   FROM focus_points fp
  WHERE ((fp.id = focus_metrics.focus_id) AND (fp.user_id = (select auth.uid()))))));
alter policy "focus_metrics_update" on public.focus_metrics using ((EXISTS ( SELECT 1
   FROM focus_points fp
  WHERE ((fp.id = focus_metrics.focus_id) AND (fp.user_id = (select auth.uid()))))));
alter policy "coach_reads_student_focus" on public.focus_points using ((user_id IN ( SELECT coach_requests.student_id
   FROM coach_requests
  WHERE ((coach_requests.coach_id = (select auth.uid())) AND (coach_requests.status = 'accepted'::text)))));
alter policy "coach_updates_student_focus" on public.focus_points using ((user_id IN ( SELECT coach_requests.student_id
   FROM coach_requests
  WHERE ((coach_requests.coach_id = (select auth.uid())) AND (coach_requests.status = 'accepted'::text)))));
alter policy "focus_points_insert" on public.focus_points with check (((select auth.uid()) = user_id));
alter policy "focus_points_read" on public.focus_points using (((user_id = (select auth.uid())) OR (EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = focus_points.user_id) AND ((u.latin_coach_id = (select auth.uid())) OR (u.ballroom_coach_id = (select auth.uid())))))) OR (EXISTS ( SELECT 1
   FROM coach_requests cr
  WHERE ((cr.student_id = focus_points.user_id) AND (cr.coach_id = (select auth.uid())) AND (cr.status = 'accepted'::text))))));
alter policy "focus_points_require_admin_approval" on public.focus_points using (((class_input_id IS NULL) OR (EXISTS ( SELECT 1
   FROM class_inputs ci
  WHERE ((ci.id = focus_points.class_input_id) AND (ci.admin_approved_at IS NOT NULL)))) OR (((select auth.jwt()) ->> 'email'::text) = 'loic@danceuniteduk.com'::text)));
alter policy "focus_points_select" on public.focus_points using (((select auth.uid()) = user_id));
alter policy "focus_points_trainer_read_all" on public.focus_points using ((((select auth.jwt()) ->> 'email'::text) = 'loic@danceuniteduk.com'::text));
alter policy "focus_points_update" on public.focus_points using (((select auth.uid()) = user_id));
alter policy "owner_read_score_history" on public.focus_score_history using (((select auth.uid()) = user_id));
alter policy "trainer_read_score_history" on public.focus_score_history using ((((select auth.jwt()) ->> 'email'::text) = 'loic@danceuniteduk.com'::text));
alter policy "focus_validations_insert" on public.focus_validations with check ((student_id = (select auth.uid())));
alter policy "focus_validations_read" on public.focus_validations using (((student_id = (select auth.uid())) OR (coach_id = (select auth.uid()))));
alter policy "focus_validations_update" on public.focus_validations using ((coach_id = (select auth.uid())));
alter policy "guardians_read_own" on public.guardians using (((guardian_id = (select auth.uid())) OR (child_id = (select auth.uid()))));
alter policy "Users can read own merge requests" on public.merge_requests using (((select auth.uid()) = student_id));
alter policy "merge_requests_coach_read" on public.merge_requests using (((EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = merge_requests.student_id) AND ((u.latin_coach_id = (select auth.uid())) OR (u.ballroom_coach_id = (select auth.uid())))))) OR (EXISTS ( SELECT 1
   FROM coach_requests cr
  WHERE ((cr.student_id = merge_requests.student_id) AND (cr.coach_id = (select auth.uid())) AND (cr.status = 'accepted'::text))))));
alter policy "merge_requests_coach_update" on public.merge_requests using (((EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = merge_requests.student_id) AND ((u.latin_coach_id = (select auth.uid())) OR (u.ballroom_coach_id = (select auth.uid())))))) OR (EXISTS ( SELECT 1
   FROM coach_requests cr
  WHERE ((cr.student_id = merge_requests.student_id) AND (cr.coach_id = (select auth.uid())) AND (cr.status = 'accepted'::text))))));
alter policy "trainer_read_monitoring" on public.monitoring_reports using ((((select auth.jwt()) ->> 'email'::text) = 'loic@danceuniteduk.com'::text));
alter policy "notes_delete" on public.notes using (((select auth.uid()) = user_id));
alter policy "notes_insert" on public.notes with check (((select auth.uid()) = user_id));
alter policy "notes_select" on public.notes using (((select auth.uid()) = user_id));
alter policy "notes_update" on public.notes using (((select auth.uid()) = user_id));
alter policy "coach_insert_student_notifications" on public.notifications with check ((EXISTS ( SELECT 1
   FROM coach_requests cr
  WHERE ((cr.coach_id = (select auth.uid())) AND (cr.student_id = notifications.user_id) AND (cr.status = 'accepted'::text)))));
alter policy "users_own_notifications" on public.notifications using (((select auth.uid()) = user_id));
alter policy "Users can manage own practice logs" on public.practice_logs using (((select auth.uid()) = student_id));
alter policy "practice_logs_coach_read" on public.practice_logs using (((EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.id = practice_logs.student_id) AND ((u.latin_coach_id = (select auth.uid())) OR (u.ballroom_coach_id = (select auth.uid())))))) OR (EXISTS ( SELECT 1
   FROM coach_requests cr
  WHERE ((cr.student_id = practice_logs.student_id) AND (cr.coach_id = (select auth.uid())) AND (cr.status = 'accepted'::text))))));
alter policy "studios_insert_authenticated" on public.studios with check (((select auth.uid()) IS NOT NULL));
alter policy "unmatched own rw" on public.unmatched_recordings using ((user_id = (select auth.uid()))) with check ((user_id = (select auth.uid())));
alter policy "user_events_insert_self" on public.user_events with check ((user_id = (select auth.uid())));
alter policy "user_events_select_self" on public.user_events using ((user_id = (select auth.uid())));
alter policy "users_coach_reads_via_requests" on public.users using ((id IN ( SELECT coach_requests.student_id
   FROM coach_requests
  WHERE (coach_requests.coach_id = (select auth.uid())))));
alter policy "users_couple_read" on public.users using (((EXISTS ( SELECT 1
   FROM couples c
  WHERE (((users.id = c.user_a_id) OR (users.id = c.user_b_id)) AND (((((select auth.uid()) = c.user_a_id) OR ((select auth.uid()) = c.user_b_id)) OR ((select auth.uid()) = c.latin_couple_coach_id)) OR ((select auth.uid()) = c.ballroom_couple_coach_id))))) OR (EXISTS ( SELECT 1
   FROM couple_requests r
  WHERE (((r.requester_id = (select auth.uid())) AND (r.target_id = users.id)) OR ((r.target_id = (select auth.uid())) AND (r.requester_id = users.id)))))));
alter policy "users_insert" on public.users with check (((select auth.uid()) = id));
alter policy "users_read_own_or_student" on public.users using (((id = (select auth.uid())) OR (latin_coach_id = (select auth.uid())) OR (ballroom_coach_id = (select auth.uid())) OR (EXISTS ( SELECT 1
   FROM coach_requests cr
  WHERE ((cr.student_id = users.id) AND (cr.coach_id = (select auth.uid())) AND (cr.status = 'accepted'::text))))));
alter policy "users_select" on public.users using (((select auth.uid()) = id));
alter policy "users_self" on public.users using ((id = (select auth.uid())));
alter policy "users_trainer_read_all" on public.users using ((((select auth.jwt()) ->> 'email'::text) = 'loic@danceuniteduk.com'::text));
alter policy "users_update" on public.users using (((select auth.uid()) = id));
alter policy "users_update_own" on public.users using ((id = (select auth.uid())));
alter policy "yoda_score_decisions_trainer_all" on public.yoda_score_decisions using ((((select auth.jwt()) ->> 'email'::text) = 'loic@danceuniteduk.com'::text)) with check ((((select auth.jwt()) ->> 'email'::text) = 'loic@danceuniteduk.com'::text));
alter policy "yoda_score_feedback_trainer_all" on public.yoda_score_feedback using ((((select auth.jwt()) ->> 'email'::text) = 'loic@danceuniteduk.com'::text)) with check ((((select auth.jwt()) ->> 'email'::text) = 'loic@danceuniteduk.com'::text));
