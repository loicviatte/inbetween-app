-- Onboarding profile fields + richer handle_new_user
--
-- The redesigned registration flow asks students how many private lessons
-- they take per month and how often they train solo. The account is created
-- at the END of the flow; with email confirmation enabled there is no session
-- at signUp time, so all onboarding answers travel in the auth metadata and
-- handle_new_user copies them into public.users.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS lessons_per_month       INTEGER,
  ADD COLUMN IF NOT EXISTS solo_practice_frequency TEXT;

-- Replaces 20260405_fix_handle_new_user_role.sql's version: same name/role
-- handling, plus dance_style, studio_id, lessons_per_month and
-- solo_practice_frequency from the signup metadata.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.users (
    id, email, name, role, dance_style, studio_id,
    lessons_per_month, solo_practice_frequency
  )
  VALUES (
    new.id,
    new.email,
    COALESCE(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    COALESCE(new.raw_user_meta_data->>'role', 'student'),
    new.raw_user_meta_data->>'dance_style',
    NULLIF(new.raw_user_meta_data->>'studio_id', '')::uuid,
    NULLIF(new.raw_user_meta_data->>'lessons_per_month', '')::integer,
    new.raw_user_meta_data->>'solo_practice_frequency'
  );
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
