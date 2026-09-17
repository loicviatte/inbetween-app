-- Stress test 2026-09-17: with a coach of 60 students (500 classes, 2,400
-- focus points, 7,200 practice sessions), focus_points had no index on
-- user_id — the column nearly every read filters on — so readiness scanned
-- focus points by class and discarded thousands of rows per student. These
-- match the app's hot filters: a dancer's focus points (per class), their
-- completed practice since a date, a coach's / student's classes newest
-- first, and the notification list.
create index if not exists focus_points_user_class_idx on public.focus_points (user_id, class_input_id);
create index if not exists practice_logs_student_completed_idx on public.practice_logs (student_id, completed_at);
create index if not exists class_inputs_user_created_idx on public.class_inputs (user_id, created_at desc);
create index if not exists class_inputs_student_created_idx on public.class_inputs (student_id, created_at desc);
create index if not exists notifications_user_created_idx on public.notifications (user_id, created_at desc);
analyze public.focus_points;
analyze public.practice_logs;
analyze public.class_inputs;
analyze public.notifications;
