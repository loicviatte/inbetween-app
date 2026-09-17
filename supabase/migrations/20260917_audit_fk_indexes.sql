-- Audit 2026-09-17 (performance): the foreign keys the app filters and joins
-- on every screen had no index (Supabase advisor unindexed_foreign_keys).
-- Cheap now while the tables are small; they keep readiness, rosters, lessons
-- and the coach link checks from scanning whole tables as data grows.
create index if not exists practice_logs_student_id_idx on public.practice_logs (student_id);
create index if not exists practice_logs_focus_point_id_idx on public.practice_logs (focus_point_id);
create index if not exists class_inputs_user_id_idx on public.class_inputs (user_id);
create index if not exists class_inputs_student_id_idx on public.class_inputs (student_id);
create index if not exists coach_requests_coach_id_idx on public.coach_requests (coach_id);
create index if not exists focus_points_class_input_id_idx on public.focus_points (class_input_id);
create index if not exists focus_points_source_class_input_id_idx on public.focus_points (source_class_input_id);
create index if not exists notes_user_id_idx on public.notes (user_id);
create index if not exists notes_linked_class_input_id_idx on public.notes (linked_class_input_id);
create index if not exists class_recordings_student_id_idx on public.class_recordings (student_id);
create index if not exists class_recordings_couple_id_idx on public.class_recordings (couple_id);
create index if not exists class_recording_students_student_id_idx on public.class_recording_students (student_id);
create index if not exists merge_requests_student_id_idx on public.merge_requests (student_id);
create index if not exists attendance_responses_student_id_idx on public.attendance_responses (student_id);
create index if not exists couple_focus_points_source_class_input_id_idx on public.couple_focus_points (source_class_input_id);
create index if not exists users_active_child_id_idx on public.users (active_child_id);
create index if not exists age_reviews_coach_id_idx on public.age_reviews (coach_id);
create index if not exists parental_consents_guardian_id_idx on public.parental_consents (guardian_id);
