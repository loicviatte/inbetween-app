-- ============================================================
-- The lesson's Live Activity moves on while the phone is in a pocket.
--
-- After a DJI-mic lesson, the app shows a Live Activity on the coach's lock
-- screen (src/services/micPendingActivity.js): waiting for the mic → sending
-- audio → finding focus points → ready to validate. The app can only update it
-- while it runs, and the last two steps happen on the server, usually after
-- the coach has closed the app. So each activity hands Apple's push address
-- for it to us, with the lessons it follows, and the server pushes the next
-- step when one of those lessons moves (edge function live-activity-push).
--
-- One row per activity. The app goes through the two functions below, never
-- the table, like push_tokens. A coach can only attach their own lessons: the
-- push carries student and focus point names to whoever holds the token.
--
-- <PROJECT_REF>/<SERVICE_ROLE_KEY> are substituted at apply time, as in
-- 20260721_notify_audio_lost.sql.
-- ============================================================

create table if not exists public.live_activity_tokens (
  activity_id   text primary key,
  -- auth.users, not public.users: any signed-in phone can hold one.
  user_id       uuid not null references auth.users(id) on delete cascade,
  push_token    text not null,
  apns_env      text not null default 'production' check (apns_env in ('sandbox', 'production')),
  recording_ids uuid[] not null default '{}',
  -- What the activity shows now, so a push that would change nothing isn't sent.
  last_state    jsonb,
  -- The latest trigger call for this coach; see live_activity_claim.
  push_requested_at timestamptz,
  updated_at    timestamptz not null default now()
);
create index if not exists live_activity_tokens_user_id_idx on public.live_activity_tokens (user_id);

alter table public.live_activity_tokens enable row level security;
-- No policies: only the functions below and the service role touch it.

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

  -- Only the caller's own lessons.
  select coalesce(array_agg(r.id), '{}')
    into v_ids
    from class_recordings r
   where r.id = any(coalesce(p_recording_ids, '{}'))
     and r.user_id = auth.uid();

  insert into live_activity_tokens (activity_id, user_id, push_token, apns_env, recording_ids, last_state, updated_at)
  values (p_activity_id, auth.uid(), p_push_token, p_apns_env, v_ids, p_state, now())
  on conflict (activity_id) do update
    set push_token    = excluded.push_token,
        apns_env      = excluded.apns_env,
        recording_ids = excluded.recording_ids,
        last_state    = coalesce(excluded.last_state, live_activity_tokens.last_state),
        updated_at    = now()
    -- An activity id belongs to the phone that made it; never hand it over.
    where live_activity_tokens.user_id = auth.uid();
end;
$$;

create or replace function public.unregister_live_activity(p_activity_id text)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  delete from live_activity_tokens where activity_id = p_activity_id and user_id = (select auth.uid());
$$;

revoke execute on function public.register_live_activity(text, text, text, uuid[], jsonb) from public, anon;
revoke execute on function public.unregister_live_activity(text) from public, anon;
grant execute on function public.register_live_activity(text, text, text, uuid[], jsonb) to authenticated;
grant execute on function public.unregister_live_activity(text) to authenticated;

-- Apple's provider token (a signed JWT) must be reused for 20–60 minutes:
-- signing a new one on every push gets refused as "too many updates".
create table if not exists public.apns_provider_tokens (
  key_id    text primary key,
  token     text not null,
  issued_at timestamptz not null
);
alter table public.apns_provider_tokens enable row level security;
-- No policies: service role only.

-- A burst of trigger calls for one coach (a group focus point validated is one
-- row per dancer; the 18h auto-publish touches many at once) must push once,
-- the final state, not thirty states in a random order. Each call stamps the
-- coach's rows and waits; only the call still holding the latest stamp sends.
create or replace function public.live_activity_claim(p_user uuid)
returns timestamptz
language sql
security definer
set search_path = public, pg_temp
as $$
  update live_activity_tokens set push_requested_at = clock_timestamp()
   where user_id = p_user
  returning push_requested_at
$$;
revoke execute on function public.live_activity_claim(uuid) from public, anon, authenticated;

-- ─── Triggers: a followed lesson moved on the server ─────────────────────
-- Both fire only when an activity follows the lesson, so every other coach
-- pays one indexed lookup. A failure never blocks the write.

create or replace function public.live_activity_lesson_moved(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  perform net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/live-activity-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
    ),
    body := jsonb_build_object('user_id', p_user)
  );
end;
$$;
revoke execute on function public.live_activity_lesson_moved(uuid) from public, anon, authenticated;

create or replace function public.live_activity_recording_moved()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if exists (
    select 1 from live_activity_tokens t
     where t.user_id = NEW.user_id and NEW.id = any(t.recording_ids)
  ) then
    perform live_activity_lesson_moved(NEW.user_id);
  end if;
  return NEW;
exception when others then
  return NEW;
end;
$$;

drop trigger if exists trg_live_activity_recording_moved on public.class_recordings;
create trigger trg_live_activity_recording_moved
  after update of status, class_input_id on public.class_recordings
  for each row
  when (OLD.status is distinct from NEW.status or OLD.class_input_id is distinct from NEW.class_input_id)
  execute function public.live_activity_recording_moved();

create or replace function public.live_activity_class_moved()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_user uuid;
begin
  select r.user_id into v_user
    from class_recordings r
    join live_activity_tokens t on t.user_id = r.user_id and r.id = any(t.recording_ids)
   where r.class_input_id = NEW.id
   limit 1;
  if v_user is not null then
    perform live_activity_lesson_moved(v_user);
  end if;
  return NEW;
exception when others then
  return NEW;
end;
$$;

drop trigger if exists trg_live_activity_class_moved on public.class_inputs;
create trigger trg_live_activity_class_moved
  after update of status, coach_released_at on public.class_inputs
  for each row
  when (OLD.status is distinct from NEW.status or OLD.coach_released_at is distinct from NEW.coach_released_at)
  execute function public.live_activity_class_moved();

-- The coach validates (or drops) a focus point: "3 ready" becomes "2 ready",
-- and the activity closes with the last one.
create or replace function public.live_activity_focus_point_reviewed()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_user uuid;
begin
  select r.user_id into v_user
    from class_recordings r
    join live_activity_tokens t on t.user_id = r.user_id and r.id = any(t.recording_ids)
   where r.class_input_id = NEW.source_class_input_id
   limit 1;
  if v_user is not null then
    perform live_activity_lesson_moved(v_user);
  end if;
  return NEW;
exception when others then
  return NEW;
end;
$$;

drop trigger if exists trg_live_activity_fp_reviewed on public.focus_points;
create trigger trg_live_activity_fp_reviewed
  after update of status on public.focus_points
  for each row
  when (OLD.status = 'pending_coach' and NEW.status is distinct from 'pending_coach')
  execute function public.live_activity_focus_point_reviewed();

drop trigger if exists trg_live_activity_couple_fp_reviewed on public.couple_focus_points;
create trigger trg_live_activity_couple_fp_reviewed
  after update of status on public.couple_focus_points
  for each row
  when (OLD.status = 'pending_coach' and NEW.status is distinct from 'pending_coach')
  execute function public.live_activity_focus_point_reviewed();
