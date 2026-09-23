-- A mic-flow lesson the coach never stopped used to disappear for good.
--
-- In the mic flow the phone records nothing: the coach starts the lesson, puts
-- the phone away, and is meant to come back and tap Stop. When they don't (they
-- force-quit, or the phone dies), ended_at stays NULL — and everything that
-- shows a lesson waiting for its audio filters on ended_at IS NOT NULL: the
-- coach's pending list, the evening wall, the nightly push, and the matcher
-- itself. The lesson, and its audio, are invisible to everyone.
--
-- The 2026-07-08 cron only heals rows whose meta holds a `session_stopping`
-- event — written when the coach DID tap Stop. This one covers the rest: a
-- local-mode row still 'recording' with no sign of life for six hours is over.
--
-- "Last sign of life" is the newest timestamped event the app managed to write
-- (meta.events — appstate changes, route changes), else the last heartbeat or
-- DB write. In local mode nothing heartbeats (the phone isn't recording), so
-- that event trail is usually all there is, and it lands minutes after the
-- start rather than at the end of the lesson. Hence meta.duration_unknown: the
-- stamp says when the app stopped talking, NOT when the lesson ended, and the
-- length is a floor that nothing may treat as real. The surfaces that hide
-- anything under a minute (a Start/Stop misfire) must let these through — an
-- app that died forty seconds in still taught an hour — and the match, scored
-- on a length we don't have, lands in admin review instead of auto-approving.
--
-- Six hours: longer than any real lesson plus the app sitting idle in a pocket,
-- short enough that the evening push the same day still catches it.
-- Status is left at 'recording', exactly as the 2026-07-08 sweep leaves it.

create or replace function public.close_abandoned_local_recordings()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  n integer;
begin
  with candidate as (
    select r.id,
           greatest(
             r.started_at,
             coalesce(
               case when jsonb_typeof(r.meta -> 'events') = 'array' then (
                 select max((e ->> 'at')::timestamptz)
                   from jsonb_array_elements(r.meta -> 'events') e
                  -- only well-formed ISO stamps: a malformed one would abort
                  -- the whole sweep on the cast
                  where e ->> 'at' ~ '^\d{4}-\d{2}-\d{2}T'
               ) end,
               r.last_heartbeat_at,
               r.updated_at,
               r.started_at
             )
           ) as last_sign
      from class_recordings r
     where r.local_recording_mode = true
       and r.ended_at is null
       and r.status = 'recording'
  ),
  stale as (
    update class_recordings r
       set ended_at = c.last_sign,
           meta = coalesce(r.meta, '{}'::jsonb)
                  || jsonb_build_object('auto_closed_at', now(),
                                        'auto_closed_reason', 'no sign of life for 6h',
                                        'duration_unknown', true)
      from candidate c
     where c.id = r.id
       and c.last_sign < now() - interval '6 hours'
    returning 1
  )
  select count(*) into n from stale;
  return n;
end;
$$;

revoke execute on function public.close_abandoned_local_recordings() from public, anon, authenticated;

-- Heal what is already stuck (Tanya's 8 September group lesson, and any other).
select public.close_abandoned_local_recordings();

-- Runs next to the existing session_stopping sweep, on the same half-hour.
select cron.unschedule('close-abandoned-local-recordings')
 where exists (select 1 from cron.job where jobname = 'close-abandoned-local-recordings');
select cron.schedule(
  'close-abandoned-local-recordings',
  '*/30 * * * *',
  $cron$ select public.close_abandoned_local_recordings(); $cron$
);

-- Rollback:
--   select cron.unschedule('close-abandoned-local-recordings');
--   drop function if exists public.close_abandoned_local_recordings();
