-- InBetween App — Supabase migration
-- Run this in the Supabase SQL editor

-- ─── Tables ─────────────────────────────────────────────────────────────────

create table if not exists public.users (
  id uuid references auth.users(id) on delete cascade primary key,
  email text not null,
  name text,
  current_summary text,
  created_at timestamptz default now()
);

create table if not exists public.class_inputs (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.users(id) on delete cascade not null,
  title text,
  takeaway text,
  practice_point_1 text not null,
  priority_score_1 integer default 3,
  practice_point_2 text,
  priority_score_2 integer,
  ai_primary_focus text,
  ai_secondary_focus text,
  is_deleted boolean default false,
  created_at timestamptz default now()
);

create table if not exists public.focus_points (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.users(id) on delete cascade not null,
  name text not null,
  normalized_name text not null,
  category text check (category in ('Stability', 'Technicality', 'Strength', 'Creativity', 'Musicality')),
  count integer default 1,
  is_archived boolean default false,
  is_deleted boolean default false,
  created_at timestamptz default now()
);

create table if not exists public.focus_progress (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.users(id) on delete cascade not null,
  focus_point_id uuid references public.focus_points(id) on delete cascade not null,
  class_input_id uuid references public.class_inputs(id),
  priority_score integer default 0,
  completed boolean default false,
  created_at timestamptz default now()
);

create table if not exists public.notes (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.users(id) on delete cascade not null,
  title text,
  content text,
  linked_class_input_id uuid references public.class_inputs(id),
  video_clips jsonb default '[]'::jsonb,
  is_deleted boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.training_sessions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.users(id) on delete cascade not null,
  slot1_focus_id uuid references public.focus_points(id) on delete set null,
  slot2_focus_id uuid references public.focus_points(id) on delete set null,
  started_at timestamptz default now(),
  completed_at timestamptz,
  feeling text,
  session_note text,
  created_at timestamptz default now()
);

-- If training_sessions already exists, add the new columns:
ALTER TABLE training_sessions ADD COLUMN IF NOT EXISTS feeling text;
ALTER TABLE training_sessions ADD COLUMN IF NOT EXISTS session_note text;
ALTER TABLE training_sessions ADD COLUMN IF NOT EXISTS completed_at timestamptz;

-- ─── Row Level Security ─────────────────────────────────────────────────────

alter table public.users enable row level security;
alter table public.class_inputs enable row level security;
alter table public.focus_points enable row level security;
alter table public.focus_progress enable row level security;
alter table public.notes enable row level security;
alter table public.training_sessions enable row level security;

-- users
create policy "users_select" on public.users for select using (auth.uid() = id);
create policy "users_insert" on public.users for insert with check (auth.uid() = id);
create policy "users_update" on public.users for update using (auth.uid() = id);

-- class_inputs
create policy "class_inputs_select" on public.class_inputs for select using (auth.uid() = user_id);
create policy "class_inputs_insert" on public.class_inputs for insert with check (auth.uid() = user_id);
create policy "class_inputs_update" on public.class_inputs for update using (auth.uid() = user_id);

-- focus_points
create policy "focus_points_select" on public.focus_points for select using (auth.uid() = user_id);
create policy "focus_points_insert" on public.focus_points for insert with check (auth.uid() = user_id);
create policy "focus_points_update" on public.focus_points for update using (auth.uid() = user_id);

-- focus_progress
create policy "focus_progress_select" on public.focus_progress for select using (auth.uid() = user_id);
create policy "focus_progress_insert" on public.focus_progress for insert with check (auth.uid() = user_id);

-- notes
create policy "notes_select" on public.notes for select using (auth.uid() = user_id);
create policy "notes_insert" on public.notes for insert with check (auth.uid() = user_id);
create policy "notes_update" on public.notes for update using (auth.uid() = user_id);
create policy "notes_delete" on public.notes for delete using (auth.uid() = user_id);

-- ─── Trigger: create user profile on signup ─────────────────────────────────

create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.users (id, email, name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1))
  );
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ─── Trigger: auto-update notes.updated_at ──────────────────────────────────

create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists on_notes_updated on public.notes;
create trigger on_notes_updated
  before update on public.notes
  for each row execute procedure public.handle_updated_at();
