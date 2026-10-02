-- ============================================================
-- The admin steps back: a class opens to its coach as soon as it is scored.
--
-- Since 20260926b a class opened to its coach when the admin approved it in
-- the queue, or four hours after scoring. From 2026-10-02 the admin no longer
-- reads every lesson (user's decision): focus points go straight to the coach,
-- whose own 18h review stays the human check, and the admin hears only about
-- what goes wrong — on Telegram:
--   • a DJI lesson still without its audio 8 hours after it ended
--     (notify-audio-missing, below)
--   • an audio file the matcher wasn't sure about (notify-audio-match, which
--     still holds that lesson's extraction until the admin confirms the match)
--   • a coach answering "the audio is lost" (notify-audio-lost)
--
-- Mechanism: auto_approve_test_classes, which already approved the test
-- account's and the students' own classes, now approves every class reaching
-- 'scored' (never a rejected one). The release trigger also listens to
-- `status`: the approval is made by a BEFORE trigger, which an
-- `UPDATE OF admin_approved_at` trigger never sees — the class would only have
-- opened with the 10-minute release-stale-classes sweep. Listening to `status`
-- (part of yoda-score's own update) opens it in the same transaction, after
-- its focus points exist, so release_class_to_coach's notification counts them.
--
-- yoda-score's "New class to review" Telegram goes quiet by itself: it only
-- fires for a class still unapproved after scoring.
--
-- <PROJECT_REF>/<SERVICE_ROLE_KEY> are substituted at apply time.
-- ============================================================

create or replace function public.auto_approve_test_classes()
returns trigger
language plpgsql
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  recorder_role text;
begin
  if NEW.admin_approved_at is null
     and NEW.status in ('extracted', 'scored')
  then
    select role into recorder_role
    from public.users
    where id = NEW.user_id;

    if NEW.user_id in (
      select id from public.users where email in ('viatteloic@gmail.com')
    ) then
      NEW.admin_approved_at := now();
      NEW.admin_notes := coalesce(NEW.admin_notes, 'auto-approved: test account');
    elsif recorder_role = 'student' then
      NEW.admin_approved_at := now();
      NEW.admin_notes := coalesce(NEW.admin_notes, 'auto-approved: student self-input');
    elsif NEW.status = 'scored' and NEW.admin_rejected_at is null then
      -- Every coach's class, once its focus points exist.
      NEW.admin_approved_at := now();
      NEW.admin_notes := coalesce(NEW.admin_notes, 'auto-approved: classes open on scoring');
    end if;
  end if;
  return NEW;
end;
$function$;

drop trigger if exists release_on_admin_approval on public.class_inputs;
create trigger release_on_admin_approval
  after insert or update of admin_approved_at, status on public.class_inputs
  for each row execute function public.trg_release_on_admin_approval();

-- ─── A DJI lesson still without its audio 8 hours after it ended ─────────

alter table public.class_recordings
  add column if not exists missing_audio_alerted_at timestamptz;

select cron.unschedule('notify-audio-missing')
  where exists (select 1 from cron.job where jobname = 'notify-audio-missing');

select cron.schedule(
  'notify-audio-missing',
  '*/15 * * * *',
  $cron$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/notify-audio-missing',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
    ),
    body := jsonb_build_object('trigger', 'cron')
  );
  $cron$
);
