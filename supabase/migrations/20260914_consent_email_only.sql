-- SMS verification is switched off for now: the parent proves the email
-- channel only, and no mobile number is collected. The column stays so the
-- second channel can come back without a migration.
alter table public.parental_consents alter column parent_phone drop not null;
