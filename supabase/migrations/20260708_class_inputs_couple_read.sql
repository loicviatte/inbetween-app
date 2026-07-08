-- ============================================================
-- Fix: couple partner couldn't see the couple readiness card.
--
-- couple_focus_points already grants read to both members via
-- is_couple_participant(couple_id), but class_inputs had NO couple-participant
-- read policy — only the owner (user_id) or their coach could read the row.
-- get_couple_readiness() is SECURITY INVOKER and must read the anchor couple
-- lesson (class_inputs where lesson_type='couple'); for the partner who does
-- NOT own that class_input the anchor lookup returned nothing → the RPC
-- returned NULL → the couple focus/readiness was invisible for that partner.
--
-- Grant couple participants read access to their couple's class_inputs,
-- mirroring the couple_focus_points policy. Read-only, scoped to rows that
-- actually belong to a couple the caller is a member of.
-- ============================================================

DROP POLICY IF EXISTS class_inputs_couple_read ON public.class_inputs;
CREATE POLICY class_inputs_couple_read ON public.class_inputs
  FOR SELECT
  USING (couple_id IS NOT NULL AND public.is_couple_participant(couple_id));
