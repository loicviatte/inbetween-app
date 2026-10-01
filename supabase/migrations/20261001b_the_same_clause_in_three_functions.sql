-- The same clause, in the three functions that copied it.
--
-- 20261001a fixed the read policy: "my coach taught this class and it names no
-- student" let every student of a coach read his couple lessons, because a
-- couple lesson names no student either. Three SECURITY DEFINER functions carry
-- the same sentence, written the same way, each deciding the same thing for a
-- different caller:
--
--   · guardian_can_read_class_input — and it was live: Olha, whose daughter
--     Yaroslava has Fabio as her Ballroom coach, could still read Sanna and
--     Sadie's couple lesson through this branch after the policy was fixed.
--   · lesson_minutes — would have counted that lesson's minutes into theirs.
--   · get_lesson_readiness — not reachable in practice, since its anchor must
--     carry the reader's own focus points, but the clause has to say the same
--     thing as the policy or the next change to one of them reopens this.
--
-- Each gets the same exclusion, by couple_id and by lesson_type, since one
-- older couple class carries the type and no couple_id. The couple's own
-- participants keep their access through the branches written for them.
--
-- Rollback: re-apply each function with `(… or ci.student_id is null)` alone.

CREATE OR REPLACE FUNCTION public.guardian_can_read_class_input(p_ci uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.class_inputs ci
     where ci.id = p_ci
       and (
         -- a lesson the child logged themselves is theirs as author, not as student
         public.is_guardian_of(ci.user_id)
         or public.is_guardian_of(ci.student_id)
         or exists (select 1 from unnest(coalesce(ci.student_ids, '{}'::uuid[])) sid where public.is_guardian_of(sid))
         or exists (select 1 from public.class_input_students s
                     where s.class_input_id = ci.id and public.is_guardian_of(s.student_id))
         or (ci.couple_id is not null and exists (
               select 1 from public.couples c
                where c.id = ci.couple_id
                  and (public.is_guardian_of(c.user_a_id) or public.is_guardian_of(c.user_b_id))))
         or exists (
               select 1 from public.guardians g
                 join public.users u on u.id = g.child_id
                where g.guardian_id = auth.uid()
                  and (u.latin_coach_id = ci.user_id or u.ballroom_coach_id = ci.user_id)
                  and (ci.student_id = u.id
                       or (ci.student_id is null
                           and ci.couple_id is null
                           and coalesce(ci.lesson_type, '') <> 'couple')))
       )
  );
$function$
;

CREATE OR REPLACE FUNCTION public.lesson_minutes(p_ids uuid[])
 RETURNS TABLE(class_input_id uuid, minutes integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with visible as (
    select ci.id
      from public.class_inputs ci
     where ci.id = any(p_ids)
       and (
         ci.user_id = auth.uid()
         or ci.student_id = auth.uid()
         or exists (select 1 from public.users u
                     where u.id = ci.user_id
                       and (u.latin_coach_id = auth.uid() or u.ballroom_coach_id = auth.uid()))
         or exists (select 1 from public.users u
                     where u.id = auth.uid()
                       and (u.latin_coach_id = ci.user_id or u.ballroom_coach_id = ci.user_id)
                       and (ci.student_id = auth.uid()
                            or (ci.student_id is null
                                and ci.couple_id is null
                                and coalesce(ci.lesson_type, '') <> 'couple')))
         or (ci.couple_id is not null and public.is_couple_participant(ci.couple_id))
         or public.guardian_can_read_class_input(ci.id)
         or ci.user_id in (select cr.student_id from public.coach_requests cr
                            where cr.coach_id = auth.uid() and cr.status = 'accepted')
       )
  )
  select r.class_input_id,
         max(least(180, greatest(1, round(coalesce(
           r.mic_file_duration_sec::numeric / 60,
           extract(epoch from (r.ended_at - r.started_at)) / 60)))))::int as minutes
    from public.class_recordings r
    join visible v on v.id = r.class_input_id
   where r.mic_file_duration_sec is not null
      or (r.started_at is not null and r.ended_at is not null)
   group by r.class_input_id;
$function$
;

CREATE OR REPLACE FUNCTION public.get_lesson_readiness(p_user uuid, p_category text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  latin        text[] := ARRAY['Cha Cha','Samba','Rumba','Paso Doble','Jive'];
  v_uid        uuid := auth.uid();
  v_trainer    boolean := coalesce((auth.jwt() ->> 'email') = public.admin_email(), false);
  -- The service key (edge functions such as yoda-score) bypassed every policy.
  v_service    boolean := coalesce(auth.role() = 'service_role', false);
  v_self       boolean;
  v_guardian   boolean;
  v_coach      boolean;
  v_logs       boolean;
  v_last       record;
  v_focuses    jsonb;
  v_target_sum int := 0;
  v_done_sum   int := 0;
BEGIN
  -- Who may read this dancer's readiness — the focus_points read policy, checked
  -- once instead of on every row (row policies cost ~40x here).
  v_self := v_uid IS NOT NULL AND v_uid = p_user;
  v_guardian := public.is_guardian_of(p_user);
  v_coach := v_uid IS NOT NULL AND (
    EXISTS (SELECT 1 FROM coach_requests cr WHERE cr.coach_id = v_uid AND cr.student_id = p_user AND cr.status = 'accepted')
    OR EXISTS (SELECT 1 FROM users u WHERE u.id = p_user AND (u.latin_coach_id = v_uid OR u.ballroom_coach_id = v_uid))
  );
  IF NOT (v_service OR v_self OR v_guardian OR v_coach OR v_trainer) THEN
    RETURN NULL;
  END IF;
  -- practice_logs' read policy has no trainer branch.
  v_logs := v_service OR v_self OR v_guardian OR v_coach;

  SELECT ci.id, ci.created_at
    INTO v_last
  FROM class_inputs ci
  WHERE ci.id IN (
          SELECT DISTINCT fp.class_input_id
          FROM focus_points fp
          WHERE fp.user_id = p_user
            AND fp.is_other = false
            AND fp.is_deleted IS NOT TRUE
            AND fp.is_archived IS NOT TRUE
            AND fp.status <> 'past'
            AND fp.class_input_id IS NOT NULL
            AND (
              p_category IS NULL
              OR fp.dance IS NULL OR cardinality(fp.dance) = 0
              OR (p_category = 'latin'    AND fp.dance && latin)
              OR (p_category = 'ballroom' AND NOT (fp.dance && latin))
            )
        )
    AND (ci.lesson_type IN ('private', 'couple') OR ci.lesson_type IS NULL)
    AND ci.is_deleted IS NOT TRUE
    -- the focus points' admin-approval policy, and the class read policy
    AND (v_service OR v_trainer OR ci.coach_released_at IS NOT NULL)
    AND (
      v_service
      OR v_trainer
      OR (ci.couple_id IS NOT NULL AND public.is_couple_participant(ci.couple_id))
      OR public.guardian_can_read_class_input(ci.id)
      OR ci.user_id = v_uid
      OR ci.student_id = v_uid
      OR EXISTS (SELECT 1 FROM users u WHERE u.id = ci.user_id AND (u.latin_coach_id = v_uid OR u.ballroom_coach_id = v_uid))
      OR EXISTS (SELECT 1 FROM users u WHERE u.id = v_uid AND (u.latin_coach_id = ci.user_id OR u.ballroom_coach_id = ci.user_id)
                   AND (ci.student_id = v_uid
           OR (ci.student_id IS NULL
               AND ci.couple_id IS NULL
               AND COALESCE(ci.lesson_type, '') <> 'couple')))
      OR ci.user_id IN (SELECT cr.student_id FROM coach_requests cr WHERE cr.coach_id = v_uid AND cr.status = 'accepted')
    )
  ORDER BY ci.created_at DESC
  LIMIT 1;

  IF v_last.id IS NULL THEN
    RETURN NULL;
  END IF;

  WITH fps AS (
    SELECT fp.id, fp.name, fp.tier, fp.train_target
    FROM focus_points fp
    WHERE fp.user_id = p_user
      AND fp.class_input_id = v_last.id
      AND fp.is_other = false
      AND fp.is_deleted IS NOT TRUE
      AND fp.is_archived IS NOT TRUE
      AND fp.status <> 'past'
      AND (
        p_category IS NULL
        OR fp.dance IS NULL OR cardinality(fp.dance) = 0
        OR (p_category = 'latin'    AND fp.dance && latin)
        OR (p_category = 'ballroom' AND NOT (fp.dance && latin))
      )
  ),
  counts AS (
    SELECT pl.focus_point_id, count(*) AS done
    FROM practice_logs pl
    WHERE v_logs
      AND pl.student_id = p_user
      AND pl.focus_point_id IN (SELECT id FROM fps)
      AND pl.completed_at IS NOT NULL
      AND pl.completed_at >= v_last.created_at
    GROUP BY pl.focus_point_id
  ),
  rows AS (
    SELECT
      fps.id,
      fps.name,
      fps.tier,
      COALESCE(fps.train_target, CASE WHEN fps.tier = 'critical' THEN 3 ELSE 2 END) AS target,
      LEAST(COALESCE(fps.train_target, CASE WHEN fps.tier = 'critical' THEN 3 ELSE 2 END), COALESCE(c.done, 0)) AS done,
      (CASE fps.tier WHEN 'critical' THEN 0 WHEN 'important' THEN 1 WHEN 'supporting' THEN 2 ELSE 99 END) AS tier_order
    FROM fps
    LEFT JOIN counts c ON c.focus_point_id = fps.id
  )
  SELECT
    COALESCE(jsonb_agg(
      jsonb_build_object('focusPointId', id, 'name', name, 'tier', tier, 'target', target, 'done', done)
      ORDER BY tier_order, id
    ), '[]'::jsonb),
    COALESCE(sum(target), 0),
    COALESCE(sum(done), 0)
    INTO v_focuses, v_target_sum, v_done_sum
  FROM rows;

  IF v_focuses IS NULL OR jsonb_array_length(v_focuses) = 0 THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'lastClassDate',    v_last.created_at,
    'focuses',          v_focuses,
    'percent',          CASE WHEN v_target_sum > 0 THEN round((v_done_sum::numeric / v_target_sum) * 100)::int ELSE 0 END,
    'minutesRemaining', GREATEST(0, v_target_sum - v_done_sum) * 7
  );
END;
$function$
;
