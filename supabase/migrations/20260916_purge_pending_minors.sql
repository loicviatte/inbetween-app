-- Clearing out under-18 profiles whose parent never said yes.
--
-- Inviting a parent creates the student's profile straight away (pending, on a
-- managed address) plus a pending request to their coach. If the parent never
-- approves — the teen gave up, reinstalled, or started over — that profile and
-- request stayed forever, and the coach kept seeing a student who would never
-- arrive.
--
-- purge_pending_minor removes one such profile: its coach requests, the
-- "new student request" notifications they raised, its unapproved invitation
-- (the parent's contact details included — nothing was ever consented to), and
-- the account. It refuses anything else: a profile with a guardian, an
-- approved or withdrawn consent, or an address that isn't a managed one.
--
-- purge_expired_minor_invites runs it daily for invitations that expired more
-- than three days ago, and drops invitations whose profile is already gone.

create or replace function public.purge_pending_minor(p_child uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
      from auth.users u
      join public.users p on p.id = u.id
     where u.id = p_child
       and p.consent_status = 'pending'
       and u.email like '%@managed.useinbetween.com'
  ) then
    return false;
  end if;
  if exists (select 1 from public.guardians g where g.child_id = p_child)
     or exists (select 1 from public.parental_consents c
                 where c.child_id = p_child and c.status in ('approved', 'withdrawn')) then
    return false;
  end if;

  delete from public.notifications n
   where n.type = 'coach_request_received'
     and n.data->>'student_id' = p_child::text;
  delete from public.coach_requests where student_id = p_child;
  delete from public.parental_consents
   where child_id = p_child and status in ('pending', 'expired');
  delete from auth.users where id = p_child;   -- public.users cascades
  return true;
end;
$$;

create or replace function public.purge_expired_minor_invites()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  purged integer := 0;
begin
  for r in
    select distinct c.child_id
      from public.parental_consents c
     where c.consent_method = 'invitation'
       and c.status in ('pending', 'expired')
       and c.child_id is not null
       and c.expires_at < now() - interval '3 days'
       and not exists (
         select 1 from public.parental_consents live
          where live.child_id = c.child_id
            and (live.status in ('approved', 'withdrawn') or live.expires_at >= now() - interval '3 days')
       )
  loop
    begin
      if public.purge_pending_minor(r.child_id) then
        purged := purged + 1;
      end if;
    exception when others then
      -- Something references the profile that shouldn't (a lesson, say): leave it for a person to look at.
      raise warning 'purge_expired_minor_invites: % left in place: %', r.child_id, sqlerrm;
    end;
  end loop;

  -- A failed delivery already removed the profile; only the parent's details remain.
  delete from public.parental_consents
   where consent_method = 'invitation'
     and status in ('pending', 'expired')
     and child_id is null
     and created_at < now() - interval '3 days';

  return purged;
end;
$$;

revoke all on function public.purge_pending_minor(uuid) from public, anon, authenticated;
revoke all on function public.purge_expired_minor_invites() from public, anon, authenticated;
grant execute on function public.purge_pending_minor(uuid) to service_role;
grant execute on function public.purge_expired_minor_invites() to service_role;

select cron.unschedule('purge-expired-minor-invites')
 where exists (select 1 from cron.job where jobname = 'purge-expired-minor-invites');
select cron.schedule('purge-expired-minor-invites', '17 3 * * *', $$select public.purge_expired_minor_invites()$$);
