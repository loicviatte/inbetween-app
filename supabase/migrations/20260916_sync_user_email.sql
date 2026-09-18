-- Keep public.users.email in step with the sign-in email.
--
-- A dancer changes their email from the app's Account sheet; once they confirm
-- the link, Supabase Auth updates auth.users.email, but nothing carried it over
-- to public.users — which is what the Account sheet (getAccountUser), coach
-- screens and email lookups read. This trigger copies it across.
--
-- The copy must never block the auth change itself: a failure is logged as a
-- warning and the email change still goes through.

create or replace function public.sync_user_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    update public.users
       set email = new.email
     where id = new.id
       and email is distinct from new.email;
  exception when others then
    raise warning 'sync_user_email failed for %: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

revoke all on function public.sync_user_email() from public, anon, authenticated;

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row
  when (old.email is distinct from new.email)
  execute function public.sync_user_email();
