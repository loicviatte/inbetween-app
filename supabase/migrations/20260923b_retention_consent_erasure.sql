-- Schema for three promises the product makes and the database could not keep:
-- lesson audio is deleted after 180 days, a health-data consent is versioned
-- and withdrawable, and a deletion request actually erases.
--
--   1. audio_purged_at — the audio is gone, the lesson is not. Everything
--      derived from the recording (transcript, focus points, summaries) is
--      deliberately kept, so a lesson has to be able to say "the recording
--      itself was deleted on this date" rather than pretend it never existed.
--
--   2. health_consent_version / health_consent_withdrawn_at — a timestamp alone
--      cannot say WHAT was agreed to. The sentence shown at sign-up changes;
--      proof of consent means storing the version of the text the person
--      actually read, and the moment they took it back.
--
--   3. data_erasures — a deletion has to leave one trace behind: that it
--      happened. Same principle as the parental consent, which keeps the record
--      that permission was given and withdrawn while everything else goes.

alter table public.class_inputs
  add column if not exists audio_purged_at timestamptz;
comment on column public.class_inputs.audio_purged_at is
  'When this lesson''s audio was deleted from storage by the 180-day retention sweep (purge-expired-audio). The transcript and everything derived from it stay.';

alter table public.class_recordings
  add column if not exists audio_purged_at timestamptz;
comment on column public.class_recordings.audio_purged_at is
  'When this recording''s chunks were deleted from storage by the 180-day retention sweep.';

-- Warned-at, so the 14-day notice is sent once per lesson and not every night.
alter table public.class_inputs
  add column if not exists audio_expiry_warned_at timestamptz;
comment on column public.class_inputs.audio_expiry_warned_at is
  'When the coach was told this lesson''s audio is about to reach the retention limit.';

alter table public.users
  add column if not exists health_consent_version text,
  add column if not exists health_consent_withdrawn_at timestamptz;
comment on column public.users.health_consent_version is
  'Version of the health-data consent sentence the person actually read when they ticked it. Null on accounts created before versioning (2026-09-23) — their health_data_consent_at stands, the wording is the one in HEALTH_CONSENT_VERSION''s predecessor.';
comment on column public.users.health_consent_withdrawn_at is
  'When the person withdrew the health-data consent. Set means: no new recording may include them. The consent record itself is kept — that is the proof it was given, and taken back.';

-- A withdrawal has to be visible to the coach's app (it is what blocks the
-- lesson), and a coach can already read their own students' rows.

create table if not exists public.data_erasures (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null,              -- no FK: the row outlives the user
  subject_email text,
  subject_role text,
  requested_by text,                     -- 'self' | 'guardian' | 'support'
  performed_at timestamptz not null default now(),
  -- What went, table by table, plus the storage objects removed. Counts only:
  -- an erasure record must never become a copy of the data it erased.
  deleted jsonb not null default '{}'::jsonb,
  storage_objects integer not null default 0,
  notes text
);
comment on table public.data_erasures is
  'One row per completed erasure. Counts only, never content — the proof a deletion request was honoured.';

alter table public.data_erasures enable row level security;
-- No policy: service-role only. Nobody reaches this table from the app.

-- Retention needs to find expiring audio fast once there are years of lessons.
create index if not exists class_inputs_audio_retention_idx
  on public.class_inputs (created_at)
  where audio_path is not null and audio_purged_at is null;

create index if not exists class_recordings_audio_retention_idx
  on public.class_recordings (started_at)
  where audio_purged_at is null;

-- Rollback:
--   drop index if exists class_inputs_audio_retention_idx;
--   drop index if exists class_recordings_audio_retention_idx;
--   drop table if exists public.data_erasures;
--   alter table public.users drop column if exists health_consent_version,
--                            drop column if exists health_consent_withdrawn_at;
--   alter table public.class_inputs drop column if exists audio_purged_at,
--                                   drop column if exists audio_expiry_warned_at;
--   alter table public.class_recordings drop column if exists audio_purged_at;
