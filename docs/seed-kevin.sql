-- ============================================================================
-- SEED : données de démo pour l'élève Kevin Viatte
-- À lancer dans Supabase → SQL Editor (s'exécute en service_role, ignore RLS).
--
-- AVANT DE LANCER : remplace l'email de Kevin ligne ci-dessous par le vrai
-- email du compte élève auquel tu es connecté sur la tablette.
--
-- Ce script est idempotent-friendly : relançable sans dupliquer David (il est
-- retrouvé par email), mais il RE-crée les cours/focus points à chaque run.
-- ============================================================================

DO $$
DECLARE
  kevin_email TEXT := 'REMPLACER_PAR_EMAIL_DE_KEVIN';  -- ← ⚠️ à éditer
  david_email TEXT := 'david.yates.coach@inbetween.demo';
  kev   UUID;
  david UUID;
  c1 UUID; c2 UUID; c3 UUID;
BEGIN
  ------------------------------------------------------------------------------
  -- 1. Retrouver Kevin
  ------------------------------------------------------------------------------
  SELECT id INTO kev FROM public.users WHERE lower(email) = lower(kevin_email);
  IF kev IS NULL THEN
    RAISE EXCEPTION 'Élève introuvable pour %, corrige kevin_email', kevin_email;
  END IF;

  -- Style « Latin & Ballroom » → fait apparaître le toggle Latin/Ballroom
  UPDATE public.users SET dance_style = 'Latin & Ballroom' WHERE id = kev;

  -- Nettoyage des lignes de démo précédentes (ciblé par nom/titre) pour que le
  -- script soit relançable sans doublonner.
  DELETE FROM public.focus_points
   WHERE user_id = kev
     AND normalized_name IN ('rise and fall','level frame','staccato footwork','standing leg drive','hip timing');
  DELETE FROM public.class_inputs
   WHERE user_id = kev
     AND title IN ('Ballroom — Waltz','Ballroom — Tango','Latin — Rumba');

  ------------------------------------------------------------------------------
  -- 2. Cours (class_inputs). status 'scored' = cours traité (pas "en analyse").
  ------------------------------------------------------------------------------
  INSERT INTO public.class_inputs
    (user_id, title, dance, teacher_name, lesson_type, status,
     practice_point_1, priority_score_1, practice_point_2, priority_score_2,
     is_deleted, created_at)
  VALUES
    (kev, 'Ballroom — Waltz', 'Waltz', 'David Yates', 'private', 'scored',
     'Sustain the rise and fall through the whole figure', 4,
     'Keep the frame level and quiet in turns', 3,
     false, now() - interval '7 days')
  RETURNING id INTO c1;

  INSERT INTO public.class_inputs
    (user_id, title, dance, teacher_name, lesson_type, status,
     practice_point_1, priority_score_1, practice_point_2, priority_score_2,
     is_deleted, created_at)
  VALUES
    (kev, 'Ballroom — Tango', 'Tango', 'David Yates', 'private', 'scored',
     'Sharper foot placement on the staccato actions', 5,
     'Drive from the standing leg into the walks', 3,
     false, now() - interval '3 days')
  RETURNING id INTO c2;

  INSERT INTO public.class_inputs
    (user_id, title, dance, teacher_name, lesson_type, status,
     practice_point_1, priority_score_1, practice_point_2, priority_score_2,
     is_deleted, created_at)
  VALUES
    (kev, 'Latin — Rumba', 'Rumba', 'Anna Lopez', 'private', 'scored',
     'Delay the hip settle to the end of the beat', 4,
     'Keep the connection through the hand tone', 2,
     false, now() - interval '1 days')
  RETURNING id INTO c3;

  ------------------------------------------------------------------------------
  -- 3. Focus points (liés aux cours). category ∈ Stability/Technicality/
  --    Strength/Creativity/Musicality. status 'active' = visible à l'élève.
  ------------------------------------------------------------------------------
  -- dance = text[] : catégorise Latin/Ballroom (Rumba→Latin, Waltz/Tango→Ballroom).
  -- tier ∈ critical/important/supporting. subtitle = accroche courte, context =
  -- explication du coach.
  INSERT INTO public.focus_points
    (user_id, name, normalized_name, category, count, status, is_deleted,
     class_input_id, created_at, subtitle, context, dance, tier)
  VALUES
    (kev, 'Rise and fall', 'rise and fall', 'Technicality', 3, 'active', false, c1, now() - interval '7 days',
     'Lengthen the up, control the down',
     'Your rise starts too late and collapses early. Stretch the body upward through the middle of the figure and lower with control on the last beat.',
     ARRAY['Waltz'], 'important'),
    (kev, 'Level frame', 'level frame', 'Stability', 2, 'active', false, c1, now() - interval '7 days',
     'Keep the top line quiet through turns',
     'The frame lifts and drops as you rotate. Hold a steady, level topline so the turn travels from the feet, not the shoulders.',
     ARRAY['Waltz'], 'critical'),
    (kev, 'Staccato footwork', 'staccato footwork', 'Technicality', 2, 'active', false, c2, now() - interval '3 days',
     'Sharpen the placement, not the speed',
     'Tango steps are landing flat. Place the foot with a clear, deliberate action into the floor to get the staccato character.',
     ARRAY['Tango'], 'important'),
    (kev, 'Standing-leg drive', 'standing leg drive', 'Strength', 1, 'active', false, c2, now() - interval '3 days',
     'Push the walks from the supporting leg',
     'Momentum is coming from the moving leg reaching. Drive from the standing leg so the walks have weight and intention.',
     ARRAY['Tango'], 'supporting'),
    (kev, 'Hip timing', 'hip timing', 'Musicality', 2, 'active', false, c3, now() - interval '1 days',
     'Settle the hip at the end of the beat',
     'The hip action arrives early and rushes. Delay the settle to the very end of the beat to get the slow, grounded Rumba quality.',
     ARRAY['Rumba'], 'important');

  ------------------------------------------------------------------------------
  -- 4. Coach David Yates + liaison en Ballroom (le toggle)
  ------------------------------------------------------------------------------
  SELECT id INTO david FROM public.users WHERE lower(email) = lower(david_email);

  IF david IS NULL THEN
    -- Créer l'utilisateur auth ; le trigger handle_new_user crée la ligne
    -- public.users (name + role lus depuis raw_user_meta_data).
    david := gen_random_uuid();
    INSERT INTO auth.users
      (instance_id, id, aud, role, email, encrypted_password,
       email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
       created_at, updated_at)
    VALUES
      ('00000000-0000-0000-0000-000000000000', david, 'authenticated',
       'authenticated', david_email, crypt('DemoPassw0rd!', gen_salt('bf')),
       now(), '{"provider":"email","providers":["email"]}',
       '{"name":"David Yates","role":"coach"}', now(), now());
  END IF;

  -- Garantir name/role même si l'utilisateur existait déjà
  UPDATE public.users SET name = 'David Yates', role = 'coach' WHERE id = david;

  -- Lier David comme coach Ballroom de Kevin
  UPDATE public.users SET ballroom_coach_id = david WHERE id = kev;

  RAISE NOTICE 'OK — Kevin=% David=% (3 cours, 5 focus points, ballroom lié)', kev, david;
END $$;
