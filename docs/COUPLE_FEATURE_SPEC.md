# Couple Feature — Specification

> Status: **Design locked** (requirements gathering complete). Ready for implementation planning.
> Last updated: 2026-06-02
> Platform scope: **iOS + Android** (Expo).

This document is the implementation reference for the Couple feature. It reflects all
decisions made during requirements gathering, including revisions to the original notes
(see [§ Deviations from the original notes](#deviations-from-the-original-notes)).

---

## 1. Core principle (the golden rule)

When two dancers link as partners, the **couple becomes a first-class entity**. It has its
own focus points, sessions, readiness, and score. **Everything "couple" is shared and happens
to both dancers simultaneously** — including the practice counter and the held/carryover logic.

The strongest consequence: a couple session belongs to the **couple**, not to a dancer
("the couple trained once for 10 min, then once for 15 min"). We **never** record "this was A"
or "this was B" on a couple session.

When one dancer starts a couple focus point, it starts **for the couple** (and the other sees
it live).

---

## 2. Glossary

- **Partner / pairing** — the dance-partner link between two users (≠ coach link).
- **Couple** — the shared entity created when two users pair.
- **Couple coach** — a coach the couple designates for the couple (per style); distinct from
  each dancer's solo coach.
- **Couple FP** — a focus point that belongs to the couple (shared single record).
- **Solo FP** — an individual focus point (existing `focus_points`), unchanged.
- **Lock** — server-side "a couple FP is being trained right now" marker.

---

## 3. Data model

### 3.1 Existing schema we build on

- `users` — already has `latin_coach_id`, `ballroom_coach_id`, `invite_code` (stable code,
  **reused for partner pairing**), `dance_style`.
- `coach_requests` — `coach_id`, `student_id`, `status` (pending/accepted), `category`
  (latin/ballroom). The **double opt-in pattern we mirror** for both partner pairing and
  couple-coach designation.
- `focus_points` — `user_id`, `class_input_id`, `name`, `subtitle`, `context`, `drill`,
  `dance`, `tier`, `status`, `is_held`, `is_other`, `is_deleted`, `category`, plus yoda-score
  columns.
- `class_inputs` — `lesson_type` (`'private' | 'group' | null`), `created_at`, coach ref.
- `practice_logs` — `student_id`, `focus_point_id`, `started_at`, `completed_at`,
  `duration_minutes`, `rating`, `feeling`, `session_note`, `session_motivation`.

### 3.2 New tables (proposed)

> Names/columns are proposals; verify against final migration. All couple content is
> **hard-deleted on unpair** (no archive), so no soft-delete/history columns are required.

**`couples`**
| column | notes |
|---|---|
| `id` | PK |
| `user_a_id`, `user_b_id` | the two dancers; enforce each user is in at most one couple |
| `leader_user_id` | which of A/B is the leader (chosen at pairing) |
| `does_latin`, `does_ballroom` | which style(s) the couple dances (chosen at pairing) |
| `latin_couple_coach_id` | nullable; the couple's latin coach (after accept) |
| `ballroom_couple_coach_id` | nullable; the couple's ballroom coach (after accept) |
| `created_at` | |

- **No gender column.** Role is captured directly as `leader_user_id` (see Deviations).
- Uniqueness: a user may belong to **0 or 1** couple at a time.

**`couple_requests`** (pairing handshake — 3 steps)
| column | notes |
|---|---|
| `id` | PK |
| `requester_id` | A (entered B's code) |
| `target_id` | B |
| `proposed_does_latin`, `proposed_does_ballroom` | set by B on accept |
| `proposed_leader_id` | set by B on accept |
| `status` | `pending` → (B configures) `awaiting_validation` → (A validates) creates `couples` row |

**`couple_coach_requests`** (couple designates a couple coach — mirrors `coach_requests`)
| column | notes |
|---|---|
| `id` | PK |
| `couple_id` | |
| `coach_id` | |
| `category` | `latin` or `ballroom` |
| `status` | `pending` → `accepted` (on accept, sets `couples.{category}_couple_coach_id`) |

**`couple_focus_points`** (mirrors `focus_points`, couple-scoped)
| column | notes |
|---|---|
| `id` | PK |
| `couple_id` | replaces `user_id` |
| `class_input_id` | originating couple class |
| `name`, `subtitle`, `context`, `drill`, `dance`, `tier`, `status`, `category` | same as solo |
| `is_held`, `is_deleted` | same semantics as solo |
| yoda-score columns | same as `focus_points` (one shared score per couple FP) |

**`couple_practice_logs`** (mirrors `practice_logs`, couple-scoped, **no dancer attribution**)
| column | notes |
|---|---|
| `id` | PK |
| `couple_id` | |
| `couple_focus_point_id` | |
| `started_at`, `completed_at`, `duration_minutes`, `rating`, `feeling`, `session_note`, `session_motivation` | shared, visible to both |

**`couple_focus_locks`** (the training lock — **one row max per couple**, i.e. couple-wide)
| column | notes |
|---|---|
| `couple_id` | UNIQUE → guarantees couple-wide, atomic "first wins" acquire |
| `couple_focus_point_id` | which FP is in progress |
| `locked_by_user_id` | for display ("Alexandra is training…") |
| `started_at` | wall-clock; the other side renders the same countdown from this |
| `session_duration_minutes` | to render the timer |
| `last_heartbeat_at` | staleness; stale after ~90 s with no ping |

### 3.3 Modified existing schema

- `class_inputs.lesson_type` — add `'couple'`. Add nullable `couple_id` for couple classes.
- Readiness becomes **per style** (behavioral change — see § 11).

---

## 4. Pairing (the handshake)

Each user has a stable `invite_code` on their profile (reused). Pairing is a 3-step handshake:

1. **A enters B's code** → a `couple_request` (`pending`) is sent to B.
2. **B accepts** → a pop-up where B chooses **the couple's style(s)** (latin / ballroom / both)
   and **assigns leader / follower**. Saves to the request (`awaiting_validation`).
3. **A validates** B's proposal → the `couples` row is created with style(s) + `leader_user_id`.

Rules:
- **One partner at a time** (0 or 1, lifetime). **Nothing is kept** from a previous couple.
- Because the role is assigned explicitly at pairing, **same-sex couples work naturally**
  (just one leader + one follower). No blocking needed.
- A **coach cannot be the dance partner** of their own student.

### Unpair (destructive)
- Button → confirmation pop-up: **"all couple progress will be lost."**
- On confirm: **all couple content is hard-deleted for both dancers immediately**, including any
  in-progress session/lock. No archive.
- **Account deletion = same effect** as unpair.

---

## 5. Couple focus points

- Live in their own table `couple_focus_points`, **one shared record per couple** (not duplicated
  per dancer), always tied to a **style**.
- **Only a coach creates** couple FP.
- **Scoring:** yoda-score runs with the **same logic**, just extended to the couple table → **one
  shared score** per couple FP. No ×2, no special prompt.
- **Held / carryover** follows the golden rule:
  - A held couple FP is held **for both**.
  - The **15 minutes accumulate at couple level** (e.g. 10 min + 5 min = archived).
  - The "reappears once readiness ≥ 100%" gate uses the **couple's** readiness.

---

## 6. Couple ↔ coach relationship

Distinct from the solo coach relationship.

- The couple **designates** a couple coach by entering the coach's code; the coach must
  **accept** (double opt-in, mirrors `coach_requests`).
- The coach **cannot** form/pair a couple himself.
- The couple coach can be **anyone** (not necessarily a solo coach of either dancer).
- **Per style:** `latin_couple_coach_id` + `ballroom_couple_coach_id`.
- **If the couple coach leaves the couple:** the pairing **persists**, couple FP **remain**, and
  any **completed** couple FP **wait for validation** until a new couple coach is designated (the
  coach validates mastery at debrief — no coach = no validation, the FP waits).
- **Constraint (for now):** a single coach **cannot** be both the latin and ballroom coach of the
  same student/couple → a class's style is **always unambiguous** from the coach (no style picker
  needed at class start).

---

## 7. Coach UI

- A **`Students | Couples`** toggle at the top of the existing student list.
- The **Couples** tab lists every couple where the coach is `latin_couple_coach` **or**
  `ballroom_couple_coach`, regardless of whether he coaches either dancer solo.
- Couple identity: **"Alexandra & Loïc"** + the two avatars side by side.
- The couple page shows the **couple FP**, **couple sessions**, and **couple readiness**, with a
  button to open a dancer's profile — **only if the coach is also that dancer's solo coach**
  (otherwise the button is hidden).

---

## 8. Couple lessons

- New `lesson_type: 'couple'` (alongside `private` / `group`), **exactly one couple** per couple
  lesson (no mixing couples/solos).
- The lesson is transcribed as today, then **the AI (yoda-extract) splits** the focus points:
  - point about both → **couple FP** (`couple_focus_points`)
  - point about one dancer → that dancer's **solo FP** (`focus_points`)
- The coach can correct the split at debrief; **default target = couple**.
- **Debrief verdict is per FP:** a solo FP feeds that dancer's **solo** readiness; a couple FP
  feeds the **couple** readiness.
- **ActionNeededScreen** presents **couple and solo separately** (a couple block + per-dancer
  solo blocks).

---

## 9. Student — Train page (`HomeScreen.js`)

- **No solo/couple toggle** (revised — see Deviations).
- Two **distinct cards**: **Solo** and **Couple**.
  - The card **most-trained over the last 2 weeks** renders **large**; the other renders **small**
    below. Tapping the small card **expands** it and shrinks the other (accordion).
- The existing **latin/ballroom toggle** (dual-style users only) filters **both** cards.
- Couple FP are **visually marked** (couple badge / partner avatar).
- Empty couple card → **"attend your couple private lesson"**.

---

## 10. Student — Profile & readiness (`ProfileScreen.js`)

- Two **readiness cards** — **Solo** and **Couple** — **swipeable**, both for the **style selected
  in Train**.
- The **primary** card mirrors **which card is expanded in Train** (the solo/couple expanded state
  is **shared** between Train and Profile; default = most-trained over 2 weeks).
- Swipe is **consultation only** (changes nothing elsewhere).
- **Couple readiness** is computed from couple FP only, same engine as solo.

---

## 11. Readiness becomes per-style (behavioral change)

Today `getLessonReadiness` returns **one global readiness** anchored to your single most-recent
private (any style; no category filter).

**New behavior:** compute readiness **per style**, anchored to the **last private of each style**
(`focus_points.category` already exists, so this is feasible without new columns). Combined with
solo/couple, there are **up to 4 readiness values** internally (latin-solo, latin-couple,
ballroom-solo, ballroom-couple); the Profile shows **2 at a time** (for the active style).

---

## 12. Training lock 🔴

- **Only couple FP lock.** Solo FP never lock between partners.
- The current "active session" is **local-only** (AsyncStorage; `src/storage/activeSession.js`),
  so a **server-side lock row is required** so the partner can see it.
- **Couple-wide:** while one dancer trains **any** couple FP, the other can start **no** couple FP
  (but the other's **solo** work is always available).
- The other dancer sees a **live mirror**: "training in progress" + the **running timer** (not a
  greyed-out item).
- **First to start wins** (atomic via the UNIQUE `couple_id` on `couple_focus_locks`; whoever it is).
- **Release:**
  1. on **log** (happy path),
  2. on **cancel / quit** the session screen without logging,
  3. **heartbeat timeout** for crash / force-quit: ping ~**30 s**; lock considered **stale after
     ~90 s** with no ping → the partner can reclaim.

---

## 13. Logging & sessions

- A couple session = **one shared `couple_practice_logs` record**, attached to the couple FP,
  **identical in both histories** (the real session, not a notification).
- Whoever held the lock logs; **their log is the source of truth** — the partner validates nothing.
- Sessions **accumulate at couple level**, with **no per-dancer attribution**.
- **feeling / note / motivation are shared** (visible to both).
- **Logging a couple session alone** (partner not present) is **allowed**.
- yoda-score handles a couple `practice_log` event the same way as solo, on the couple FP.

---

## 14. Realtime, sync & notifications

- **One realtime channel per couple** (`postgres_changes`; pattern already used in
  `StudentDetailScreen.js`), watching the lock, couple FP, and couple sessions.
- **Lock = strict realtime.** Logged sessions + new couple FP = **best-effort realtime**.
- **Push notifications** for **everything except "partner logged a session"**:
  - pairing request received / accepted
  - couple-coach request received (coach side) / accepted
  - new couple FP
  - unpair by the partner
- **Offline:** online is required for a clean lock. If offline, starting is **still allowed** but
  shows a **warning pop-up** ("no network — make sure your partner isn't training the same point at
  the same time"); sessions sync/accumulate on reconnect.

---

## 15. Privacy & permissions

- The **partner** sees only your **profile photo, name, and shared couple FP** — nothing else
  (no solo FP, solo sessions, solo readiness, notes, or coach messages). You **cannot** open the
  partner's profile.
- The **couple coach** sees the whole couple (couple FP / sessions / readiness) even if he coaches
  neither dancer solo; he sees a dancer's **solo** data **only if** he is that dancer's solo coach
  (otherwise the open-profile button is hidden).

---

## 16. Scope & platform

- **No subscription/billing model exists** today → the couple feature is **gated by nothing**
  (out of scope).
- **iOS + Android** (Expo).
- **No conversion** of an existing solo FP into a couple FP for now.

---

## 17. Edge cases

| Case | Decision |
|---|---|
| Couple coach leaves | Pairing persists; couple FP remain; completed ones wait for a new couple coach to validate. |
| Unpair mid-session | Everything is wiped; the in-progress session/lock is lost. |
| Same-sex couple | Supported (role assigned at pairing: one leader + one follower). |
| No common solo style | The couple picks its style(s) at creation (pairing pop-up), independent of solo styles. |
| Same coach for both styles of one student | Not supported for now → class style is always unambiguous; no picker. |
| Account deletion | Same as unpair. |

---

## 18. Affected existing code (starting points)

- `src/storage/storage.js` — coach linking (`_linkToCoachByCategory`), `getLessonReadiness`
  (→ per-style + couple), `invite_code` flow.
- `src/storage/coachStorage.js` — coach roster / requests; add couples roster + couple-coach
  requests.
- `src/utils/algorithm.js` — `completeTrainingSession`, `getSlots`, held-archive logic
  (→ couple variants).
- `src/screens/HomeScreen.js` — Train page; add Solo/Couple cards + accordion + couple empty state.
- `src/screens/ProfileScreen.js` — readiness cards (Solo/Couple swipe, per-style).
- `src/screens/FocusSessionScreen.js` — acquire/heartbeat/release lock for couple FP; live mirror.
- `src/screens/coach/StartClassScreen.js` — add `couple` lesson type + couple selection.
- `src/screens/coach/ActionNeededScreen.js` — couple vs solo split.
- `src/screens/coach/StudentDetailScreen.js` — realtime pattern to mirror for the couple channel.
- `supabase/functions/yoda-extract/` — couple/A/B split of extracted FP.
- `supabase/functions/yoda-score/` — handle couple FP table + couple `practice_log` event.
- `supabase/migrations/` — new tables (§ 3.2) + `class_inputs` changes.

---

## Deviations from the original notes

1. **No solo/couple toggle on Train.** The original notes proposed a top-of-screen solo/couple
   switch. Replaced by **two distinct cards (Solo + Couple)** shown together, prioritized by
   most-trained-in-2-weeks (accordion). The latin/ballroom toggle remains.
2. **No gender field.** The original plan derived leader = man and added gender at onboarding.
   Replaced by **leader/follower assigned at pairing** and stored on the couple
   (`leader_user_id`). This also makes same-sex couples work without special handling.
3. **Readiness is now per-style** (was global / last-private-any-style).
4. **Couple ↔ coach is a separate, per-style relationship** with its own double opt-in
   (not implied by the original notes).
