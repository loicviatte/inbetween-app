-- ============================================================
-- Couple Feature — M0: tables, columns, RLS, lock RPCs
-- See docs/COUPLE_FEATURE_SPEC.md
--
-- A couple is a single shared entity: shared focus points, shared
-- sessions, one readiness, one couple-wide training lock. Everything
-- couple-related is hard-deleted on unpair (ON DELETE CASCADE from
-- `couples`), so no archive/soft-delete is kept across couples.
-- ============================================================

-- ─── 1. couples ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.couples (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_a_id                 uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  user_b_id                 uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  leader_user_id            uuid NOT NULL REFERENCES public.users(id),
  does_latin                boolean NOT NULL DEFAULT false,
  does_ballroom             boolean NOT NULL DEFAULT false,
  latin_couple_coach_id     uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ballroom_couple_coach_id  uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT couples_distinct_members CHECK (user_a_id <> user_b_id),
  UNIQUE (user_a_id),
  UNIQUE (user_b_id)
);
CREATE INDEX IF NOT EXISTS idx_couples_user_a ON public.couples(user_a_id);
CREATE INDEX IF NOT EXISTS idx_couples_user_b ON public.couples(user_b_id);
CREATE INDEX IF NOT EXISTS idx_couples_latin_coach ON public.couples(latin_couple_coach_id);
CREATE INDEX IF NOT EXISTS idx_couples_ballroom_coach ON public.couples(ballroom_couple_coach_id);

-- ─── 2. users.couple_id (O(1) "am I paired?" + one-couple-per-user) ───────────
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS couple_id uuid REFERENCES public.couples(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_users_couple_id ON public.users(couple_id);
-- NOTE: partner pairing reuses the existing users.invite_code (no new code column).

-- ─── 3. class_inputs.couple_id (couple lessons) ───────────────────────────────
-- lesson_type is free text (no CHECK constraint) so 'couple' needs no DDL change.
ALTER TABLE public.class_inputs
  ADD COLUMN IF NOT EXISTS couple_id uuid REFERENCES public.couples(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_class_inputs_couple_id ON public.class_inputs(couple_id);

-- ─── 4. couple_requests (pairing handshake) ───────────────────────────────────
-- A enters B's code → pending; B accepts & configures style+leader →
-- awaiting_validation; A validates → finalize_couple() RPC (added in M1).
CREATE TABLE IF NOT EXISTS public.couple_requests (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id           uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  target_id              uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  proposed_does_latin    boolean,
  proposed_does_ballroom boolean,
  proposed_leader_id     uuid REFERENCES public.users(id),
  status                 text NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending','awaiting_validation','accepted','declined')),
  created_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT couple_requests_distinct CHECK (requester_id <> target_id),
  UNIQUE (requester_id, target_id)
);
CREATE INDEX IF NOT EXISTS idx_couple_requests_target ON public.couple_requests(target_id);
CREATE INDEX IF NOT EXISTS idx_couple_requests_requester ON public.couple_requests(requester_id);

-- ─── 5. couple_coach_requests (couple designates a couple coach, per style) ────
CREATE TABLE IF NOT EXISTS public.couple_coach_requests (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id   uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
  coach_id    uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  category    text NOT NULL CHECK (category IN ('latin','ballroom')),
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (couple_id, category)
);
CREATE INDEX IF NOT EXISTS idx_couple_coach_requests_coach ON public.couple_coach_requests(coach_id);

-- ─── 6. couple_focus_points (mirror of focus_points, keyed by couple) ──────────
-- Style is derived from the `dance` array via danceCategory.js (categoryFromDances),
-- NOT from `category` (which holds the AI taxonomy: Stability/Technicality/...).
CREATE TABLE IF NOT EXISTS public.couple_focus_points (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id                uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
  class_input_id           uuid REFERENCES public.class_inputs(id) ON DELETE SET NULL,
  source_class_input_id    uuid REFERENCES public.class_inputs(id) ON DELETE SET NULL,
  name                     text,
  extracted_name           text,
  normalized_name          text,
  subtitle                 text,
  context                  text,
  drill                    text,
  dance                    text[],
  tier                     text CHECK (tier IN ('critical','important','supporting')),
  category                 text,
  status                   text NOT NULL DEFAULT 'active'
                           CHECK (status IN ('active','past_candidate','past')),
  is_held                  boolean NOT NULL DEFAULT false,
  is_deleted               boolean NOT NULL DEFAULT false,
  is_other                 boolean NOT NULL DEFAULT false,
  base_score               numeric NOT NULL DEFAULT 5,
  practice_count           integer NOT NULL DEFAULT 0,
  coach_signal             numeric NOT NULL DEFAULT 0,
  reactivated              boolean NOT NULL DEFAULT false,
  last_exposed_at          timestamptz,
  last_mentioned_at        timestamptz,
  lessons_since_mentioned  integer NOT NULL DEFAULT 0,
  mention_count            integer NOT NULL DEFAULT 0,
  explicit_priority        boolean NOT NULL DEFAULT false,
  first_timestamp          text,
  coach_note               text,
  coach_review_deadline    timestamptz,
  merge_status             text,
  merge_candidate_id       uuid REFERENCES public.couple_focus_points(id),
  merge_action             text,
  merge_notified_at        timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cfp_couple ON public.couple_focus_points(couple_id);
CREATE INDEX IF NOT EXISTS idx_cfp_class_input ON public.couple_focus_points(class_input_id);
CREATE INDEX IF NOT EXISTS idx_cfp_held ON public.couple_focus_points(couple_id) WHERE is_held = true;

-- ─── 7. couple_practice_logs (mirror of practice_logs, NO dancer attribution) ──
CREATE TABLE IF NOT EXISTS public.couple_practice_logs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id             uuid NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
  couple_focus_point_id uuid NOT NULL REFERENCES public.couple_focus_points(id) ON DELETE CASCADE,
  duration_minutes      integer NOT NULL,
  rating                text NOT NULL CHECK (rating IN ('hard','struggled','okay','good','great')),
  feeling               text,
  session_note          text,
  session_motivation    integer,
  started_at            timestamptz,
  completed_at          timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cpl_couple ON public.couple_practice_logs(couple_id);
CREATE INDEX IF NOT EXISTS idx_cpl_fp ON public.couple_practice_logs(couple_focus_point_id);

-- ─── 8. couple_focus_locks (couple-wide training lock; one row per couple) ─────
-- couple_id PK = the UNIQUE that makes acquire atomic & couple-wide.
CREATE TABLE IF NOT EXISTS public.couple_focus_locks (
  couple_id                 uuid PRIMARY KEY REFERENCES public.couples(id) ON DELETE CASCADE,
  couple_focus_point_id     uuid NOT NULL REFERENCES public.couple_focus_points(id) ON DELETE CASCADE,
  locked_by_user_id         uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  started_at                timestamptz NOT NULL DEFAULT now(),
  session_duration_minutes  integer NOT NULL DEFAULT 7,
  last_heartbeat_at         timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- RLS helper functions (SECURITY DEFINER → bypass nested RLS / recursion)
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_couple_participant(p_couple uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.couples c
    WHERE c.id = p_couple
      AND auth.uid() IN (c.user_a_id, c.user_b_id,
                         c.latin_couple_coach_id, c.ballroom_couple_coach_id)
  );
$$;

CREATE OR REPLACE FUNCTION public.is_couple_member(p_couple uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.couples c
    WHERE c.id = p_couple AND auth.uid() IN (c.user_a_id, c.user_b_id)
  );
$$;

CREATE OR REPLACE FUNCTION public.is_couple_coach(p_couple uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.couples c
    WHERE c.id = p_couple
      AND auth.uid() IN (c.latin_couple_coach_id, c.ballroom_couple_coach_id)
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_couple_participant(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_couple_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_couple_coach(uuid) TO authenticated;

-- ============================================================
-- RLS policies (service role bypasses RLS entirely)
-- ============================================================
ALTER TABLE public.couples               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.couple_requests       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.couple_coach_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.couple_focus_points   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.couple_practice_logs  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.couple_focus_locks    ENABLE ROW LEVEL SECURITY;

-- couples: participants read; members create/update/delete (coach designation via RPC/service)
DROP POLICY IF EXISTS "couples_select" ON public.couples;
CREATE POLICY "couples_select" ON public.couples FOR SELECT USING (
  auth.uid() IN (user_a_id, user_b_id, latin_couple_coach_id, ballroom_couple_coach_id)
);
DROP POLICY IF EXISTS "couples_insert" ON public.couples;
CREATE POLICY "couples_insert" ON public.couples FOR INSERT WITH CHECK (
  auth.uid() IN (user_a_id, user_b_id)
);
DROP POLICY IF EXISTS "couples_update" ON public.couples;
CREATE POLICY "couples_update" ON public.couples FOR UPDATE USING (
  auth.uid() IN (user_a_id, user_b_id)
);
DROP POLICY IF EXISTS "couples_delete" ON public.couples;
CREATE POLICY "couples_delete" ON public.couples FOR DELETE USING (
  auth.uid() IN (user_a_id, user_b_id)
);

-- couple_requests: the two parties read; requester inserts; both update; both delete
DROP POLICY IF EXISTS "couple_requests_select" ON public.couple_requests;
CREATE POLICY "couple_requests_select" ON public.couple_requests FOR SELECT
  USING (requester_id = auth.uid() OR target_id = auth.uid());
DROP POLICY IF EXISTS "couple_requests_insert" ON public.couple_requests;
CREATE POLICY "couple_requests_insert" ON public.couple_requests FOR INSERT
  WITH CHECK (requester_id = auth.uid());
DROP POLICY IF EXISTS "couple_requests_update" ON public.couple_requests;
CREATE POLICY "couple_requests_update" ON public.couple_requests FOR UPDATE
  USING (requester_id = auth.uid() OR target_id = auth.uid());
DROP POLICY IF EXISTS "couple_requests_delete" ON public.couple_requests;
CREATE POLICY "couple_requests_delete" ON public.couple_requests FOR DELETE
  USING (requester_id = auth.uid() OR target_id = auth.uid());

-- couple_coach_requests: coach + members read; members create; coach responds; members/coach delete
DROP POLICY IF EXISTS "ccr_select" ON public.couple_coach_requests;
CREATE POLICY "ccr_select" ON public.couple_coach_requests FOR SELECT
  USING (coach_id = auth.uid() OR public.is_couple_member(couple_id));
DROP POLICY IF EXISTS "ccr_insert" ON public.couple_coach_requests;
CREATE POLICY "ccr_insert" ON public.couple_coach_requests FOR INSERT
  WITH CHECK (public.is_couple_member(couple_id));
DROP POLICY IF EXISTS "ccr_update" ON public.couple_coach_requests;
CREATE POLICY "ccr_update" ON public.couple_coach_requests FOR UPDATE
  USING (coach_id = auth.uid());
DROP POLICY IF EXISTS "ccr_delete" ON public.couple_coach_requests;
CREATE POLICY "ccr_delete" ON public.couple_coach_requests FOR DELETE
  USING (coach_id = auth.uid() OR public.is_couple_member(couple_id));

-- couple_focus_points: participants read; couple-coach writes (pipeline uses service role)
DROP POLICY IF EXISTS "cfp_select" ON public.couple_focus_points;
CREATE POLICY "cfp_select" ON public.couple_focus_points FOR SELECT
  USING (public.is_couple_participant(couple_id));
DROP POLICY IF EXISTS "cfp_insert" ON public.couple_focus_points;
CREATE POLICY "cfp_insert" ON public.couple_focus_points FOR INSERT
  WITH CHECK (public.is_couple_coach(couple_id));
DROP POLICY IF EXISTS "cfp_update" ON public.couple_focus_points;
CREATE POLICY "cfp_update" ON public.couple_focus_points FOR UPDATE
  USING (public.is_couple_coach(couple_id));

-- couple_practice_logs: participants read; members insert
DROP POLICY IF EXISTS "cpl_select" ON public.couple_practice_logs;
CREATE POLICY "cpl_select" ON public.couple_practice_logs FOR SELECT
  USING (public.is_couple_participant(couple_id));
DROP POLICY IF EXISTS "cpl_insert" ON public.couple_practice_logs;
CREATE POLICY "cpl_insert" ON public.couple_practice_logs FOR INSERT
  WITH CHECK (public.is_couple_member(couple_id));

-- couple_focus_locks: participants read (live mirror via realtime); writes are RPC-only
DROP POLICY IF EXISTS "cfl_select" ON public.couple_focus_locks;
CREATE POLICY "cfl_select" ON public.couple_focus_locks FOR SELECT
  USING (public.is_couple_participant(couple_id));

-- ============================================================
-- Lock RPCs (SECURITY DEFINER → atomic, bypass RLS). Client compares the
-- returned locked_by_user_id with the current user: equal ⇒ acquired/took over;
-- different ⇒ genuinely held by the partner.
-- ============================================================
CREATE OR REPLACE FUNCTION public.acquire_couple_lock(p_couple uuid, p_fp uuid, p_duration integer)
RETURNS public.couple_focus_locks
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_lock public.couple_focus_locks;
BEGIN
  IF NOT public.is_couple_member(p_couple) THEN
    RAISE EXCEPTION 'not a couple member';
  END IF;

  -- 1) fresh acquire
  INSERT INTO public.couple_focus_locks
    (couple_id, couple_focus_point_id, locked_by_user_id, started_at, session_duration_minutes, last_heartbeat_at)
  VALUES (p_couple, p_fp, auth.uid(), now(), p_duration, now())
  ON CONFLICT (couple_id) DO NOTHING
  RETURNING * INTO v_lock;
  IF FOUND THEN RETURN v_lock; END IF;

  -- 2) take over a stale lock (crash / force-quit: no heartbeat for 90s)
  UPDATE public.couple_focus_locks
     SET couple_focus_point_id = p_fp,
         locked_by_user_id = auth.uid(),
         started_at = now(),
         session_duration_minutes = p_duration,
         last_heartbeat_at = now()
   WHERE couple_id = p_couple
     AND last_heartbeat_at < now() - interval '90 seconds'
  RETURNING * INTO v_lock;
  IF FOUND THEN RETURN v_lock; END IF;

  -- 3) genuinely locked by the partner → return current holder
  SELECT * INTO v_lock FROM public.couple_focus_locks WHERE couple_id = p_couple;
  RETURN v_lock;
END;
$$;

CREATE OR REPLACE FUNCTION public.heartbeat_couple_lock(p_couple uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.couple_focus_locks
     SET last_heartbeat_at = now()
   WHERE couple_id = p_couple AND locked_by_user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.release_couple_lock(p_couple uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM public.couple_focus_locks
   WHERE couple_id = p_couple AND locked_by_user_id = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION public.acquire_couple_lock(uuid, uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.heartbeat_couple_lock(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.release_couple_lock(uuid) TO authenticated;

-- ============================================================
-- Realtime: publish the live-synced couple tables
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='couple_focus_locks') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.couple_focus_locks;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='couple_focus_points') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.couple_focus_points;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='couple_practice_logs') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.couple_practice_logs;
  END IF;
END $$;
