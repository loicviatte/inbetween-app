-- ─── Parental consent for minors ────────────────────────────────────────────
-- A student under 18 cannot be recorded until a parent has approved, and that
-- approval has to be provable later: which email and which phone were verified
-- and when, from which address, against exactly which wording.
--
-- consent_status lives on the student row so every recording path can check it
-- in one place. The proof lives in its own table, out of every client's reach,
-- and it deliberately survives the deletion of the student it describes: a
-- withdrawal erases the child's data, not the record that permission was once
-- given and then withdrawn.

alter table public.users
  add column if not exists consent_status text not null default 'not_required';
alter table public.users drop constraint if exists users_consent_status_known;
alter table public.users add constraint users_consent_status_known
  check (consent_status in ('not_required', 'pending', 'granted', 'withdrawn')) not valid;

create table if not exists public.parental_consents (
  id uuid primary key default gen_random_uuid(),
  -- set null, never cascade: the proof outlives the data it authorised
  child_id uuid references public.users(id) on delete set null,
  child_name text not null,
  coach_id uuid references public.users(id) on delete set null,
  coach_name text,
  parent_first_name text not null,
  parent_email text not null,
  parent_phone text not null,
  -- secrets are stored hashed; the plaintext only ever travels in the messages
  email_token_hash text,
  sms_code_hash text,
  device_secret_hash text not null,
  ticket_hash text,
  ticket_expires_at timestamptz,
  expires_at timestamptz not null,
  verify_attempts integer not null default 0,
  resend_count integer not null default 0,
  last_sent_at timestamptz,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'withdrawn', 'expired')),
  email_verified_at timestamptz,
  phone_verified_at timestamptz,
  approved_at timestamptz,
  approved_ip text,
  consent_text jsonb,          -- the exact wording the parent was shown
  terms_version text,
  delivery_mode text not null default 'live' check (delivery_mode in ('live', 'test')),
  stripe_ref text,             -- card verification, not built yet
  guardian_id uuid references public.users(id) on delete set null,
  withdrawn_at timestamptz,
  withdrawn_ip text,
  created_at timestamptz not null default now()
);
create index if not exists parental_consents_token on public.parental_consents (email_token_hash) where status = 'pending';
create index if not exists parental_consents_ticket on public.parental_consents (ticket_hash) where status = 'pending';
create index if not exists parental_consents_child on public.parental_consents (child_id);
-- no policies: only the minor-consent edge function (service role) reads or writes it
alter table public.parental_consents enable row level security;

create table if not exists public.consent_rate_hits (
  id bigserial primary key,
  key text not null,
  created_at timestamptz not null default now()
);
create index if not exists consent_rate_hits_key_time on public.consent_rate_hits (key, created_at desc);
alter table public.consent_rate_hits enable row level security;

-- ── the technical impossibility ──
-- Every path that attaches a lesson to a student goes through one of these four
-- tables. Refusing the row here means no client — old build, modified build,
-- script — can record a student whose parent has not approved.
-- The row is read as JSON because the four tables do not share their columns.
create or replace function public.refuse_unconsented_student()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r jsonb := to_jsonb(new);
  ids text[] := '{}';
begin
  if r ? 'student_id' and r->>'student_id' is not null then
    ids := ids || (r->>'student_id');
  end if;
  if r ? 'student_ids' and jsonb_typeof(r->'student_ids') = 'array' then
    ids := ids || array(select jsonb_array_elements_text(r->'student_ids'));
  end if;
  if array_length(ids, 1) is null then
    return new;
  end if;
  if exists (
    select 1 from public.users u
    where u.id::text = any(ids) and u.consent_status in ('pending', 'withdrawn')
  ) then
    raise exception 'A parent must approve before this student can be recorded'
      using errcode = 'P0001', hint = 'parental_consent_required';
  end if;
  return new;
end;
$$;

drop trigger if exists class_recordings_consent on public.class_recordings;
create trigger class_recordings_consent
  before insert or update of student_id on public.class_recordings
  for each row execute function public.refuse_unconsented_student();

drop trigger if exists class_recording_students_consent on public.class_recording_students;
create trigger class_recording_students_consent
  before insert or update of student_id on public.class_recording_students
  for each row execute function public.refuse_unconsented_student();

drop trigger if exists class_input_students_consent on public.class_input_students;
create trigger class_input_students_consent
  before insert or update of student_id on public.class_input_students
  for each row execute function public.refuse_unconsented_student();

drop trigger if exists class_inputs_consent on public.class_inputs;
create trigger class_inputs_consent
  before insert or update of student_id, student_ids on public.class_inputs
  for each row execute function public.refuse_unconsented_student();

-- A group lesson belongs to everyone in it: a withdrawal removes this student's
-- place in it, never the lesson. student_ids' element type is not assumed.
create or replace function public.remove_student_from_group_inputs(target uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    update public.class_inputs
       set student_ids = array_remove(student_ids, target)
     where target = any(student_ids);
  exception when others then
    update public.class_inputs
       set student_ids = array_remove(student_ids, target::text)
     where target::text = any(student_ids);
  end;
end;
$$;
revoke all on function public.remove_student_from_group_inputs(uuid) from public, anon, authenticated;
grant execute on function public.remove_student_from_group_inputs(uuid) to service_role;
