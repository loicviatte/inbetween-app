-- A guardian can follow several dancers, so the app needs to know which one it
-- is showing. Kept on the parent's row rather than on the device: it survives a
-- reinstall and is the same on every phone they sign in on.
alter table public.users
  add column if not exists active_child_id uuid references public.users(id) on delete set null;

-- The parent already reads and writes their own row (users_self), so no new
-- policy is needed — but the column must never point at someone they do not
-- guard. Enforced on write rather than by a constraint, because the check has
-- to consult guardians, which a CHECK cannot do.
create or replace function public.guard_active_child()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.active_child_id is not null
     and not exists (
       select 1 from public.guardians g
       where g.guardian_id = new.id and g.child_id = new.active_child_id
     )
  then
    raise exception 'active_child_id must be a child you guard';
  end if;
  return new;
end;
$$;

drop trigger if exists users_guard_active_child on public.users;
create trigger users_guard_active_child
  before insert or update of active_child_id on public.users
  for each row execute function public.guard_active_child();
