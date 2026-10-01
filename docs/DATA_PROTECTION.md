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

**Corrected 25 September** (migration `20260925a`), on the first erasure of a
student who had a coach. Deleting the private lessons *about* the person was
refused by `focus_points.class_input_id`, a `NO ACTION` reference the throwaway
account happened not to have: a focus point still named the lesson, so the whole
transaction rolled back. Two references of that shape are now moved out of the
way first — the focus points on those lessons (the person's own go with them,
anyone else's are only unlinked) and a partner's `alias_of` /
`merge_candidate_id` pointing at the person's focus points, which is what
merging a couple's two plans leaves behind. Storage is deleted before the
database precisely so a refusal like this one loses nothing: the re-run
completed, and the audit row says which half had already happened.

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

**A second one, found and closed on 26 September** (migration `20260926f`).
`focus_points` carried a policy named `focus_points_require_admin_approval`,
written as a barrier — nothing leaves before the admin has checked it. It was
PERMISSIVE, and a permissive policy can only grant: Postgres combines them with
OR. So instead of locking the real policy it opened a second way in, and that
one never asked who the reader was — only whether the row's class was approved,
**or whether the row had no class at all**. That last clause checks nothing, so
every focus point attached to no class (dictated at sign-up, created by a coach,
carried over by hand) was readable by any authenticated account. Measured, not
assumed: signed in as a dancer who joined this week, 43 focus points of an
unrelated student came back — name, subtitle and context, which is what someone
was corrected on and can name an injury. 45 rows were exposed; no evidence any
were read.

It is now RESTRICTIVE, which ANDs: a focus point is readable when the ownership
policy allows it **and** its class has opened (the admin's approval, or the
four-hour rule of `20260926b`). The same gate was added to
`couple_focus_points`, whose own policy was correctly scoped. Re-measured after
the change: that dancer reads 9 rows, all hers; her coach reads her 127; the
admin still reads all 601.

**And the style boundary, the same evening** (migration `20260926g`). Esther has
two coaches: Tanya for Latin, Nataliia for Ballroom. Every screen shows each of
them only their own style — the roster, the metrics, the readiness are all
filtered by the coach's category — but the read policy said "my students' focus
points", full stop. Signed in as Nataliia, 169 Latin focus points of her four
students came back, taught by two other coaches, against 18 of her own. The
boundary existed in the client and not in the data, which is precisely the
finding this section opens with.

A second RESTRICTIVE policy now says what the app says: the dancer, their
guardian and the admin keep everything; a coach reads what they taught (the
class is theirs, whatever style it was tagged with) and the style they coach
that dancer in — from the accepted `coach_request`'s category or from
`users.latin_coach_id` / `ballroom_coach_id`. An untagged focus point belongs to
no style and stays visible to both, as the app already treats it. The couple
table gets the same rule against its two coach columns. After: Nataliia reads
20 rows (18 Ballroom, plus 2 Latin from a class she taught herself) instead of
189; Tanya reads 119 Latin and no Ballroom; Esther still reads all 127 of her
own; the admin all 601.

## 5b. Incident, 1 October: a couple lesson read from another student's account

Reported by the coach, not caught by us. Fabio taught a couple lesson to Sanna
and Sadie on 26 September; on 1 October he wrote that its data was showing on
Yaroslava's account. Yaroslava is a **child account** with a guardian, who owns
no lesson and no focus point and whose only link to that lesson is that Fabio is
also her Ballroom coach.

**Cause.** One branch of the `class_inputs` read policy: *my coach taught this
class, and the class is either about me or names no student*. "Names no student"
was written to mean a group class, where the roster lives elsewhere and every
student of that coach may read the shared summary. A **couple** lesson carries
no `student_id` either — its two dancers are the couple — so it fell into the
same branch and every other student of that coach could read it: title, summary
and the 2,883-character transcript.

**Exposure.** Four students are linked to that coach. Two are the dancers
themselves. The other two are Yaroslava and Madeleine Lodge. Madeleine last
opened the app on 24 September, two days before the lesson existed, so she never
saw it. Yaroslava's account did: it opened the lesson detail **seven times on
30 September between 23:14 and 23:20**. Window: 26 September 20:41 (scoring) to
1 October (fix), four days and fourteen hours. No focus point, no couple focus
point and no recording were reachable from that account — only the lesson row.

**Fix** (migration `20261001a`): the student branch now excludes a couple lesson
explicitly, by `couple_id` and by `lesson_type` (one older couple class carries
the type but no `couple_id`). The couple's own branch, first in the policy,
already gives the two dancers and their couple coaches what they need. Verified
after the change: Yaroslava and Madeleine read zero lessons, Sanna and Sadie
still read theirs, every other account is unchanged.

**What this says about the pattern.** Three read boundaries have now been found
in the same place — the approval gate that was a door (26 September), the
style boundary that lived only in the client (26 September) and this one. Each
was a policy written for one lesson type and inherited by another. A couple
lesson resembles a group lesson in the schema and resembles a private one in
life; every rule that keys off "no named student" needs re-reading with that in
mind.

## 5c. The pass over every policy, 1 October

After 5b, every row-level policy in the database was read and then tested by
simulation: an account's JWT claims set, the role switched, and the visible row
count taken table by table, for a signed-out caller, a brand-new account, a
student with no lessons, a child account, a guardian, two students with
lessons, and three coaches. What the policy says and what it does are not the
same question; this answers the second.

**Two more instances of the 5b clause, one of them live.** Three SECURITY
DEFINER functions carry the same sentence the policy carried —
`guardian_can_read_class_input`, `lesson_minutes`, `get_lesson_readiness`. The
first was reachable: after the policy was fixed, Yaroslava's **guardian** could
still read the couple lesson, through her daughter's coach link. Fixed in
`20261001b`, all three aligned with the policy.

**The users table answered to the app's public key.** One branch of its read
policy — `invite_code IS NOT NULL AND role = 'coach'` — names no caller, so
anybody holding the anon key that ships inside the app read all 11 coach rows
in full: email, the legacy `push_token` column (19 rows in this table still
carry one), `consent_status`, the health-consent dates, the notification
settings. Nothing there is needed to pick a teacher from a list. Fixed in
`20261001c`: `public.coach_directory`, a view of the six fields the picker
uses, readable by anyone including before sign-up; the table's branch now
requires a signed-in caller; the app reads the view in all four places. Signed
out, the API now returns an empty array for `users` and the directory for
`coach_directory`.

**Closed the same day** (`20261001d`). The branch was kept for a few hours in
case a build in the field still read the table; the two screens that could have
been affected are the sign-up coach list, which only a brand-new install sees,
and the teacher typeahead in the manual log, where the name can be typed by
hand. So it went. A dancer now reads a coach's row only through
`is_my_coach()` — their own coach, linked or still pending — and, added with
it, the coach of a couple they dance in, which until then worked only because
every coach was readable by everyone. Measured after: a student with no lessons
reads 2 rows (herself and her coach), a dancer in a couple 3, a guardian 3
(herself, her child, the child's coach), a coach her own students plus the
coaches of her own studio.

**Everything else held.** Thirteen tables have no read policy at all, so they
answer only to the service role. Every write policy checks the caller. A coach
sees exactly the students who attended her own classes, and no others. A
student sees only her own roster rows. A guardian sees her child and nothing
beyond. Signed out, the only thing left in reach is the studio list — six
names.

## 5d. The audit beyond the row policies, 1 October

5c tested what each table lets a reader see. This pass looked at every other
way in: the functions a client can call, the edge functions, storage, the
realtime feed. Every finding below was proven before it was fixed, each time in
a transaction that was rolled back or against an id that does not exist.

**A guard that a missing identity walks through** (`20261001e`). Three
SECURITY DEFINER functions defended themselves with an inequality —
`IF auth.email() != admin_email() THEN RAISE`. Signed out, the identity is
NULL, the comparison is neither true nor false, and IF skips the RAISE. The
worst was `trainer_insert_class_input`: holding only the public key, with a
coach id from the public directory, an anonymous caller inserted a lesson into
that coach's account — and a lesson insert is what wakes the extraction
pipeline. The other two let an anonymous caller who knew a request id pair a
couple or accept a coach request. All three now use IS DISTINCT FROM, and the
anonymous role lost EXECUTE on thirteen functions that change or return data
and have no signed-out use. No lesson in production carries the traces of an
anonymous insert: every lesson without a recording belongs to the demo
account, to a student's own log, or to the April lessons before recording
existed.

**Push notifications to anyone, from anyone.** `send-push` asked for nothing,
and the gateway's JWT check is satisfied by the anon key inside the app: any
title and body could be pushed to any user id, under the InBetween name. Proven
against an id that does not exist, so nothing was sent. It now answers only to
the service role, which every legitimate caller uses — the notification
webhook and six database functions, each checked.

**A coach link nobody accepted** (`create-child-account`). The parent's choice
of coach was written straight into the child's coach column with the service
role, which the acceptance guard exempts. The read policies trust that column,
so anyone who signed up as a parent could name any coach and immediately read
that coach's group lessons, transcripts included, and their whole knowledge
base — four lessons and seventy entries in the reproduction — before the coach
had answered. The function now files a pending request only; the column is
written when the coach accepts, as for every student. One account still carries
such a link from before the fix.

**Checked and clean.** Lesson audio is readable only from its owner's folder;
age proofs have no read policy at all; avatars are public by design. The only
view a client can read is the coach directory. The six tables on the realtime
feed are all behind row policies, and the app uses no broadcast or presence
channel. Every other edge function either verifies the caller or a webhook
secret and ties the ids it receives to that caller; the one open endpoint,
the onboarding recall, runs before an account exists and is rate-limited by IP.

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
  evidence. Rows for the accounts created before it existed are marked
  `source: 'reconstructed'` and carry a note saying exactly what they are
  derived from, rather than passing for captured ones. **Parent accounts get
  none**: they never see these three sentences — they tick the minor consent's
  four instead, and `parental_consents` already keeps the full text they read,
  its version, the approval time, the approving IP and the SMS verification.
  That record is stronger than this one.
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
