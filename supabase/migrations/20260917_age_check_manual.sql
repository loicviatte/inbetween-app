-- An age InBetween confirmed by hand from a proof of age (admin dashboard ▸
-- Age proofs) is recorded as such: users.age_check = 'manual_verification',
-- and users.age_check_at is when it was confirmed.
alter table public.users drop constraint if exists users_age_check_known;
alter table public.users add constraint users_age_check_known
  check (age_check is null or age_check in ('adult', 'minor_pending', 'adult_confirmed', 'minor_consented', 'manual_verification'));
