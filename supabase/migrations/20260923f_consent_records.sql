-- Proof of what was ticked at sign-up.
--
-- Three boxes are shown before an account can be created (OnboardingScreen:
-- recording, the right to withdraw and delete, and the health-data sentence),
-- and the button stays dead until all three are on. But only the third left a
-- trace — users.health_data_consent_at. For the other two the only evidence was
-- "the account exists, and the code cannot create one otherwise", which is an
-- argument, not a record. consent_status, the column that reads
-- "not_required" on those rows, is about something else entirely: whether a
-- PARENT's permission is needed (minor consent, 20260914).
--
-- So: one row per consent given, holding the exact sentences that were on
-- screen, in the order they were shown, with the version of that wording and
-- the moment they were accepted. Append-only from the app's side — a user may
-- insert their own and read their own, and there is no update or delete policy
-- at all.
--
-- source = 'captured'      the app wrote it as the person ticked
--        = 'reconstructed' written afterwards for accounts created before this
--                          table existed, from what the system can actually
--                          prove. It says so, rather than passing for the real
--                          thing.
--
-- user_id goes null on erasure rather than taking the row with it — same rule
-- as parental_consents: what survives a deletion is that a permission was
-- given, never who gave it.

create table if not exists public.consent_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete set null,
  kind text not null,                         -- 'account_signup'
  version text not null,                      -- e.g. 'account-v1-2026-09-23'
  role text,                                  -- role declared at sign-up
  statements jsonb not null,                  -- [{ text, accepted }] in display order
  accepted_at timestamptz not null,
  source text not null default 'captured',
  note text,
  app_version text,
  created_at timestamptz not null default now(),
  constraint consent_records_source_known check (source in ('captured', 'reconstructed'))
);

comment on table public.consent_records is
  'One row per consent given at sign-up, with the exact wording shown. Append-only from the app: insert-own and select-own policies, no update or delete.';

create index if not exists consent_records_user_idx on public.consent_records (user_id, created_at desc);

alter table public.consent_records enable row level security;

drop policy if exists consent_records_insert on public.consent_records;
create policy consent_records_insert on public.consent_records
  for insert with check (user_id = (select auth.uid()));

drop policy if exists consent_records_select on public.consent_records;
create policy consent_records_select on public.consent_records
  for select using (user_id = (select auth.uid()));

-- No update policy and no delete policy, deliberately: a consent record is
-- evidence, and evidence the subject can rewrite is not evidence.

-- Rollback:
--   drop table if exists public.consent_records;
