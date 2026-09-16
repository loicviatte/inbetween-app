-- Lets the sign-in screen tell a dancer that no account uses the email they
-- typed, before asking for a reset link. Supabase's reset endpoint stays
-- silent for unknown emails, so a typo'd address used to read "Reset link
-- sent" and nothing ever arrived.
--
-- This reveals whether an email is registered — which sign-up already does
-- ("User already registered", since email confirmation is off), so it adds
-- no new exposure.

create or replace function public.account_exists_for_email(p_email text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from auth.users u
     where lower(u.email) = lower(trim(p_email))
       and u.deleted_at is null
  );
$$;

revoke all on function public.account_exists_for_email(text) from public;
grant execute on function public.account_exists_for_email(text) to anon, authenticated;
