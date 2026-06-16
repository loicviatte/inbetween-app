-- ============================================================
-- Fix: the Profile readiness card always anchored on the most-recent private of
-- ANY style because get_student_profile hardcoded get_lesson_readiness(p_user,
-- NULL). For a 2-style dancer that means Latin focuses never show — and a recent
-- ballroom private "wins" the anchor even when the dancer is on Latin.
--
-- Add an optional p_category so the client can pass the active Latin/Ballroom
-- style (Profile mirrors Train's last-selected toggle). Body is identical to
-- 20260612d except the two readiness calls now thread p_category.
-- ============================================================

DROP FUNCTION IF EXISTS public.get_student_profile(uuid);

CREATE OR REPLACE FUNCTION public.get_student_profile(p_user uuid, p_category text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  latin       text[] := ARRAY['Cha Cha','Samba','Rumba','Paso Doble','Jive'];
  v_couple_id uuid;
  v_style     text;
  v_default_cat text;
BEGIN
  SELECT couple_id, dance_style INTO v_couple_id, v_style FROM users WHERE id = p_user;
  v_default_cat := CASE lower(coalesce(v_style, ''))
                     WHEN 'latin' THEN 'latin'
                     WHEN 'ballroom' THEN 'ballroom'
                     WHEN 'standard' THEN 'ballroom'
                     ELSE NULL END;

  RETURN jsonb_build_object(
    'user', (
      SELECT to_jsonb(u) || jsonb_build_object(
        'studio', (SELECT jsonb_build_object('id', s.id, 'name', s.name) FROM studios s WHERE s.id = u.studio_id)
      )
      FROM users u WHERE u.id = p_user
    ),

    'coachDefault',  CASE WHEN v_default_cat IS NULL THEN NULL ELSE public._student_coach(p_user, v_default_cat) END,
    'coachLatin',    public._student_coach(p_user, 'latin'),
    'coachBallroom', public._student_coach(p_user, 'ballroom'),

    'couple', (
      SELECT jsonb_build_object(
        'coupleId', c.id,
        'partner', jsonb_build_object(
          'id', pu.id,
          'name', coalesce(pu.name, 'Partner'),
          'avatarUrl', pu.avatar_url
        ),
        'leaderUserId', c.leader_user_id,
        'iAmLeader', (c.leader_user_id = p_user),
        'doesLatin', c.does_latin,
        'doesBallroom', c.does_ballroom,
        'latinCoupleCoachId', c.latin_couple_coach_id,
        'ballroomCoupleCoachId', c.ballroom_couple_coach_id,
        'latinCoupleCoach', CASE WHEN c.latin_couple_coach_id IS NULL THEN NULL
          ELSE jsonb_build_object('id', c.latin_couple_coach_id, 'name', (SELECT name FROM users WHERE id = c.latin_couple_coach_id)) END,
        'ballroomCoupleCoach', CASE WHEN c.ballroom_couple_coach_id IS NULL THEN NULL
          ELSE jsonb_build_object('id', c.ballroom_couple_coach_id, 'name', (SELECT name FROM users WHERE id = c.ballroom_couple_coach_id)) END,
        'pendingChange', c.pending_change,
        'pendingChangeBy', c.pending_change_by,
        'pendingChangeMine', (c.pending_change IS NOT NULL AND c.pending_change_by = p_user),
        'createdAt', c.created_at
      )
      FROM couples c
      LEFT JOIN users pu ON pu.id = (CASE WHEN c.user_a_id = p_user THEN c.user_b_id ELSE c.user_a_id END)
      WHERE c.id = v_couple_id AND c.unpaired_at IS NULL
      LIMIT 1
    ),

    'incomingRequest', (
      SELECT jsonb_build_object(
        'id', r.id, 'requesterId', r.requester_id,
        'requesterName', coalesce(ru.name, 'A dancer'), 'requesterAvatar', ru.avatar_url,
        'status', r.status,
        'proposedDoesLatin', r.proposed_does_latin, 'proposedDoesBallroom', r.proposed_does_ballroom,
        'proposedLeaderId', r.proposed_leader_id, 'createdAt', r.created_at
      )
      FROM couple_requests r LEFT JOIN users ru ON ru.id = r.requester_id
      WHERE r.target_id = p_user AND r.status IN ('pending', 'awaiting_validation')
      ORDER BY r.created_at DESC LIMIT 1
    ),

    'outgoingRequest', (
      SELECT jsonb_build_object(
        'id', r.id, 'targetId', r.target_id,
        'targetName', coalesce(tu.name, 'A dancer'), 'targetAvatar', tu.avatar_url,
        'status', r.status,
        'proposedDoesLatin', r.proposed_does_latin, 'proposedDoesBallroom', r.proposed_does_ballroom,
        'proposedLeaderId', r.proposed_leader_id, 'createdAt', r.created_at
      )
      FROM couple_requests r LEFT JOIN users tu ON tu.id = r.target_id
      WHERE r.requester_id = p_user AND r.status IN ('pending', 'awaiting_validation')
      ORDER BY r.created_at DESC LIMIT 1
    ),

    'inviteCode', (SELECT invite_code FROM users WHERE id = p_user),

    'readiness',       public.get_lesson_readiness(p_user, p_category),
    'coupleReadiness', CASE WHEN v_couple_id IS NULL THEN NULL ELSE public.get_couple_readiness(v_couple_id, p_category) END,

    'coachQuestions', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', id, 'message', message, 'reply', reply, 'status', status, 'created_at', created_at
      ) ORDER BY created_at DESC), '[]'::jsonb)
      FROM coach_messages
      WHERE student_id = p_user AND status IN ('pending', 'dismissed', 'replied')
    ),

    'focusPoints', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('category', category)), '[]'::jsonb)
      FROM focus_points
      WHERE user_id = p_user AND is_deleted = false AND is_archived = false
        AND status = 'active' AND is_other = false
    ),

    'classInputsCount', (
      SELECT count(*) FROM class_inputs WHERE is_deleted IS NOT TRUE
    ),

    'totalSessions', (
      SELECT count(*) FROM practice_logs WHERE student_id = p_user AND completed_at IS NOT NULL
    ),

    'activityStats', (
      WITH logs AS (
        SELECT started_at, duration_minutes
        FROM practice_logs WHERE student_id = p_user AND completed_at IS NOT NULL
      ),
      days AS (
        SELECT DISTINCT started_at::date AS d FROM logs
      ),
      islands AS (
        SELECT d, (d - (row_number() OVER (ORDER BY d))::int) AS grp FROM days
      ),
      runs AS (
        SELECT count(*) AS len FROM islands GROUP BY grp
      )
      SELECT jsonb_build_object(
        'bestStreakDays', coalesce((SELECT max(len) FROM runs), 0),
        'monthMinutes', coalesce((SELECT sum(duration_minutes) FROM logs WHERE started_at >= date_trunc('month', now())), 0)
      )
    )
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_student_profile(uuid, text) TO authenticated;

-- Rollback: restore the single-arg version from 20260612d_student_profile_bundle.sql
-- (DROP FUNCTION public.get_student_profile(uuid, text); then re-run that migration).
