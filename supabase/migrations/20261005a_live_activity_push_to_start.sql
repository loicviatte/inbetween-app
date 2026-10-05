-- ============================================================
-- The server can put the lesson's Live Activity back on a phone by itself.
--
-- iOS only lets an app START a Live Activity while it is open — except
-- through "push-to-start" (iOS 17.2+): once the app has handed over a
-- push-to-start token, the server may start one remotely. Nataliia and Tanya
-- installed 1.8.3 (84) but haven't opened it since, and their lessons of 26
-- September still wait for their audio: exactly the coach this is for.
--
-- Each phone files its push-to-start token (live_activity_start_tokens, one
-- row per token, moved to whoever signed in last — like push_tokens). Every
-- hour of the day (Europe/London 09:00–18:59), live-activity-restart starts
-- the red "No audio yet" activity for a coach whose lessons still wait for
-- their audio (ended 2h–14d ago), when no activity of theirs can still be on
-- screen (none filed in the last 8 hours — iOS ends them by then) and none was
-- started for them in the last 20 hours. In practice: the morning after.
--
-- A server-started activity is filed by the app when iOS hands it its update
-- token; the app may know nothing of the lessons then, so an empty lesson
-- list now means "my lessons still waiting for their audio".
--
-- <PROJECT_REF>/<SERVICE_ROLE_KEY> are substituted at apply time.
-- ============================================================

alter table public.live_activity_tokens
  add column if not exists created_at timestamptz not null default now();

create table if not exists public.live_activity_start_tokens (
  token           text primary key,
  user_id         uuid not null references auth.users(id) on delete cascade,
  apns_env        text not null default 'production' check (apns_env in ('sandbox', 'production')),
  last_started_at timestamptz,
  updated_at      timestamptz not null default now()
);
create index if not exists live_activity_start_tokens_user_id_idx on public.live_activity_start_tokens (user_id);
alter table public.live_activity_start_tokens enable row level security;
-- No policies: the app goes through the functions below.

create or replace function public.register_live_activity_start_token(p_token text, p_apns_env text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  -- Length apart: Postgres caps a regex repetition count at 255.
  if p_token is null or p_token !~ '^[0-9a-f]+$' or length(p_token) not between 32 and 512 then
    raise exception 'not an APNs token';
  end if;
  if p_apns_env not in ('sandbox', 'production') then
    raise exception 'bad APNs environment';
  end if;
  insert into live_activity_start_tokens (token, user_id, apns_env, updated_at)
  values (p_token, auth.uid(), p_apns_env, now())
  on conflict (token) do update
    set user_id = excluded.user_id,
        apns_env = excluded.apns_env,
        -- A phone changing hands starts afresh.
        last_started_at = case when live_activity_start_tokens.user_id = excluded.user_id
                               then live_activity_start_tokens.last_started_at end,
        updated_at = now();
end;
$$;

create or replace function public.unregister_live_activity_start_token(p_token text)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  delete from live_activity_start_tokens where token = p_token and user_id = (select auth.uid());
$$;

revoke execute on function public.register_live_activity_start_token(text, text) from public, anon;
revoke execute on function public.unregister_live_activity_start_token(text) from public, anon;
grant execute on function public.register_live_activity_start_token(text, text) to authenticated;
grant execute on function public.unregister_live_activity_start_token(text) to authenticated;

-- An activity the server started is filed before the app knows its lessons.
create or replace function public.register_live_activity(
  p_activity_id   text,
  p_push_token    text,
  p_apns_env      text,
  p_recording_ids uuid[],
  p_state         jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ids uuid[];
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  if p_activity_id is null or length(p_activity_id) > 128 then
    raise exception 'bad activity id';
  end if;
  -- Length apart: Postgres caps a regex repetition count at 255.
  if p_push_token is null or p_push_token !~ '^[0-9a-f]+$' or length(p_push_token) not between 32 and 512 then
    raise exception 'not an APNs token';
  end if;
  if p_apns_env not in ('sandbox', 'production') then
    raise exception 'bad APNs environment';
  end if;

  if coalesce(cardinality(p_recording_ids), 0) > 0 then
    -- Only the caller's own lessons.
    select coalesce(array_agg(r.id), '{}')
      into v_ids
      from class_recordings r
     where r.id = any(p_recording_ids)
       and r.user_id = auth.uid();
  else
    -- Nothing named: the caller's lessons still waiting for their audio.
    select coalesce(array_agg(r.id), '{}')
      into v_ids
      from class_recordings r
     where r.user_id = auth.uid()
       and r.local_recording_mode
       and r.mic_file_name is null
       and r.sync_abandoned_at is null
       and r.status not in ('discarded', 'failed')
       and r.ended_at > now() - interval '14 days';
  end if;

  insert into live_activity_tokens (activity_id, user_id, push_token, apns_env, recording_ids, last_state, updated_at)
  values (p_activity_id, auth.uid(), p_push_token, p_apns_env, v_ids, p_state, now())
  on conflict (activity_id) do update
    set push_token    = excluded.push_token,
        apns_env      = excluded.apns_env,
        recording_ids = case when coalesce(cardinality(p_recording_ids), 0) > 0
                             then excluded.recording_ids else live_activity_tokens.recording_ids end,
        last_state    = coalesce(excluded.last_state, live_activity_tokens.last_state),
        updated_at    = now()
    -- An activity id belongs to the phone that made it; never hand it over.
    where live_activity_tokens.user_id = auth.uid();
end;
$$;

select cron.unschedule('live-activity-restart')
  where exists (select 1 from cron.job where jobname = 'live-activity-restart');

select cron.schedule(
  'live-activity-restart',
  '5 * * * *',
  $cron$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/live-activity-restart',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
    ),
    body := jsonb_build_object('trigger', 'cron')
  );
  $cron$
);
