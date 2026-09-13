-- ─── Coach cards ────────────────────────────────────────────────────────────
-- What a coach answers during onboarding is a document, not a set of profile
-- fields: it has its own slug, its own publication state, and it is meant to be
-- read by people who are not signed in. So it gets its own table rather than
-- columns bolted onto users.
--
-- One card per coach. The slug is the public address (useinbetween.com/<slug>).
create table if not exists public.coach_cards (
  user_id uuid primary key references public.users(id) on delete cascade,
  slug text not null unique,
  essence text,
  style_words text[] not null default '{}',
  teaches text[] not null default '{}',
  works_with text[] not null default '{}',
  how_i_teach text,
  my_method text,
  -- The spec forbids showing an AI interpretation the coach has not approved.
  -- Today these hold his own words verbatim, so nothing is interpreted; the
  -- flag is what a future reformulation step has to set before it may publish.
  ai_reviewed boolean not null default false,
  alloc jsonb not null default '{}'::jsonb,
  best_for text[] not null default '{}',
  credential text,
  location text,
  contact_channel text,
  contact_value text,
  published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists coach_cards_published on public.coach_cards (published) where published;

create or replace function public.touch_coach_card()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;
drop trigger if exists coach_cards_touch on public.coach_cards;
create trigger coach_cards_touch before update on public.coach_cards
  for each row execute function public.touch_coach_card();

alter table public.coach_cards enable row level security;

-- The coach owns his card outright.
drop policy if exists coach_cards_own on public.coach_cards;
create policy coach_cards_own on public.coach_cards
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- The card exists to be read by a prospect who has no account. Only a published
-- one is readable, and only ever by reading — never by writing.
drop policy if exists coach_cards_public_read on public.coach_cards;
create policy coach_cards_public_read on public.coach_cards
  for select to anon, authenticated using (published);
