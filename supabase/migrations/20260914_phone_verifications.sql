-- A parent's mobile number, proven by a code before any child is created on
-- the path without an invitation. An email and three ticked boxes are within
-- reach of the child themselves; a second phone number is much harder to come
-- by. (It still isn't proof of age.)
create table if not exists public.phone_verifications (
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts integer not null default 0,
  verified_at timestamptz,
  token_hash text,
  token_expires_at timestamptz,
  used_at timestamptz,
  delivery_mode text check (delivery_mode in ('live', 'test')),
  created_at timestamptz not null default now()
);
create index if not exists phone_verifications_token on public.phone_verifications (token_hash) where used_at is null;
-- no policies: only the edge functions (service role) touch it
alter table public.phone_verifications enable row level security;
