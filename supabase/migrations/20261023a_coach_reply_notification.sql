-- ============================================================
-- A coach's answer reaches the dancer as a notification, not a bare push.
--
-- notify_coach_replied() used to call send-push directly: the push arrived
-- ("Answer from your coach 💬") but nothing was written to notifications, so a
-- tap landed on an empty Notifications list, and the app had nowhere to read the
-- answer (Sadie, 23 Oct: "I got a notification but I can't find it or his
-- answer"). It now inserts a notifications row — the same path as every other
-- notification, which send-push picks up on insert — carrying the answer itself
-- and the question's id, so the list shows it and a tap opens that question.
--
-- A question answered in person (markQuestionCovered: reply 'Covered in your
-- last lesson.') says so instead of quoting that stock line.
-- ============================================================

create or replace function public.notify_coach_replied()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_coach text;
  v_question text;
  v_in_lesson boolean;
begin
  if NEW.status = 'replied' and OLD.status is distinct from 'replied' then
    select nullif(split_part(trim(coalesce(name, '')), ' ', 1), '') into v_coach
      from users where id = NEW.coach_id;
    v_coach := coalesce(v_coach, 'Your coach');
    -- The session screen appends the focus it was asked from: "… [Focus: X]".
    v_question := trim(regexp_replace(coalesce(NEW.message, ''), '\s*\[Focus:[^\]]*\]\s*$', '', 'i'));
    v_in_lesson := NEW.covered_class_input_id is not null
                   or NEW.reply = 'Covered in your last lesson.';

    insert into notifications (user_id, type, title, body, data)
    values (
      NEW.student_id,
      'coach_reply',
      case when v_in_lesson then v_coach || ' answered your question in your lesson'
           else v_coach || ' answered your question' end,
      case when v_in_lesson then left(v_question, 240)
           else left(coalesce(NEW.reply, ''), 240) end,
      jsonb_build_object('type', 'coach_reply', 'message_id', NEW.id, 'coach_id', NEW.coach_id)
    );
  end if;
  return NEW;
end;
$$;

-- The trigger itself is unchanged (AFTER UPDATE ON coach_messages).
