-- Student-facing preferences surfaced on the Profile > Settings screen.
-- Additive and defaulted, so every existing row is valid the moment this lands.
--   weekly_goal_minutes       the target the dashboard's "min this week" is judged against
--   notify_practice_reminders opt-IN: we do not start pushing reminders at people
--   notify_lesson_ready       opt-OUT: the lesson landing is the thing they are waiting for
alter table public.users
  add column if not exists weekly_goal_minutes integer not null default 60,
  add column if not exists notify_practice_reminders boolean not null default false,
  add column if not exists notify_lesson_ready boolean not null default true;

alter table public.users
  add constraint users_weekly_goal_minutes_sane
  check (weekly_goal_minutes between 15 and 1200) not valid;
