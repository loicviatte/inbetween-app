-- The retention sweep needs to see storage.objects, and PostgREST only exposes
-- public. Rather than open the storage schema to the API for one query, hand
-- the sweep exactly what it needs: the names of audio objects older than a
-- cutoff. Service-role only — nothing in the app may enumerate the bucket.
--
-- Pass B of purge-expired-audio (see that function's header): an object is
-- written at import, always at or after its lesson, so an object older than the
-- retention limit belongs to a lesson older than the limit — including the ones
-- no row points at any more.

create or replace function public.expired_audio_objects(p_cutoff timestamptz, p_limit integer default 1000)
returns table (name text)
language sql
security definer
set search_path = storage, pg_temp
as $$
  select o.name
    from storage.objects o
   where o.bucket_id = 'class-audio'
     and o.created_at < p_cutoff
   order by o.created_at
   limit greatest(0, least(p_limit, 5000));
$$;

revoke execute on function public.expired_audio_objects(timestamptz, integer) from public, anon, authenticated;

-- Rollback:
--   drop function if exists public.expired_audio_objects(timestamptz, integer);
