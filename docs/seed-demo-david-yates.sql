-- Demo content for the presentation account (David Yates / viatteloic@gmail.com).
-- The eight demo students live on @demo.useinbetween.com and were created through the
-- auth admin API (no password, no email sent). Re-runnable: each part wipes what it wrote.

-- Demo content for the presentation account (David Yates, viatteloic@gmail.com).
-- Students live on @demo.useinbetween.com and were created through the auth admin API.
-- Re-runnable: it wipes the demo students' content before writing it again.
do $seed$
declare
  coach uuid; studio uuid; sid uuid; cid uuid; fid uuid; prev_fid uuid;
  s jsonb; l jsonb; f jsonb; k int; ts timestamptz;
  spec jsonb := $j$
[
 {"email":"emma.hartley@demo.useinbetween.com","name":"Emma Hartley","style":"Latin","idle":1,
  "lessons":[
   {"days":24,"title":"Rumba — walks and hip settle","dance":"Rumba","summary":"Worked the slow rumba walks with the weight arriving before the hip. Emma tends to rush the settle, so most of the hour was spent on one bar at a time.","pp1":"Let the hip finish before the next step","pp2":"Keep the ribs quiet over the standing leg",
    "fps":[{"name":"Hip settle","subtitle":"Let the hip finish arriving before the next step starts.","context":"In the walks the next step begins while the hip is still travelling, so nothing lands.","drill":"Four slow walks, one bar each, holding the arrival.","tier":"important","dance":["Rumba"],"status":"past","done":2},
           {"name":"Quiet ribs","subtitle":"Keep the ribcage still over the standing leg.","context":"The ribs lift on every transfer, which pulls the shape up.","drill":"Walks with a hand on the ribs, checking they stay level.","tier":"supporting","dance":["Rumba"],"status":"past","done":2}]},
   {"days":5,"title":"Cha Cha — lock steps and the check","dance":"Cha Cha","summary":"Cha cha basics into the check and New York. The lock is arriving flat, so we broke it down to the ball of the foot and the knee. Good energy, strong second half.","pp1":"Arrive on the ball of the foot in the lock","pp2":"Straighten the supporting knee on the check",
    "fps":[{"name":"Ball of the foot","subtitle":"Arrive on the ball in every lock, then let the heel lower.","context":"The lock lands flat, so the speed of the cha cha cha disappears.","drill":"Lock steps in place, eight of them, no music, checking each arrival.","tier":"critical","dance":["Cha Cha"],"status":"active","done":2},
           {"name":"Straight support","subtitle":"The supporting knee straightens as you check.","context":"A soft knee on the check swallows the shape and the timing.","drill":"Checks on the spot, holding the straight leg for two counts.","tier":"important","dance":["Cha Cha"],"status":"active","done":2},
           {"name":"Arm line","subtitle":"Let the free arm finish where the body finishes.","context":"The arm keeps travelling after the body has stopped.","drill":"New York with the arm stopping on the beat.","tier":"supporting","dance":["Cha Cha"],"status":"active","done":1}]}]},

 {"email":"daniel.okafor@demo.useinbetween.com","name":"Daniel Okafor","style":"Ballroom","idle":9,
  "lessons":[
   {"days":21,"title":"Waltz — rise and fall","dance":"Waltz","summary":"Natural turn into the closed change. The rise is starting too early, which flattens the swing.","pp1":"Rise at the end of one, not on it","pp2":"Keep the left side lengthened in the turn",
    "fps":[{"name":"Late rise","subtitle":"Rise at the end of the first step, not on it.","context":"Rising on one kills the swing and shortens the second step.","drill":"Three natural turns, counting the rise out loud on the and.","tier":"important","dance":["Waltz"],"status":"past","done":1}]},
   {"days":6,"title":"Quickstep — lock step timing","dance":"Quickstep","summary":"Quickstep basics: the lock is late and the body arrives after the feet. We slowed everything to half tempo and rebuilt the timing.","pp1":"Body and feet arrive together","pp2":"Hold the frame through the lock",
    "fps":[{"name":"Body with the feet","subtitle":"The body arrives with the foot, not after it.","context":"At speed the feet run ahead and the body catches up late.","drill":"Lock steps at half tempo, stopping on each arrival.","tier":"critical","dance":["Quickstep"],"status":"active","done":0},
           {"name":"Frame through the lock","subtitle":"Keep the left elbow from collapsing as you cross.","context":"The frame folds on every lock, so the partner loses the line.","drill":"Lock steps against a wall, elbow staying in contact.","tier":"important","dance":["Quickstep"],"status":"active","done":0}]}]},

 {"email":"sofia.ricci@demo.useinbetween.com","name":"Sofia Ricci","style":"Latin & Ballroom","idle":3,
  "lessons":[
   {"days":18,"title":"Samba — bounce action","dance":"Samba","summary":"Samba whisks and the bounce. The bounce is coming from the knees only, so we worked it from the ankle up.","pp1":"Bounce from the ankle, not the knee","pp2":"Keep the head level through the whisk",
    "fps":[{"name":"Ankle bounce","subtitle":"The bounce starts at the ankle and travels up.","context":"Knee-only bounce makes the samba look heavy.","drill":"Whisks in place, hands on hips, feeling the ankle drive.","tier":"important","dance":["Samba"],"status":"past","done":2}]},
   {"days":4,"title":"Tango — staccato head","dance":"Tango","summary":"Tango walks and the promenade. Sofia is turning the head early, which breaks the shape before the step lands.","pp1":"Turn the head after the step arrives","pp2":"Keep the knees soft through the walk",
    "fps":[{"name":"Head after the step","subtitle":"The head turns once the foot has arrived.","context":"An early head turn drags the shape and loses the tango attack.","drill":"Promenade walks, holding the head still until the arrival.","tier":"critical","dance":["Tango"],"status":"active","done":1},
           {"name":"Soft knees","subtitle":"Keep the knees bent through the whole walk.","context":"The knees straighten mid-walk, so the body rises when it should stay down.","drill":"Four tango walks in front of a mirror, checking the height stays level.","tier":"important","dance":["Tango"],"status":"active","done":1}]}]},

 {"email":"lucas.brandt@demo.useinbetween.com","name":"Lucas Brandt","style":"Latin","idle":0,
  "lessons":[
   {"days":2,"title":"Jive — kicks and flicks","dance":"Jive","summary":"First lesson on jive basics. Good rhythm, but the kicks are travelling instead of staying under the body.","pp1":"Keep the kick under the body","pp2":"Land the chasse on the ball of the foot",
    "fps":[{"name":"Kick under the body","subtitle":"The kick stays underneath, not out in front.","context":"Kicking forward pulls the weight back and slows the chasse.","drill":"Kick ball change in place, eight times, knees together.","tier":"critical","dance":["Jive"],"status":"active","done":1},
           {"name":"Ball of the foot","subtitle":"Land every chasse on the ball first.","context":"Flat landings kill the bounce of the jive.","drill":"Chasses along a wall, listening for a quiet landing.","tier":"important","dance":["Jive"],"status":"active","done":0}]}]},

 {"email":"priya.raman@demo.useinbetween.com","name":"Priya Raman","style":"Ballroom","idle":2,
  "lessons":[
   {"days":30,"title":"Foxtrot — the feather","dance":"Foxtrot","summary":"Feather step into the three step. Long, quiet work on the swing.","pp1":"Let the swing finish before the next step","pp2":"Keep the head weight back",
    "fps":[{"name":"Finish the swing","subtitle":"Let the swing complete before the next step begins.","context":"Cutting the swing short makes the foxtrot look busy.","drill":"Feather steps, one at a time, holding each arrival.","tier":"important","dance":["Foxtrot"],"status":"past","done":2}]},
   {"days":7,"title":"Waltz — outside partner","dance":"Waltz","summary":"Outside partner position and the shape. Excellent session, most of the corrections held by the end.","pp1":"Keep the shape without breaking the frame","pp2":"Arrive outside partner with the body, not the arm",
    "fps":[{"name":"Shape without the arm","subtitle":"The shape comes from the body, the arm only follows.","context":"The arm leads the shape, which twists the frame.","drill":"Outside partner steps with the arms down.","tier":"important","dance":["Waltz"],"status":"active","done":2},
           {"name":"Arrive with the body","subtitle":"The body travels to the outside partner position.","context":"Arriving with the foot first leaves the body behind.","drill":"Three outside partner arrivals, checking the ribcage position.","tier":"critical","dance":["Waltz"],"status":"active","done":3}]}]},

 {"email":"tom.whitfield@demo.useinbetween.com","name":"Tom Whitfield","style":"Latin","idle":12,
  "lessons":[
   {"days":9,"title":"Paso Doble — shaping","dance":"Paso Doble","summary":"Paso shapes and the appel. The shape is coming from the shoulders, so we spent the hour rebuilding it from the floor.","pp1":"Shape from the floor, not the shoulders","pp2":"Sharpen the appel",
    "fps":[{"name":"Shape from the floor","subtitle":"The shape starts in the standing leg, not in the shoulders.","context":"Shoulder-led shapes look forced and lose the paso line.","drill":"Hold the shape for four counts, checking the standing leg first.","tier":"critical","dance":["Paso Doble"],"status":"active","done":0},
           {"name":"Sharp appel","subtitle":"The appel lands flat and loud, in one beat.","context":"A soft appel gives no start to the phrase.","drill":"Ten appels, on the spot, on the beat.","tier":"important","dance":["Paso Doble"],"status":"active","done":0}]}]},

 {"email":"chloe.fontaine@demo.useinbetween.com","name":"Chloé Fontaine","style":"Latin & Ballroom","idle":4,
  "lessons":[
   {"days":11,"title":"Cha Cha — turns and spins","dance":"Cha Cha","summary":"Turns out of the open basic. Chloé is spotting late, so the exits drift.","pp1":"Spot earlier in the turn","pp2":"Finish the turn on a straight leg",
    "fps":[{"name":"Early spot","subtitle":"Find the spot before the turn finishes.","context":"Late spotting pulls the exit off line.","drill":"Four spot turns, each one stopping on the spot.","tier":"important","dance":["Cha Cha"],"status":"active","done":1},
           {"name":"Straight exit","subtitle":"The turn ends on a straight supporting leg.","context":"A bent exit leaves the weight between the feet.","drill":"Turn, stop, check the leg, repeat.","tier":"supporting","dance":["Cha Cha"],"status":"active","done":1}]}]},

 {"email":"nina.farrow@demo.useinbetween.com","name":"Nina Farrow","style":"Ballroom","idle":6,
  "lessons":[
   {"days":15,"title":"Foxtrot — heel leads","dance":"Foxtrot","summary":"Heel leads through the feather and three step. The heel is arriving after the weight, so the swing stalls.","pp1":"Arrive through the heel","pp2":"Keep the shoulders level in the swing",
    "fps":[{"name":"Heel leads","subtitle":"Arrive through the heel on every forward walk.","context":"Landing flat stops the swing before it starts.","drill":"Six forward walks, heel first, no music.","tier":"important","dance":["Foxtrot"],"status":"active","done":1},
           {"name":"Level shoulders","subtitle":"Keep the shoulders level through the swing.","context":"The right shoulder drops on every swing, which tilts the frame.","drill":"Three step with a hand on each shoulder, checking the line.","tier":"supporting","dance":["Foxtrot"],"status":"active","done":1}]}]}
]
$j$::jsonb;
begin
  select id, studio_id into coach, studio from users where lower(email) = 'viatteloic@gmail.com';
  update users set name = 'David Yates' where id = coach;

  -- ── the eight demo students, their lessons, focus points and practice ──
  for s in select * from jsonb_array_elements(spec) loop
    select id into sid from users where lower(email) = lower(s->>'email');
    if sid is null then raise exception 'missing demo account %', s->>'email'; end if;

    update users set
      name = s->>'name', role = 'student', dance_style = s->>'style', studio_id = studio,
      latin_coach_id    = case when s->>'style' in ('Latin','Latin & Ballroom') then coach end,
      ballroom_coach_id = case when s->>'style' in ('Ballroom','Latin & Ballroom') then coach end,
      last_active_date = (current_date - ((s->>'idle')::int)),
      weekly_goal_minutes = 60
    where id = sid;

    delete from practice_logs where student_id = sid;
    delete from coach_messages where student_id = sid;
    delete from focus_points where user_id = sid;
    delete from class_inputs where student_id = sid;

    for l in select * from jsonb_array_elements(s->'lessons') loop
      insert into class_inputs (user_id, student_id, title, dance, teacher_name, lesson_type, status,
        class_summary, practice_point_1, priority_score_1, practice_point_2, priority_score_2,
        admin_approved_at, is_deleted, created_at, processed_at)
      values (coach, sid, l->>'title', l->>'dance', 'David Yates', 'private', 'scored',
        l->>'summary', l->>'pp1', 4, l->>'pp2', 3,
        now() - make_interval(days => (l->>'days')::int) + interval '3 hours', false,
        now() - make_interval(days => (l->>'days')::int),
        now() - make_interval(days => (l->>'days')::int) + interval '1 hour')
      returning id into cid;

      for f in select * from jsonb_array_elements(l->'fps') loop
        insert into focus_points (user_id, name, normalized_name, subtitle, context, drill, tier, train_target,
          dance, status, base_score, mention_count, count, practice_count, class_input_id, source_class_input_id,
          is_other, is_deleted, is_archived, group_fp, created_at, last_mentioned_at)
        values (sid, f->>'name', lower(f->>'name'), f->>'subtitle', f->>'context', f->>'drill',
          f->>'tier', case when f->>'tier' = 'critical' then 3 else 2 end,
          array(select jsonb_array_elements_text(f->'dance')), f->>'status', 5, 2, 1,
          coalesce((f->>'done')::int, 0) * 2, cid, cid, false, false, false, false,
          now() - make_interval(days => (l->>'days')::int) + interval '2 hours',
          now() - make_interval(days => (l->>'days')::int))
        returning id into fid;

        for k in 1..coalesce((f->>'done')::int, 0) loop
          ts := now() - make_interval(days => greatest((l->>'days')::int - k, 0)) + interval '18 hours';
          insert into practice_logs (student_id, focus_point_id, duration_minutes, rating, feeling,
            started_at, completed_at, created_at)
          values (sid, fid, 5 + k, 'okay', 'Okay', ts, ts + interval '6 minutes', ts);
        end loop;
      end loop;
    end loop;
  end loop;
end
$seed$;
-- Demo content, part 2: group lessons, a couple, questions, and what waits for the coach.
do $seed$
declare
  coach uuid; studio uuid; gid uuid; sh uuid; cpl uuid; cfp uuid;
  emma uuid; daniel uuid; sofia uuid; lucas uuid; priya uuid; tom uuid; chloe uuid; nina uuid; jean uuid;
  sid uuid; heel uuid; newfp uuid; ts timestamptz;
begin
  select id, studio_id into coach, studio from users where lower(email) = 'viatteloic@gmail.com';
  select id into emma   from users where email = 'emma.hartley@demo.useinbetween.com';
  select id into daniel from users where email = 'daniel.okafor@demo.useinbetween.com';
  select id into sofia  from users where email = 'sofia.ricci@demo.useinbetween.com';
  select id into lucas  from users where email = 'lucas.brandt@demo.useinbetween.com';
  select id into priya  from users where email = 'priya.raman@demo.useinbetween.com';
  select id into tom    from users where email = 'tom.whitfield@demo.useinbetween.com';
  select id into chloe  from users where email = 'chloe.fontaine@demo.useinbetween.com';
  select id into nina   from users where email = 'nina.farrow@demo.useinbetween.com';
  select id into jean   from users where email = 'loic@useinbetween.com';

  -- re-runnable: drop what this script writes
  delete from class_inputs where user_id = coach and title in
    ('Latin group — Rumba & Cha Cha','Ballroom group — Waltz & Quickstep','Couple — Cha Cha routine',
     'Foxtrot — heel timing','Paso Doble — the attack','Rumba — connection and lead');
  delete from couple_focus_points where couple_id in
    (select id from couples where (user_a_id = chloe and user_b_id = lucas) or (user_a_id = lucas and user_b_id = chloe));
  delete from couples where (user_a_id = chloe and user_b_id = lucas) or (user_a_id = lucas and user_b_id = chloe);
  delete from coach_messages where student_id = jean;
  delete from focus_points where user_id = jean and normalized_name in ('lead from the body','settle before the step');

  -- ── group lesson 1: Latin, eight days ago ───────────────────────────────
  insert into class_inputs (user_id, title, dance, teacher_name, lesson_type, status, class_summary,
    admin_approved_at, is_deleted, created_at, processed_at)
  values (coach, 'Latin group — Rumba & Cha Cha', 'Rumba', 'David Yates', 'group', 'scored',
    'Group class on the rumba walk and the cha cha lock. Most of the room is arriving flat, so the hour was spent on the ball of the foot and the settle of the hip.',
    now() - interval '8 days' + interval '3 hours', false, now() - interval '8 days', now() - interval '8 days' + interval '1 hour')
  returning id into gid;

  sh := gen_random_uuid();
  foreach sid in array array[emma, tom, sofia, chloe, lucas] loop
    insert into class_input_students (class_input_id, student_id, attendance) values (gid, sid, 'pending');
    insert into attendance_responses (class_input_id, student_id, attended, responded_at)
      values (gid, sid, true, now() - interval '8 days' + interval '4 hours');
    insert into focus_points (user_id, name, normalized_name, subtitle, context, drill, tier, train_target, dance,
      status, base_score, mention_count, count, practice_count, class_input_id, source_class_input_id,
      group_fp, shared_group_id, is_other, is_deleted, is_archived, created_at, last_mentioned_at)
    values (sid, 'Weight over the standing foot', 'weight over the standing foot',
      'Arrive with the body over the foot before the hip moves.',
      'The whole room steps first and moves the body after, so nothing settles.',
      'Rumba walks along the wall, stopping on each arrival.', 'important', 2, array['Rumba'],
      'active', 5, 2, 1, 0, gid, gid, true, sh, false, false, false,
      now() - interval '8 days' + interval '2 hours', now() - interval '8 days');
  end loop;

  -- ── group lesson 2: Ballroom, three days ago — one shared point still to validate ──
  insert into class_inputs (user_id, title, dance, teacher_name, lesson_type, status, class_summary,
    admin_approved_at, is_deleted, created_at, processed_at)
  values (coach, 'Ballroom group — Waltz & Quickstep', 'Waltz', 'David Yates', 'group', 'scored',
    'Waltz rise and fall, then quickstep locks. The group is rising early in the waltz and running ahead of the body in the quickstep.',
    now() - interval '3 days' + interval '3 hours', false, now() - interval '3 days', now() - interval '3 days' + interval '1 hour')
  returning id into gid;

  sh := gen_random_uuid();
  foreach sid in array array[daniel, priya, nina, sofia] loop
    insert into class_input_students (class_input_id, student_id, attendance) values (gid, sid, 'pending');
    insert into attendance_responses (class_input_id, student_id, attended, responded_at)
      values (gid, sid, true, now() - interval '3 days' + interval '4 hours');
    insert into focus_points (user_id, name, normalized_name, subtitle, context, drill, tier, train_target, dance,
      status, coach_review_deadline, base_score, mention_count, count, practice_count, class_input_id, source_class_input_id,
      group_fp, shared_group_id, is_other, is_deleted, is_archived, created_at, last_mentioned_at)
    values (sid, 'Rise at the end of one', 'rise at the end of one',
      'The rise happens at the end of the first step, never on it.',
      'Rising on one flattens the swing for the whole group.',
      'Natural turns counting the rise out loud on the and.', 'important', 2, array['Waltz'],
      'pending_coach', now() + interval '11 hours', 5, 2, 1, 0, gid, gid, true, sh, false, false, false,
      now() - interval '3 days' + interval '2 hours', now() - interval '3 days');
  end loop;

  -- ── a couple: Chloé & Lucas ─────────────────────────────────────────────
  insert into couples (user_a_id, user_b_id, leader_user_id, does_latin, does_ballroom, latin_couple_coach_id, created_at)
  values (chloe, lucas, lucas, true, false, coach, now() - interval '40 days')
  returning id into cpl;
  update users set couple_id = cpl where id in (chloe, lucas);

  insert into class_inputs (user_id, title, dance, teacher_name, lesson_type, status, couple_id, class_summary,
    admin_approved_at, is_deleted, created_at, processed_at)
  values (coach, 'Couple — Cha Cha routine', 'Cha Cha', 'David Yates', 'couple', 'scored', cpl,
    'First run of the cha cha routine together. The shapes are there, the timing between them is not: Lucas arrives early on the checks and Chloé waits for him.',
    now() - interval '6 days' + interval '3 hours', false, now() - interval '6 days', now() - interval '6 days' + interval '1 hour')
  returning id into gid;

  insert into couple_focus_points (couple_id, name, normalized_name, subtitle, context, drill, tier, train_target,
    dance, status, base_score, mention_count, class_input_id, source_class_input_id, is_other, is_deleted, created_at, last_mentioned_at)
  values (cpl, 'Shared timing', 'shared timing', 'Arrive on the same beat, both of you.',
    'Lucas checks early, Chloé waits — so every check lands twice.',
    'Eight checks facing each other, counting out loud.', 'critical', 3, array['Cha Cha'], 'active', 5, 2,
    gid, gid, false, false, now() - interval '6 days' + interval '2 hours', now() - interval '6 days')
  returning id into cfp;

  insert into couple_focus_points (couple_id, name, normalized_name, subtitle, context, drill, tier, train_target,
    dance, status, base_score, mention_count, class_input_id, source_class_input_id, is_other, is_deleted, created_at, last_mentioned_at)
  values (cpl, 'Connection through the turns', 'connection through the turns', 'Keep the contact light and constant through the spiral.',
    'The hold breaks halfway through the turn, so the exit drifts.',
    'Spiral turns at half speed, one hand only.', 'important', 2, array['Cha Cha'], 'active', 5, 2,
    gid, gid, false, false, now() - interval '6 days' + interval '2 hours', now() - interval '6 days');

  insert into couple_practice_logs (couple_id, couple_focus_point_id, duration_minutes, rating, feeling, started_at, completed_at, created_at)
  values (cpl, cfp, 7, 'good', 'Good', now() - interval '2 days', now() - interval '2 days' + interval '7 minutes', now() - interval '2 days');

  -- ── a private lesson for Jean Michel, so the parent view has something ───
  insert into class_inputs (user_id, student_id, title, dance, teacher_name, lesson_type, status, class_summary,
    practice_point_1, priority_score_1, admin_approved_at, is_deleted, created_at, processed_at)
  values (coach, jean, 'Rumba — connection and lead', 'Rumba', 'David Yates', 'private', 'scored',
    'Rumba basics with the lead coming from the body. Jean is leading with the arm, which the follower cannot read.',
    'Lead from the body, not the arm', 4, now() - interval '5 days' + interval '3 hours', false,
    now() - interval '5 days', now() - interval '5 days' + interval '1 hour')
  returning id into gid;

  insert into focus_points (user_id, name, normalized_name, subtitle, context, drill, tier, train_target, dance,
    status, base_score, mention_count, count, practice_count, class_input_id, source_class_input_id,
    is_other, is_deleted, is_archived, group_fp, created_at, last_mentioned_at)
  values
   (jean, 'Lead from the body', 'lead from the body', 'The lead starts in your body, the arm only carries it.',
    'Arm-only leads arrive too late for the follower to read.',
    'Basic in place, hands on your own ribs, leading with the turn of the body.', 'critical', 3, array['Rumba'],
    'active', 5, 2, 1, 2, gid, gid, false, false, false, false, now() - interval '5 days' + interval '2 hours', now() - interval '5 days'),
   (jean, 'Settle before the step', 'settle before the step', 'Let the weight settle before the next step starts.',
    'The steps run into each other, so the rumba loses its size.',
    'Four walks, one bar each, holding the settle.', 'important', 2, array['Rumba'],
    'active', 5, 2, 1, 0, gid, gid, false, false, false, false, now() - interval '5 days' + interval '2 hours', now() - interval '5 days');
end
$seed$;
-- Demo content, part 3: what waits for the coach, and the students' questions.
do $seed$
declare
  coach uuid; cid uuid; heel uuid; newfp uuid;
  emma uuid; daniel uuid; sofia uuid; tom uuid; nina uuid; jean uuid; lastcls uuid;
begin
  select id into coach  from users where lower(email) = 'viatteloic@gmail.com';
  select id into emma   from users where email = 'emma.hartley@demo.useinbetween.com';
  select id into daniel from users where email = 'daniel.okafor@demo.useinbetween.com';
  select id into sofia  from users where email = 'sofia.ricci@demo.useinbetween.com';
  select id into tom    from users where email = 'tom.whitfield@demo.useinbetween.com';
  select id into nina   from users where email = 'nina.farrow@demo.useinbetween.com';
  select id into jean   from users where email = 'loic@useinbetween.com';

  -- ── Nina: yesterday's lesson, three points waiting for the coach ────────
  insert into class_inputs (user_id, student_id, title, dance, teacher_name, lesson_type, status, class_summary,
    practice_point_1, priority_score_1, practice_point_2, priority_score_2, admin_approved_at, is_deleted, created_at, processed_at)
  values (coach, nina, 'Foxtrot — heel timing', 'Foxtrot', 'David Yates', 'private', 'scored',
    'Back on the heel leads, plus the first work on the reverse turn. The heel is better in the walks and still late in the turn.',
    'Arrive through the heel in the turn too', 4, 'Keep the left side long on the reverse', 3,
    now() - interval '1 day' + interval '3 hours', false, now() - interval '1 day', now() - interval '1 day' + interval '1 hour')
  returning id into cid;

  select id into heel from focus_points where user_id = nina and normalized_name = 'heel leads' and status = 'active';

  insert into focus_points (user_id, name, normalized_name, subtitle, context, drill, tier, train_target, dance,
    status, coach_review_deadline, base_score, mention_count, count, practice_count, class_input_id, source_class_input_id,
    is_other, is_deleted, is_archived, group_fp, created_at, last_mentioned_at, merge_status, merge_candidate_id)
  values (nina, 'Heel lead timing', 'heel lead timing', 'Arrive through the heel in the turn, not only in the walks.',
    'The heel lead holds in a straight line and disappears as soon as she turns.',
    'Reverse turn at half speed, heel first on every forward step.', 'important', 2, array['Foxtrot'],
    'pending_coach', now() + interval '9 hours', 5, 2, 1, 0, cid, cid, false, false, false, false,
    now() - interval '1 day' + interval '2 hours', now() - interval '1 day', 'pending_coach', heel)
  returning id into newfp;

  insert into merge_requests (student_id, focus_a, focus_b, status, created_at)
  values (nina, heel, newfp, 'pending_coach', now() - interval '1 day' + interval '2 hours');

  insert into focus_points (user_id, name, normalized_name, subtitle, context, drill, tier, train_target, dance,
    status, coach_review_deadline, base_score, mention_count, count, practice_count, class_input_id, source_class_input_id,
    is_other, is_deleted, is_archived, group_fp, created_at, last_mentioned_at)
  values
   (nina, 'Long left side', 'long left side', 'Keep the left side lengthened through the reverse turn.',
    'The left side collapses at the start of the turn, so the frame tips.',
    'Reverse turns with a hand under the left arm, keeping the length.', 'critical', 3, array['Foxtrot'],
    'pending_coach', now() + interval '9 hours', 5, 2, 1, 0, cid, cid, false, false, false, false,
    now() - interval '1 day' + interval '2 hours', now() - interval '1 day'),
   (nina, 'Head off the right', 'head off the right', 'Let the head stay left instead of following the turn.',
    'The head goes with the turn, which drops the topline.',
    'Reverse turn, eyes fixed left, four times.', 'supporting', 2, array['Foxtrot'],
    'pending_coach', now() + interval '9 hours', 5, 2, 1, 0, cid, cid, false, false, false, false,
    now() - interval '1 day' + interval '2 hours', now() - interval '1 day');

  -- ── Tom: yesterday's lesson, two points waiting ─────────────────────────
  insert into class_inputs (user_id, student_id, title, dance, teacher_name, lesson_type, status, class_summary,
    practice_point_1, priority_score_1, admin_approved_at, is_deleted, created_at, processed_at)
  values (coach, tom, 'Paso Doble — the attack', 'Paso Doble', 'David Yates', 'private', 'scored',
    'Paso attack and the march. Tom has the shapes but starts everything a beat late, so the phrase never lands on the music.',
    'Start the march on the beat, not after it', 4,
    now() - interval '1 day' + interval '5 hours', false, now() - interval '1 day' + interval '2 hours', now() - interval '1 day' + interval '3 hours')
  returning id into cid;

  insert into focus_points (user_id, name, normalized_name, subtitle, context, drill, tier, train_target, dance,
    status, coach_review_deadline, base_score, mention_count, count, practice_count, class_input_id, source_class_input_id,
    is_other, is_deleted, is_archived, group_fp, created_at, last_mentioned_at)
  values
   (tom, 'On the beat', 'on the beat', 'The march starts on the beat, not a breath after it.',
    'Every phrase starts late, so the ending never matches the music.',
    'Eight marches with a metronome, starting exactly on one.', 'critical', 3, array['Paso Doble'],
    'pending_coach', now() + interval '13 hours', 5, 2, 1, 0, cid, cid, false, false, false, false,
    now() - interval '1 day' + interval '4 hours', now() - interval '1 day'),
   (tom, 'Flat foot in the march', 'flat foot in the march', 'The whole foot lands, heel and all.',
    'Landing on the ball makes the march light, which paso cannot carry.',
    'Marches on the spot, listening for the sound of the floor.', 'important', 2, array['Paso Doble'],
    'pending_coach', now() + interval '13 hours', 5, 2, 1, 0, cid, cid, false, false, false, false,
    now() - interval '1 day' + interval '4 hours', now() - interval '1 day');

  -- ── questions from the students ─────────────────────────────────────────
  select id into lastcls from class_inputs where student_id = daniel order by created_at desc limit 1;

  insert into coach_messages (coach_id, student_id, message, reply, status, created_at, replied_at, covered_class_input_id)
  values
   (coach, tom,  'How hard should the appel actually be? Mine sounds nothing like yours. [Focus: Sharp appel]', null, 'pending', now() - interval '2 days', null, null),
   (coach, emma, 'Is it normal that my calves burn after the cha cha locks? [Focus: Ball of the foot]', null, 'pending', now() - interval '20 hours', null, null),
   (coach, nina, 'Should I practise the heel leads in heels or in flats?', null, 'pending', now() - interval '3 hours', null, null),
   (coach, sofia, 'Can I train the tango head turn without a partner? [Focus: Head after the step]',
    'Yes — do it facing a mirror, and stop the head until you see the foot arrive. Ten of them a day is plenty.', 'replied',
    now() - interval '6 days', now() - interval '5 days', null),
   (coach, tom, 'Is it better to practise paso in shoes or barefoot?',
    'Shoes, always — the sound of the floor is half the exercise.', 'replied',
    now() - interval '8 days', now() - interval '7 days', null),
   (coach, daniel, 'I keep losing the frame on the lock. Any drill for that? [Focus: Frame through the lock]',
    'Covered in your last lesson.', 'replied', now() - interval '9 days', now() - interval '6 days', lastcls),
   (coach, jean, 'How do I know if the lead comes from my body and not my arm? [Focus: Lead from the body]',
    'Put your hands on your own ribs and dance the basic — if the follower still knows where to go, it came from the body.', 'replied',
    now() - interval '4 days', now() - interval '3 days', null),
   (coach, jean, 'Can I train the rumba walks on carpet at home?', null, 'pending', now() - interval '1 day', null, null);
end
$seed$;
-- Demo content, part 4: nine weeks of practice history, so the charts have a life.
-- Every log is dated before that student's last lesson, so readiness is untouched.
do $seed$
declare
  r record; fp uuid; last_lesson timestamptz; ts timestamptz; w int; n int; i int;
  ratings text[] := array['okay','good','great','okay','good'];
  feels   text[] := array['Okay','Good','Great','Okay','Good'];
  pick int;
begin
  for r in select u.id, u.name from users u where u.email like '%@demo.useinbetween.com' loop
    select max(created_at) into last_lesson from class_inputs where student_id = r.id;
    if last_lesson is null then continue; end if;

    -- logs older than this student's last lesson only
    delete from practice_logs p where p.student_id = r.id and p.started_at < last_lesson - interval '12 hours';

    for w in 1..9 loop
      -- a busier dancer trains more weeks than a quiet one
      n := case when r.name in ('Emma Hartley','Priya Raman') then 3
                when r.name in ('Sofia Ricci','Chloé Fontaine','Nina Farrow') then 2
                when r.name = 'Daniel Okafor' then 1
                else (w % 2) end;
      for i in 1..n loop
        ts := date_trunc('week', now()) - make_interval(weeks => w) + make_interval(days => (i * 2), hours => 18);
        if ts >= last_lesson - interval '12 hours' then continue; end if;
        select id into fp from focus_points where user_id = r.id order by created_at limit 1;
        if fp is null then continue; end if;
        pick := 1 + ((w + i) % 5);
        insert into practice_logs (student_id, focus_point_id, duration_minutes, rating, feeling, started_at, completed_at, created_at)
        values (r.id, fp, 5 + ((w + i) % 4), ratings[pick], feels[pick], ts, ts + make_interval(mins => 5 + ((w + i) % 4)), ts);
      end loop;
    end loop;
  end loop;
end
$seed$;

-- ───────────────────────────────────────────────────────────────────────
-- The second style, for the two dancers linked in both
--
-- Chloé and Sofia are each linked to David in Latin AND Ballroom, so they
-- appear under both toggles — but their plans only existed in one, and the
-- other read "—". Readiness anchors on the last PRIVATE lesson carrying a
-- live focus point in that style: Chloé had no Ballroom lesson at all, and
-- Sofia's only Latin focus came from a group lesson, which never anchors.
-- One private lesson each, in the missing style.

with dy as (select id from public.users where email = 'viatteloic@gmail.com'),
     ch as (select id from public.users where email = 'chloe.fontaine@demo.useinbetween.com'),
     so as (select id from public.users where email = 'sofia.ricci@demo.useinbetween.com'),
ins as (
  insert into class_inputs
    (id, user_id, student_id, student_ids, lesson_type, dance, title, class_summary,
     practice_point_1, priority_score_1, practice_point_2, priority_score_2,
     teacher_name, status, created_at, processed_at, admin_approved_at)
  select gen_random_uuid(), dy.id, ch.id, array[ch.id], 'private', 'Waltz',
         'Waltz — rise and fall',
         'Natural turns down the long side. The rise arrives late, so the sway lands after the beat and the second step shortens.',
         'Start the rise on the end of one', 8,
         'Keep the second step as long as the first', 6,
         'David Yates', 'scored',
         '2026-09-16 10:30:00+00'::timestamptz, '2026-09-16 10:58:00+00'::timestamptz, '2026-09-16 11:10:00+00'::timestamptz
    from dy, ch
  union all
  select gen_random_uuid(), dy.id, so.id, array[so.id], 'private', 'Rumba',
         'Rumba — hip settle',
         'Alternating basics in the middle of the floor. The hip settles a beat early, so the four is rushed and the standing leg never straightens.',
         'Let the hip settle on the four', 9,
         'Straighten the standing leg before the weight moves', 6,
         'David Yates', 'scored',
         '2026-09-21 09:15:00+00'::timestamptz, '2026-09-21 09:44:00+00'::timestamptz, '2026-09-21 09:55:00+00'::timestamptz
    from dy, so
  returning id, student_id, dance, created_at
),
fps as (
  insert into focus_points
    (id, user_id, name, normalized_name, subtitle, context, drill, dance, tier, train_target,
     status, class_input_id, source_class_input_id, created_at, last_mentioned_at,
     count, mention_count, base_score, coach_signal, is_other, group_fp)
  select gen_random_uuid(), i.student_id, v.name, lower(v.name), v.subtitle, v.context, v.drill,
         array[i.dance], v.tier, v.target, 'active', i.id, i.id,
         i.created_at + interval '2 hours', i.created_at,
         1, 1, 5, 0, false, false
    from ins i
    join (values
      ('Waltz', 'Rise on the end of one',
       'The rise starts in the foot, before the turn closes.',
       'A late rise pushes the sway past the beat.',
       'Eight bars of natural turn, rising on the end of one only.',
       'important', 2),
      ('Waltz', 'Even second step',
       'Step two stays as long as step one.',
       'The step shortens as soon as the rise is late.',
       'Four natural turns, counting the length of two out loud.',
       'important', 2),
      ('Rumba', 'Settle on the four',
       'The hip arrives with the four, not before it.',
       'Settling early rushes the end of the figure.',
       'Eight alternating basics, counting four out loud.',
       'critical', 3),
      ('Rumba', 'Straight standing leg',
       'The leg finishes straight before the weight moves.',
       'A soft standing leg hides the settle.',
       'Slow basics at the mirror, checking the knee each time.',
       'important', 2)
    ) as v(dance, name, subtitle, context, drill, tier, target)
      on v.dance = i.dance
  returning id, user_id, name, class_input_id
)
insert into practice_logs
  (id, student_id, focus_point_id, duration_minutes, rating, feeling, created_at, started_at, completed_at)
select gen_random_uuid(), f.user_id, f.id, l.mins, l.rating, l.feeling,
       l.started, l.started, l.started + (l.mins || ' minutes')::interval
  from fps f
  join (values
    ('Rise on the end of one', 7, 'good', 'Good', '2026-09-18 18:40:00+00'::timestamptz),
    ('Rise on the end of one', 6, 'okay', 'Okay', '2026-09-22 07:25:00+00'::timestamptz),
    ('Settle on the four',     8, 'good', 'Good', '2026-09-22 19:10:00+00'::timestamptz),
    ('Settle on the four',     6, 'okay', 'Okay', '2026-09-24 18:05:00+00'::timestamptz)
  ) as l(fp, mins, rating, feeling, started)
    on l.fp = f.name;
