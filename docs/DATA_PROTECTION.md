# Data protection — what the system actually does

Written 2026-09-23, against the legal review's list. Every statement here is a
description of code that runs in production, not an intention. Where something
is missing it says so.

---

## 1. Lesson audio is deleted after 180 days

**`supabase/functions/purge-expired-audio`**, nightly at 03:20 UTC
(`cron.job: purge-expired-audio`).

The **file** is removed from storage, not just its row. Two passes, because
neither is complete on its own:

- **lesson-driven** — every lesson whose date is more than 180 days ago, whatever
  the age of the file (audio imported today can belong to a lesson from April).
  `class_inputs.audio_path` is cleared and `audio_purged_at` stamped;
  `class_recording_chunks.storage_path` is cleared and `class_recordings.audio_purged_at`
  stamped.
- **object-driven** — every object in the `class-audio` bucket older than 180
  days, whatever the database says. An object is written at import, always at or
  after its lesson, so an object past the limit belongs to a lesson past the
  limit. This is what removes the 47 files (39 MB) that no row points at any
  more, left by failed imports and deleted lessons.

**Kept on purpose:** the transcript and everything derived from it — focus
points, drills, summaries, notes, the coach's knowledge base. A lesson that has
lost its audio says so through `audio_purged_at` rather than pretending there
never was any.

**Guards**, because this deletes what cannot come back: it refuses to run if the
retention constant is ever edited below 90 days; it deletes at most 2000 objects
per night; `{"dry_run": true}` returns the entire plan and deletes nothing.

**Verified** on a backdated test lesson: two objects gone from storage, pointer
cleared, row stamped, and nothing else in the bucket touched.

**Voice notes** (the student's dictated log, the coach's notes) are recorded on
the phone, sent to `whisper-transcribe` as a multipart body, transcribed, and
never stored: only the text reaches the database. There is nothing to purge.

**First real deletion: 30 October 2026** — the oldest audio in production dates
from 3 May 2026.

## 2. The coach is warned 14 days before

Same function. One notification per coach per night
(`notifications.type = 'audio_expiring'`), naming the date the first deletion
falls, stamped on `class_inputs.audio_expiry_warned_at` so it is said once and
not every evening.

> The audio of a lesson from 6 April is deleted on 3 October — we keep lesson
> audio for 180 days. The lesson, its transcript and its focus points stay. Ask
> us before then if you need the recording itself.

**Gap, deliberate:** the notice says *ask us*, not *here is your export*. The
self-service export (point 4 of the review) was not built, so promising a link
would be another false clause. The privacy policy's portability wording needs to
match this until the export exists.

## 3. A deletion request actually deletes

**`supabase/functions/erase-user`** + **`public.erase_user()`** (migration
`20260923e`). Service-role only; support runs it, and a future "delete my
account" button calls it. Always with `dry_run` first — the plan it returns is
the last chance to see what the deletion means.

Before this there was **no deletion path at all**, and a naive one would have
failed: four foreign keys are `NO ACTION` and would have refused the delete, and
nothing reached into storage.

Order: **storage first** (not transactional; a crash between the halves leaves
files deleted and rows intact, which re-running fixes), then the account and
everything keyed to it, in one transaction.

**Goes:** the auth account and profile; by cascade — focus points, score
history, practice logs, notes, notifications, push tokens, events, coach
knowledge, attendance, merge requests, couples, coach messages, recordings and
chunks; lessons they own with their transcripts and summaries; private lessons
*about* them taught by someone else; every object under their prefix in
`class-audio` and `avatars`.

**Stays, on purpose:** group lessons taught by someone else (other dancers'
data) with the person removed from the roster and from `student_ids`;
`parental_consents`, whose user references go null — the proof permission was
given and withdrawn outlives the data, exactly as the consent text promises;
`ai_call_logs` rows (token counts and cost, no content); one `data_erasures` row
holding counts, never content.

**No model-side cache to clear:** prompts are sent per request, and Anthropic's
prompt cache is ephemeral and request-keyed. Nothing about a user is persisted
with the provider between calls.

**Verified** end to end on a throwaway account: auth row, profile, lesson with
its transcript, focus point, note, notification and storage object all gone; one
audit row left with the counts.

## 4. Export — NOT BUILT

Out of scope by decision. Until it exists, the privacy policy must not promise a
self-service export, and point 2's notice says "ask us".

## 5. Coach isolation at the data level

**`supabase/functions/get-teacher-context`** is what feeds the student
assistant. It runs with the service role, so RLS was bypassed and the only thing
separating one coach's material from another's was a `.eq('coach_id', …)` in
this file — the one-line mistake the review warned about.

Now: the knowledge base is read **through the caller's own JWT**, so Postgres
enforces the boundary (`coach_knowledge_select`: your own rows, or those of the
coach you are linked to), and the code filter is the second line of defence
rather than the only one. The resolved coach is also re-checked against the
student's own `latin_coach_id` / `ballroom_coach_id` before the read, and a
denied read answers without the knowledge base rather than reaching around it
with the service role.

There is **no embeddings table and no pgvector**: `coach_knowledge` is plain
rows, already under RLS (four policies, one per command). Proven in production —
as a linked student: 273 rows from her own coach, 0 from another.

## 6. Health-data consent

Special-category data: a lesson's audio can carry an injury, a pain, a
limitation. It has its own explicit permission, separate from the terms.

- **Unticked** when the sign-up screen opens (`OnboardingScreen.acctChecks`
  starts `[false, false, false]`), and the account cannot be created until all
  three are ticked.
- **Recorded, all three**: `consent_records` (migration `20260923f`) holds one
  row per sign-up with the exact sentences that were on screen, in the order
  shown, their version and the moment they were accepted. Until 23 September
  only the health box left a trace; the other two rested on "the account exists,
  and the code cannot create one otherwise", which is an argument, not a record.
  The table is append-only from the app: insert-own and select-own, no update
  and no delete policy at all — evidence the subject can rewrite is not
  evidence. Rows for the four accounts created before it existed are marked
  `source: 'reconstructed'` and carry a note saying exactly what they are
  derived from, rather than passing for captured ones.
  `users.consent_status`, which reads `not_required` on those rows, is a
  different question entirely: whether a **parent's** permission is needed.
- **Service-specific wording**, one source: `src/services/healthConsent.js`
  (`HEALTH_CONSENT`), the same sentence the parental consent uses.
- **Date and version stored**: `users.health_data_consent_at` +
  `users.health_consent_version`. A timestamp alone cannot say what someone
  agreed to. The current version is `health-v1-2026-09-18`, named after the day
  the wording went live; the four accounts that had already ticked exactly these
  words carry it.
- **Withdrawable** from Settings ▸ Permission, on both the student and the coach
  screen. Withdrawing deletes nothing — deletion is its own request, and
  conflating the two is how people lose data they meant to keep.
- **Withdrawal stops the recording**: `canBeRecorded()` is checked in
  `StartClassScreen.recordingBlock()`, next to the minor-consent gates. A
  student who withdrew cannot be recorded (the coach is told, by name); a coach
  who withdrew cannot record at all — their own voice is on every recording,
  including group lessons where no student is named yet.

## 7. Student date of birth — NOT BUILT

Out of scope by decision. The 16 and 18 year thresholds cannot be automated
without it; today the age question is asked at sign-up and re-checked by hand
(`age_check`, `age_reviews`).

## 8. Focus point categories are a fixed list

Five categories — Stability, Technicality, Strength, Creativity, Musicality.

The database has always enforced it (`focus_points_category_check`), but the
model's answer was inserted raw: a reply of "Technique" would have failed the
constraint and taken the whole focus point down with it. `yoda-score` now maps
the answer against the list (case and whitespace insensitive) and anything off
it becomes **no category**, which the app already renders — 223 rows have none.
A category is therefore never a string the model invented, and never a reason to
lose a focus point.

## 9. What the assistant says when it has nothing

Defined in the student assistant's system prompt
(`FocusSessionScreen.buildAiSystemPrompt`), and it is one of the DPIA's three
approval conditions.

The assistant may only use two sources: the student's own focus points and class
history, and their coach's knowledge base. When the answer is in neither — which
is always the case when the coach has recorded no knowledge at all — its entire
reply is fixed:

> I don't have that in your data, but you can send the question to your coach if
> you want.

**Signalled to the student**, not swallowed: that reply carries a "send to your
coach" button that forwards the exact question (`coach_messages`), and the app
substitutes this sentence even when the model improvises or pushes the question
back at the student.

When the knowledge base is empty the prompt now **says so explicitly**, in its
own block, rather than silently omitting it — so the model cannot assume
material it was never given.
