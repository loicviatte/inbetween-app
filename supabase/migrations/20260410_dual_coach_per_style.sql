-- Support linking separate coaches for Latin and Ballroom when dance_style = 'Latin & Ballroom'

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS latin_coach_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ballroom_coach_id UUID REFERENCES users(id) ON DELETE SET NULL;

-- Track which category a coach request targets (null = generic single-style)
ALTER TABLE coach_requests
  ADD COLUMN IF NOT EXISTS category TEXT; -- 'latin' | 'ballroom' | null
