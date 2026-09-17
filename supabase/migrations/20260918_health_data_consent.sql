-- Explicit permission for health data, asked at sign-up.
--
-- A lesson's audio can carry an injury, a pain, a limitation — special-category
-- data under the GDPR, which needs its own explicit consent, not the blanket
-- one in the terms. Onboarding now asks every account (coach, student, parent)
-- to tick it, and stamps the moment here. A parent approving a child's account
-- accepts the same sentence as the fourth check of the minor consent, whose
-- proof already lives in parental_consents.consent_text.
--
-- Nullable on purpose: accounts made before this exist and haven't been asked.
alter table public.users add column if not exists health_data_consent_at timestamptz;

comment on column public.users.health_data_consent_at is
  'When this account explicitly consented to InBetween processing health references (injuries, pain, limitations) inside lesson content. NULL = never asked (account predates the question).';
