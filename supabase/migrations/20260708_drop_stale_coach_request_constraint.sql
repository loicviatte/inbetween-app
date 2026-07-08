-- Fix: a student adding a coach in a SECOND dance category (e.g. Ballroom when
-- they already have that coach in Latin) never sent the "new student request"
-- notification to the coach.
--
-- Root cause: coach_requests still carried the pre-category unique constraint
--   coach_requests_coach_id_student_id_key  UNIQUE (coach_id, student_id)
-- 20260410_replace_coach_id.sql intended to drop it, but referenced the name
-- `coach_requests_student_id_coach_id_key` (columns in the other order), so the
-- DROP CONSTRAINT IF EXISTS was a no-op and the old constraint survived in prod.
--
-- Consequence: the second-category INSERT into coach_requests violates that
-- (coach_id, student_id) unique constraint. The client (_linkToCoachByCategory
-- in src/storage/storage.js) does NOT check the insert error, so it silently
-- no-ops and returns pending=true — but no row is written, so the
-- on_coach_request_created trigger (which inserts the coach notification) never
-- fires. The coach is never notified.
--
-- The category-aware constraint
--   coach_requests_student_coach_category_uniq
--     UNIQUE (student_id, coach_id, COALESCE(category, ''))
-- remains and is the correct one (one request per student+coach+category).
--
-- Dropping the constraint also drops its backing unique index. Idempotent.

ALTER TABLE public.coach_requests
  DROP CONSTRAINT IF EXISTS coach_requests_coach_id_student_id_key;
