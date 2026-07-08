-- ============================================================================
-- Security fix: replace over-permissive "service_all" RLS policies + enable
-- RLS on ai_call_logs.
--
-- Root cause: several tables were created with
--     CREATE POLICY "service_all_x" ON t USING (true) WITH CHECK (true);
-- with NO `TO` clause. A policy without a `TO` clause applies to PUBLIC
-- (anon + authenticated), NOT just service_role — and service_role bypasses
-- RLS anyway, so it never needed a policy. The net effect was that every
-- logged-in user had full SELECT/INSERT/UPDATE/DELETE on these tables, and on
-- class_input_students the permissive policy also nullified the correctly
-- scoped cis_student_read_own / cis_student_update_own policies (permissive
-- policies are OR'd together).
--
-- All writes to these tables from the backend come from edge functions using
-- the service-role key, which bypasses RLS, so no service policy is required.
-- The policies below only re-grant the legitimate CLIENT access paths:
--   * AI review tables  -> trainer admin account only (TrainerReviewScreen /
--                          ProfileScreen pending-review count)
--   * class_input_students -> coach who owns the parent class (roster mgmt) +
--                          the student's own row (already covered by the
--                          existing cis_student_read_own / _update_own).
--   * ai_call_logs      -> trainer read-only (billing/cost data).
--
-- Idempotent: safe to re-run.
-- ============================================================================

-- ── 1. AI training / scoring review tables — trainer admin only ──────────────
-- Client access is exclusively the trainer account (loic@danceuniteduk.com)
-- via TrainerReviewScreen (select/insert/update) and ProfileScreen (count).

DROP POLICY IF EXISTS "service_all_score_decisions" ON yoda_score_decisions;
DROP POLICY IF EXISTS "service_all_score_feedback"  ON yoda_score_feedback;
DROP POLICY IF EXISTS "service_all_candidates"      ON ai_training_candidates;
DROP POLICY IF EXISTS "service_all_feedback"        ON ai_feedback;

DROP POLICY IF EXISTS "yoda_score_decisions_trainer_all" ON yoda_score_decisions;
CREATE POLICY "yoda_score_decisions_trainer_all" ON yoda_score_decisions
  FOR ALL
  USING      (auth.jwt() ->> 'email' = 'loic@danceuniteduk.com')
  WITH CHECK (auth.jwt() ->> 'email' = 'loic@danceuniteduk.com');

DROP POLICY IF EXISTS "yoda_score_feedback_trainer_all" ON yoda_score_feedback;
CREATE POLICY "yoda_score_feedback_trainer_all" ON yoda_score_feedback
  FOR ALL
  USING      (auth.jwt() ->> 'email' = 'loic@danceuniteduk.com')
  WITH CHECK (auth.jwt() ->> 'email' = 'loic@danceuniteduk.com');

DROP POLICY IF EXISTS "ai_training_candidates_trainer_all" ON ai_training_candidates;
CREATE POLICY "ai_training_candidates_trainer_all" ON ai_training_candidates
  FOR ALL
  USING      (auth.jwt() ->> 'email' = 'loic@danceuniteduk.com')
  WITH CHECK (auth.jwt() ->> 'email' = 'loic@danceuniteduk.com');

DROP POLICY IF EXISTS "ai_feedback_trainer_all" ON ai_feedback;
CREATE POLICY "ai_feedback_trainer_all" ON ai_feedback
  FOR ALL
  USING      (auth.jwt() ->> 'email' = 'loic@danceuniteduk.com')
  WITH CHECK (auth.jwt() ->> 'email' = 'loic@danceuniteduk.com');

-- ── 2. class_input_students — parent-class owner (coach) + student-own ────────
-- The coach who created the class owns it via class_inputs.user_id. That coach
-- manages the roster from the client (insert on class start, upsert attendance,
-- delete a student, read the roster). Students keep read/update of their own
-- row via the existing cis_student_read_own / cis_student_update_own policies.

DROP POLICY IF EXISTS "cis_service_all" ON class_input_students;
DROP POLICY IF EXISTS "cis_owner_all"   ON class_input_students;
CREATE POLICY "cis_owner_all" ON class_input_students
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM class_inputs ci
      WHERE ci.id = class_input_students.class_input_id
        AND ci.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM class_inputs ci
      WHERE ci.id = class_input_students.class_input_id
        AND ci.user_id = auth.uid()
    )
  );

-- ── 3. ai_call_logs — RLS was never enabled; expose to trainer read only ─────
-- Writes come from edge functions via service role (bypasses RLS). No client
-- writes. Only the trainer account may read cost/billing data.

ALTER TABLE public.ai_call_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ai_call_logs_trainer_read" ON public.ai_call_logs;
CREATE POLICY "ai_call_logs_trainer_read" ON public.ai_call_logs
  FOR SELECT
  USING (auth.jwt() ->> 'email' = 'loic@danceuniteduk.com');
