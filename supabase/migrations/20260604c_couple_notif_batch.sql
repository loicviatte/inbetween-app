-- ============================================================
-- Couple Feature — batch the "new couple focus" push to dancers.
-- Was a per-row trigger → a couple class approved (or auto-published) with
-- N focus points pinged each dancer N times. Now a STATEMENT-level trigger
-- with transition tables sends ONE notification per couple per
-- approve-all / auto-publish statement.
-- (The couple-coach "review" push is batched in yoda-score directly.)
-- ============================================================

CREATE OR REPLACE FUNCTION public.notify_couple_focus_points_batch()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE rec record;
BEGIN
  FOR rec IN
    SELECT n.couple_id, count(*) AS cnt, max(n.name) AS one_name
    FROM newtab n
    JOIN oldtab o ON o.id = n.id
    WHERE COALESCE(n.is_other, false) = false
      AND n.status = 'active'
      AND o.status IS DISTINCT FROM 'active'
    GROUP BY n.couple_id
  LOOP
    INSERT INTO public.notifications (user_id, type, title, body, data)
    SELECT uid, 'couple_focus_added', 'New couple focus',
      CASE WHEN rec.cnt = 1
        THEN 'New couple focus point: ' || COALESCE(rec.one_name, 'a new focus') || '.'
        ELSE rec.cnt::text || ' new couple focus points were added.' END,
      jsonb_build_object('couple_id', rec.couple_id)
    FROM (
      SELECT user_a_id AS uid FROM public.couples WHERE id = rec.couple_id
      UNION ALL
      SELECT user_b_id FROM public.couples WHERE id = rec.couple_id
    ) m
    WHERE m.uid IS NOT NULL;
  END LOOP;
  RETURN NULL;
END; $$;

-- Replace the per-row trigger (from 20260604_couple_fp_review) with the
-- statement-level batched one.
DROP TRIGGER IF EXISTS trg_notify_couple_focus_point ON public.couple_focus_points;
DROP TRIGGER IF EXISTS trg_notify_couple_focus_points_batch ON public.couple_focus_points;
-- NB: no `OF status` column list — Postgres forbids transition tables with a
-- column list. The function already filters to rows entering 'active', so
-- firing on any UPDATE is correct (no-op when status didn't change).
CREATE TRIGGER trg_notify_couple_focus_points_batch
  AFTER UPDATE ON public.couple_focus_points
  REFERENCING OLD TABLE AS oldtab NEW TABLE AS newtab
  FOR EACH STATEMENT EXECUTE FUNCTION public.notify_couple_focus_points_batch();
