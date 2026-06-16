-- ============================================================
-- Tier = target-count only. Remove the out-of-band cap-to-3-per-class trigger.
-- It was ALSO the cause of the "supporting tier auto-retires to past" behaviour
-- — there is no separate supporting rule; supporting simply sorted last in the
-- cap's ranking and got demoted past rank 3. Focus points must NOT auto-retire
-- to 'past' from count/tier/score — only the coach (validate/reject) or the
-- student (archive) change status. This trigger was created out-of-band (not in
-- any migration), so we capture its removal here.
-- ============================================================

DROP TRIGGER IF EXISTS trg_enforce_cap_to_3_per_class ON public.focus_points;
DROP FUNCTION IF EXISTS public.enforce_cap_to_3_per_class();

-- Rollback: re-create public.enforce_cap_to_3_per_class() (a plpgsql trigger fn
-- that ROW_NUMBER()s a class's pending_coach/active focus points by
-- tier(critical<important<supporting) > explicit_priority > base_score >
-- mention_count > created_at desc and sets status='past' where rn > 3), then
--   CREATE TRIGGER trg_enforce_cap_to_3_per_class
--     AFTER INSERT OR UPDATE OF status ON public.focus_points
--     FOR EACH ROW EXECUTE FUNCTION enforce_cap_to_3_per_class();
