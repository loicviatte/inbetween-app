-- Audit 2026-09-17: functions without a fixed search_path (Supabase advisor
-- function_search_path_mutable). Pinned to public, extensions, pg_temp — every
-- extension call in them is schema-qualified (net.http_post), and their tables
-- live in public, so they resolve exactly as before.

alter function public.auto_approve_test_classes() set search_path = public, extensions, pg_temp;
alter function public.guard_consent_columns() set search_path = public, extensions, pg_temp;
alter function public.handle_new_user() set search_path = public, extensions, pg_temp;
alter function public.handle_updated_at() set search_path = public, extensions, pg_temp;
alter function public.log_focus_score_change() set search_path = public, extensions, pg_temp;
alter function public.notify_coach_comment() set search_path = public, extensions, pg_temp;
alter function public.notify_coach_replied() set search_path = public, extensions, pg_temp;
alter function public.notify_coach_request() set search_path = public, extensions, pg_temp;
alter function public.notify_coach_request_response() set search_path = public, extensions, pg_temp;
alter function public.notify_couple_coach_accepted() set search_path = public, extensions, pg_temp;
alter function public.notify_couple_coach_request() set search_path = public, extensions, pg_temp;
alter function public.notify_couple_created() set search_path = public, extensions, pg_temp;
alter function public.notify_couple_focus_point() set search_path = public, extensions, pg_temp;
alter function public.notify_couple_focus_points_batch() set search_path = public, extensions, pg_temp;
alter function public.notify_couple_request() set search_path = public, extensions, pg_temp;
alter function public.notify_couple_request_validate() set search_path = public, extensions, pg_temp;
alter function public.notify_couple_unpaired() set search_path = public, extensions, pg_temp;
alter function public.notify_focus_mastered() set search_path = public, extensions, pg_temp;
alter function public.notify_new_focus_point() set search_path = public, extensions, pg_temp;
alter function public.notify_on_focus_point_added() set search_path = public, extensions, pg_temp;
alter function public.notify_request_accepted() set search_path = public, extensions, pg_temp;
alter function public.notify_student_on_fp_activated() set search_path = public, extensions, pg_temp;
alter function public.notify_student_trained() set search_path = public, extensions, pg_temp;
alter function public.touch_class_recordings_updated_at() set search_path = public, extensions, pg_temp;
alter function public.touch_coach_card() set search_path = public, extensions, pg_temp;
alter function public.touch_unmatched_recordings_updated_at() set search_path = public, extensions, pg_temp;
alter function public.trainer_insert_class_input(p_coach_id uuid, p_lesson_type text, p_student_id uuid, p_transcript text, p_created_at timestamp with time zone) set search_path = public, extensions, pg_temp;
alter function public.trigger_ingest_lesson() set search_path = public, extensions, pg_temp;
alter function public.trigger_process_coach_signals() set search_path = public, extensions, pg_temp;
