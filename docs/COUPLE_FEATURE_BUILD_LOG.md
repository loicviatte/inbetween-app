# Couple Feature — Build Log & Handoff

> Handoff doc to resume work after clearing the chat. Pairs with
> **`docs/COUPLE_FEATURE_SPEC.md`** (authoritative requirements) and
> **`docs/design/train-couple-design.md`** (Train UI design).

## TL;DR
The full **Couple feature** (partners train together with shared "couple focus
points") was built across milestones **M0–M7**. **All backend (DB migrations,
edge functions, triggers, RPCs) is APPLIED to PROD but dormant** (additive only;
the couple UI is NOT shipped, so current App Store users are unaffected). **All
app/UI code is UNCOMMITTED** in the worktree below.

Separately, **v1.6.4 shipped to TestFlight** (commit `3d79547` on `main`) — a
2-line change enabling local-recording mode for coach **Tanya**
(`kuzmenkotatyan@gmail.com`). Build run succeeded.

## Where the work lives
- **Couple feature code (uncommitted):** worktree
  `/.claude/worktrees/kind-hertz` on branch `claude/kind-hertz-forward`.
  - ⚠️ This worktree also has PRE-EXISTING unrelated WIP (feature
    `coach_messages_covered_class`) touching ProfileScreen, StartClassScreen,
    coachStorage, yoda-score, ActionNeededScreen, StudentDetailScreen,
    ClassDetailScreen + `supabase/migrations/20260529_coach_messages_covered_class.sql`.
    That WIP is **not part of the couple feature** — keep it separate when committing.
- **1.6.4 / Tanya (shipped):** committed on `main` in the main repo
  `/Users/loicp/inbetween-app` (`src/services/featureFlags.js` + `app.json` 1.6.4).

## Golden rule (design)
A couple is a **single shared entity**: one set of focus points, one score, one
readiness, one couple-wide training lock, sessions attributed to the couple (no
per-dancer attribution). Everything couple-related happens to both dancers.

---

## What's in PROD (applied, additive, dormant)

### Migrations (files in `supabase/migrations/`, all applied via Management API)
1. `20260602_couple_feature.sql` — tables `couples`, `couple_requests`,
   `couple_coach_requests`, `couple_focus_points`, `couple_practice_logs`,
   `couple_focus_locks`; `users.couple_id`; `class_inputs.couple_id`; RLS +
   helper fns `is_couple_participant/member/coach`; lock RPCs
   `acquire_couple_lock`/`heartbeat_couple_lock`/`release_couple_lock`; realtime
   publication for locks/points/logs.
2. `20260602_couple_pairing_rpc.sql` — `finalize_couple(p_request_id)` (A
   validates → creates couple + sets both `users.couple_id`).
3. `20260602_couple_rls_fix.sql` — `find_partner_by_code(p_code)` SECURITY
   DEFINER lookup + `users_couple_read` SELECT policy (read partner / request
   counterparty rows).
4. `20260602_couple_requests_realtime.sql` — realtime publication for
   `couple_requests` + `couples`.
5. `20260603_couple_coach.sql` — `users_couple_read` extended to the couple-coach
   + `respond_couple_coach_request` + `get_pending_couple_coach_requests` RPCs.
6. `20260603_couple_recordings.sql` — `class_recordings.couple_id` +
   `finalize_recording_atomic` rewritten to copy `couple_id` to `class_inputs`
   and propagate both dancers to `class_input_students` (couple, like group).
   NOTE: replicated the LIVE prod definition `RETURNS TABLE(class_input_id,
   was_created)` — the repo's old `20260429` file was stale.
7. `20260603_couple_notifications.sql` — 7 triggers inserting into
   `notifications` (→ existing `on-notification-insert` webhook → `send-push`):
   pairing received/accepted, couple created, unpair, couple-coach
   request/accepted, new couple FP. (No push for "partner logged a session".)

### Edge functions (deployed via `supabase functions deploy`)
- **yoda-extract** — `SYSTEM_PROMPT` adds a `couple` rule: partnering
  corrections → `shared_focus_points` (couple), individual → per-dancer
  `focus_points`. (Students for a couple class come from `class_input_students`,
  already populated by the finalize RPC.)
- **yoda-score** — `processClassInput`: selects `couple_id`; added a couple
  branch routing `shared_focus_points` → `couple_focus_points` (status `active`).
  Solo/group paths byte-identical.

### Tables to know
`couple_focus_points` mirrors `focus_points` (keyed by `couple_id`, has yoda
score cols + `is_held`). `couple_practice_logs` mirrors `practice_logs` (couple
level, no dancer id). `couple_focus_locks` = one row per couple (PK `couple_id`)
= the atomic couple-wide lock; stale after 90s without heartbeat.

---

## App/UI code (UNCOMMITTED in the worktree)

**Created**
- `src/storage/coupleStorage.js` — pairing handshake, `getMyCouple`, `unpair`,
  couple-coach (`requestCoupleCoachByCode`, `getPendingCoupleCoachRequests`,
  `respondToCoupleCoachRequest`), `getMyCouples`, `getCoupleDetail`,
  `getCoupleFocusPoints`, `getCoupleActivity`, `getCoupleReadiness`,
  `getCoupleSlots`(in algorithm), `mostTrainedMode`, lock (`acquireCoupleLock`,
  `heartbeatCoupleLock`, `releaseCoupleLock`, `getCoupleLock`),
  `completeCoupleTrainingSession`.
- `src/screens/coach/CoupleDetailScreen.js` — coach couple page (2 dancers,
  couple readiness ring, couple FP, couple sessions, realtime).
- `docs/COUPLE_FEATURE_SPEC.md`, `docs/design/train-couple-design.md`.

**Modified**
- `src/storage/storage.js` — `getLessonReadiness(userId, category)` now per-style
  (dance-derived via `focusMatchesCategory`; `category=null` = legacy behavior).
- `src/utils/algorithm.js` — `getCoupleSlots(coupleId, category)` (mirror of getSlots).
- `src/screens/HomeScreen.js` — Train: Solo/Couple **accordion cards**
  (`FocusCard`), **concentric readiness ring** (`ConcentricReadiness`, blue
  couple + gold solo), couple lock **live mirror** ("🔒 X is training · timer"),
  per-couple realtime; couple data loaded non-blocking.
- `src/screens/ProfileScreen.js` — `PartnerModal` (full pairing handshake +
  own invite code), `GlancePartner` slot, couple-coach designation per style,
  **Solo|Couple readiness toggle**, realtime on couple_requests/couples.
- `src/screens/FocusSessionScreen.js` — couple session: `acquireCoupleLock` on
  start, ~30s heartbeat, release on complete/cancel/stop, `completeCoupleTrainingSession`.
- `src/screens/coach/CoachHomeScreen.js` — `Students | Couples` toggle, couples
  roster (`CoupleRosterCard`), pending couple-coach requests (`CoupleRequestRow`).
- `src/navigation/CoachAppNavigator.js` — registered `CoupleDetail` screen.

UI conventions: **solo = gold/black**, **couple = blue `#2E4670`**. Cards
validated with `babel-preset-expo` parse (no runtime test possible here).

---

## Test data in PROD (delete when done)
- **Couple** `7e0a4f42-6b04-4760-a359-96e4cab642a1`: `loicpk@gmail.com` (user_a)
  + `loic@useinbetween.com` (user_b); David Yates is latin+ballroom couple
  coach; styles latin+ballroom; **3 couple FP** (Shared Timing, Connection &
  Frame, Spatial Awareness) + **3 couple sessions** (~43% couple readiness).
- **loic@useinbetween.com** (`ce2cc7b2-da5e-45f9-ab29-c7841b6ce255`): 3 solo FP
  (Hip Settlement, Go Extreme, Spotting & Spins) + a mock private class with
  David + ~57% solo readiness.

### Accounts
- `loic@useinbetween.com` (`ce2cc7b2…`) — student (Dancer B of the couple).
- `loicpk@gmail.com` — student (Dancer A).
- `viatteloic@gmail.com` = **David Yates** (`b34fc050-3431-49e7-bf8f-0df0560dcbe3`) — coach.
- `kuzmenkotatyan@gmail.com` = **Tanya** — coach (now in local-recording allowlist, 1.6.4).
- `alexandra@lukey.ch` — NOT in the DB (memory was stale).

### Creds for prod admin work
`.env` (main repo) has `SUPABASE_PROJECT_REF`, `SUPABASE_ACCESS_TOKEN` (Management
API SQL endpoint `POST https://api.supabase.com/v1/projects/{ref}/database/query`),
`SUPABASE_SERVICE_ROLE_KEY` + `EXPO_PUBLIC_SUPABASE_URL` (PostgREST). The direct
`SUPABASE_DB_URL` host doesn't resolve (use Management API or PostgREST). All
prod calls need `dangerouslyDisableSandbox` (sandbox blocks network).

---

## Known gaps / TODO (not blocking the demo)
1. **Couple code is uncommitted** → commit on kind-hertz; eventually merge to
   main + ship a build (≈1.7.0) for users to get the couple UI.
2. **yoda-score couple SCORING not wired** — couple FP `base_score`/
   `practice_count` aren't updated by practice (members can't UPDATE
   couple_focus_points under RLS; the couple `practice_log` event isn't handled).
   Couple readiness works (it counts `couple_practice_logs` directly).
3. **Held 15-min couple FP auto-archive** not implemented.
4. **ActionNeeded couple review** not built — couple FP go straight to `active`;
   per-dancer FP from a couple class go through the normal coach review.
5. **New-couple-FP push** fires per FP × 2 dancers (a few per class) — could batch.
6. **Same coach as both latin & ballroom coach of one student** unsupported (parked).

## Fonts note (not a bug)
The app embeds TT Travels Next via the **expo-font config plugin** (build-time,
native; `app.json` plugins + App.js has no runtime `useFonts` gate). **Expo Go
shows the system font** because it can't load config-plugin fonts. Real builds
(dev client / TestFlight / prod) render TT Travels correctly. To see real fonts
while testing, use a dev client, not Expo Go.

## Suggested next steps
1. `git add` the couple files + commit on `claude/kind-hertz-forward` (keep the
   `coach_messages_covered_class` WIP separate).
2. Build a **dev client** to test with real fonts.
3. Run the end-to-end test plan (pair → couple coach → couple class → train +
   lock → log). 2 devices needed for the live lock mirror.
4. Address TODO #2 (couple scoring) if couple FP priority matters.
