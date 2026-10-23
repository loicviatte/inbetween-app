-- ============================================================
-- A question remembers the focus point it was asked from.
--
-- A dancer asks their coach from a focus point's training screen; the focus
-- was only named in the message ("… [Focus: Double Drag Roll]"), so finding it
-- again meant matching by name. The question now carries the focus point's id —
-- a solo one or a couple one — so the answer's thread can open it. Older
-- questions keep the name-based match.
-- ============================================================

alter table public.coach_messages
  add column if not exists focus_point_id uuid
    references public.focus_points(id) on delete set null,
  add column if not exists couple_focus_point_id uuid
    references public.couple_focus_points(id) on delete set null;
