-- The admin identity moves to loic@useinbetween.com, and stops being a string
-- copied into thirteen policies.
--
-- The dashboard, the app's trainer screens and every "read everything" policy
-- all asked the same question — is the caller's JWT email this one address —
-- with the address itself written out in each place. Changing it meant
-- rewriting thirteen policies and two functions, which is exactly why it was
-- never changed when the account behind it stopped being used.
--
-- Now they ask public.admin_email(). The address lives in one function; the
-- policies keep their names, their shapes and their other clauses untouched.
--
-- A policy that fails to come back leaves its table with no policy at all,
-- which under RLS denies everyone rather than opening anything — the failure
-- mode is visible, not silent.

create or replace function public.admin_email()
returns text
language sql
stable
as $$ select 'loic@useinbetween.com'::text $$;

comment on function public.admin_email() is
  'The one account that reads everything: the admin dashboard''s login and the app''s trainer screens. Referenced by the trainer/admin RLS policies instead of a literal, so moving it is one line.';

grant execute on function public.admin_email() to anon, authenticated, service_role;

-- Rewrite every policy that carries the old literal, keeping name, command,
-- roles and every other clause exactly as they were.
do $$
declare
  r record;
  stmt text;
begin
  for r in
    select p.policyname, p.tablename, p.cmd, p.roles, p.qual, p.with_check
      from pg_policies p
     where p.schemaname = 'public'
       and (p.qual::text like '%danceuniteduk%' or p.with_check::text like '%danceuniteduk%')
     order by p.tablename, p.policyname
  loop
    stmt := format(
      'create policy %I on public.%I for %s to %s%s%s;',
      r.policyname, r.tablename,
      case r.cmd when 'ALL' then 'all' else lower(r.cmd) end,
      array_to_string(r.roles, ', '),
      case when r.qual is null then ''
           else ' using (' || replace(r.qual, '''loic@danceuniteduk.com''::text', 'public.admin_email()') || ')' end,
      case when r.with_check is null then ''
           else ' with check (' || replace(r.with_check, '''loic@danceuniteduk.com''::text', 'public.admin_email()') || ')' end
    );
    execute format('drop policy %I on public.%I;', r.policyname, r.tablename);
    execute stmt;
  end loop;
end $$;

-- The two functions that carried the same literal.
do $$
declare
  r record;
begin
  for r in
    select p.oid, pg_get_functiondef(p.oid) as def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f'
       and pg_get_functiondef(p.oid) like '%danceuniteduk%'
  loop
    execute replace(r.def, '''loic@danceuniteduk.com''', 'public.admin_email()');
  end loop;
end $$;

-- Rollback: create or replace public.admin_email() returning the old address —
-- the policies need no further change, which is the point.
