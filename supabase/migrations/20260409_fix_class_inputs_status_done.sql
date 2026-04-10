-- Fix rows with legacy status 'done' — treat them as fully processed
UPDATE class_inputs
SET status = 'scored'
WHERE status = 'done';
