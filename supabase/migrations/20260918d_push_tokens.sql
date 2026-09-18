-- Push notifications reach every phone signed in to an account.
--
-- users.push_token held one token per account: the last phone to open the app
-- took every push, and logging out on one phone silenced the other (a coach and
-- the secretary who follows on the same account). One row per device instead.
--
-- A device token belongs to whoever signed in on that phone last: registering
-- moves it. The app goes through the two functions below, never the table.
-- users.push_token stays for apps older than this change; send-push reads both.

create table if not exists public.push_tokens (
  token      text primary key,
  user_id    uuid not null references public.users(id) on delete cascade,
  platform   text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists push_tokens_user_id_idx on public.push_tokens (user_id);

alter table public.push_tokens enable row level security;
drop policy if exists push_tokens_select_own on public.push_tokens;
create policy push_tokens_select_own on public.push_tokens
  for select to authenticated using (user_id = (select auth.uid()));

create or replace function public.register_push_token(p_token text, p_platform text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  if p_token is null or p_token !~ '^Expo(nent)?PushToken\[[^]]+\]$' then
    raise exception 'not an Expo push token';
  end if;
  insert into push_tokens (token, user_id, platform, updated_at)
  values (p_token, auth.uid(), left(p_platform, 16), now())
  on conflict (token) do update
    set user_id = excluded.user_id, platform = excluded.platform, updated_at = now();
end;
$$;

create or replace function public.unregister_push_token(p_token text)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  delete from push_tokens where token = p_token and user_id = (select auth.uid());
$$;

revoke execute on function public.register_push_token(text, text) from public, anon;
revoke execute on function public.unregister_push_token(text) from public, anon;
grant execute on function public.register_push_token(text, text) to authenticated;
grant execute on function public.unregister_push_token(text) to authenticated;

-- The phones already known keep receiving.
insert into public.push_tokens (token, user_id)
select push_token, id from public.users
where push_token ~ '^Expo(nent)?PushToken\[[^]]+\]$'
on conflict (token) do nothing;

-- Rollback:
--   drop function if exists public.register_push_token(text, text);
--   drop function if exists public.unregister_push_token(text);
--   drop table if exists public.push_tokens;
