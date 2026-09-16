-- Notification settings. "Lesson summary ready" already had its own column
-- (notify_lesson_ready); every other switch on the settings screen lives here,
-- as one object the app patches whole:
--   new_focus_point, coach_comments, attendance, milestones, focus_reviews  (bool)
--   push         'on' | 'off'
--   quiet        'off' | '21-7' | '22-8' | '23-7'
--   paused_until timestamptz as ISO text, or null
--   tz           the phone's IANA time zone, for quiet hours
-- The send-push edge function reads it (with notify_lesson_ready) before
-- every push.
alter table public.users
  add column if not exists notification_prefs jsonb not null default '{}'::jsonb;
