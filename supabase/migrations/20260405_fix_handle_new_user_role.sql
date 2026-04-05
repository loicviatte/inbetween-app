-- Fix handle_new_user: read role from auth metadata at signup
-- Previously the trigger always inserted role = 'student' (default),
-- ignoring the role selected on the registration screen.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.users (id, email, name, role)
  VALUES (
    new.id,
    new.email,
    COALESCE(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    COALESCE(new.raw_user_meta_data->>'role', 'student')
  );
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Fix existing coach accounts that got stuck with role = 'student'
-- (updates any user whose auth metadata says 'coach' but DB says 'student')
UPDATE public.users u
SET role = 'coach'
WHERE u.role = 'student'
  AND EXISTS (
    SELECT 1 FROM auth.users a
    WHERE a.id = u.id
      AND a.raw_user_meta_data->>'role' = 'coach'
  );
