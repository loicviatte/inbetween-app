-- Notification settings. Two preferences already had their own columns
-- (notify_lesson_ready, notify_practice_reminders); everything else the
-- settings screen offers lives here, as one object the app patches whole:
--   corrections, new_focus_point, class_reminder, weekly_recap, milestones  (bool)
--   remind_lead  '1h' | '3h' | 'evening'
--   push         'on' | 'off'
--   email        'all' | 'recaps' | 'off'
--   quiet        'off' | '21-7' | '22-8' | '23-7'
--   paused_until timestamptz as ISO text, or null
-- Stored only for now: nothing that sends notifications reads it yet.
alter table public.users
  add column if not exists notification_prefs jsonb not null default '{}'::jsonb;
