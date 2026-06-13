-- Recording-consent evidence.
--
-- The first time a coach starts a class, the app shows a one-time consent
-- gate (they confirm they have the consent of everyone they record). When
-- they accept we stamp this column as a record that consent was given. The
-- app also keeps a local flag so the gate never reappears for that coach;
-- this column is the server-side evidence.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS recording_consent_at TIMESTAMPTZ;
