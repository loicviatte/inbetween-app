-- Audit 2026-09-17: trigger functions were callable over the API by anyone
-- (Supabase advisor *_security_definer_function_executable). A trigger fires
-- regardless of the caller's EXECUTE privilege, so nobody needs it.

revoke execute on function public.archive_held_couple_fp() from public, anon, authenticated;
revoke execute on function public.auto_approve_test_classes() from public, anon, authenticated;
revoke execute on function public.guard_active_child() from public, anon, authenticated;
revoke execute on function public.guard_coach_request_update() from public, anon, authenticated;
revoke execute on function public.guard_consent_columns() from public, anon, authenticated;
revoke execute on function public.guard_user_links() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.handle_updated_at() from public, anon, authenticated;
revoke execute on function public.log_focus_score_change() from public, anon, authenticated;
revoke execute on function public.notify_audio_lost() from public, anon, authenticated;
revoke execute on function public.notify_audio_match_pending() from public, anon, authenticated;
revoke execute on function public.notify_coach_comment() from public, anon, authenticated;
revoke execute on function public.notify_coach_replied() from public, anon, authenticated;
revoke execute on function public.notify_coach_request() from public, anon, authenticated;
revoke execute on function public.notify_coach_request_response() from public, anon, authenticated;
revoke execute on function public.notify_couple_coach_accepted() from public, anon, authenticated;
revoke execute on function public.notify_couple_coach_request() from public, anon, authenticated;
revoke execute on function public.notify_couple_created() from public, anon, authenticated;
revoke execute on function public.notify_couple_focus_point() from public, anon, authenticated;
revoke execute on function public.notify_couple_focus_points_batch() from public, anon, authenticated;
revoke execute on function public.notify_couple_request() from public, anon, authenticated;
revoke execute on function public.notify_couple_request_validate() from public, anon, authenticated;
revoke execute on function public.notify_couple_unpaired() from public, anon, authenticated;
revoke execute on function public.notify_focus_mastered() from public, anon, authenticated;
revoke execute on function public.notify_new_focus_point() from public, anon, authenticated;
revoke execute on function public.notify_on_focus_point_added() from public, anon, authenticated;
revoke execute on function public.notify_request_accepted() from public, anon, authenticated;
revoke execute on function public.notify_student_on_fp_activated() from public, anon, authenticated;
revoke execute on function public.notify_student_trained() from public, anon, authenticated;
revoke execute on function public.refuse_unconsented_student() from public, anon, authenticated;
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
revoke execute on function public.sync_user_email() from public, anon, authenticated;
revoke execute on function public.touch_class_recordings_updated_at() from public, anon, authenticated;
revoke execute on function public.touch_coach_card() from public, anon, authenticated;
revoke execute on function public.touch_unmatched_recordings_updated_at() from public, anon, authenticated;
revoke execute on function public.trigger_ingest_lesson() from public, anon, authenticated;
revoke execute on function public.trigger_process_coach_signals() from public, anon, authenticated;
