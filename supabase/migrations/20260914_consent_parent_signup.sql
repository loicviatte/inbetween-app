-- A parent who sets their child up themselves gives the same permission an
-- invited parent does, and it is kept in the same table. What differs is how
-- it was obtained, so the proof says so: no invitation, no code, no delivery,
-- and an email address that was never proven by one.
alter table public.parental_consents
  add column if not exists consent_method text not null default 'invitation';
alter table public.parental_consents drop constraint if exists parental_consents_method_known;
alter table public.parental_consents add constraint parental_consents_method_known
  check (consent_method in ('invitation', 'parent_signup'));

alter table public.parental_consents alter column delivery_mode drop not null;
alter table public.parental_consents alter column device_secret_hash drop not null;
alter table public.parental_consents alter column expires_at drop not null;

-- Loosened for parent_signup only: an invitation still cannot exist without
-- its device secret, its expiry and its delivery mode.
alter table public.parental_consents drop constraint if exists parental_consents_invitation_complete;
alter table public.parental_consents add constraint parental_consents_invitation_complete
  check (consent_method <> 'invitation'
    or (device_secret_hash is not null and expires_at is not null and delivery_mode is not null));
