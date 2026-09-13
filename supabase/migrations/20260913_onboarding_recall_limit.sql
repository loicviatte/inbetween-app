-- Rate-limit state for the one AI endpoint reachable without a user JWT.
-- It has to live in the database: edge functions run across isolates, so an
-- in-memory counter only ever sees a fraction of the traffic.
create table if not exists public.onboarding_recall_hits (
  id bigserial primary key,
  ip text not null,
  created_at timestamptz not null default now()
);
create index if not exists onboarding_recall_hits_ip_time
  on public.onboarding_recall_hits (ip, created_at desc);
-- Only the edge function (service role) reads or writes this; no policies, so
-- anon and authenticated clients see nothing.
alter table public.onboarding_recall_hits enable row level security;
