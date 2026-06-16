# Focus Points — Rework Spec (this version)

Single source of truth for the focus-point model change. Decided 2026-06-15.

## Goal
The **tier** (critical / important / supporting) serves ONLY as the per-focus
**train-count target**. Remove all score-based decay, inaction penalties, and the
priority/scoring engine. A focus point stays **active** until the coach validates
it at a debrief, or the student archives it.

## Core model
- A **private** class produces **up to 3** focus points; a **group** class **up to 2**.
- Each focus point has:
  - **`tier`** = display **rank / severity only** (no longer drives the count).
  - **`train_target`** (NEW stored int) = how many sessions to train it.
    - Seeded from tier on creation: critical = 3, important = 2, supporting = 2.
    - **+2 every time it must be redone** (carry-over). Accumulates with no limit
      (3 → 5 → 7 → 9 …).
  - **`practice_count`** = sessions done (the X in X/N). **Never reset.**
- Progress shown to the student = `practice_count` / `train_target`.
- End-of-session **feeling** = recorded (informational for the coach), affects nothing.
- **No decay, no inaction, no auto-retire by score.** `base_score` / `coach_signal`
  / `computePriority` are inert (removed in code — "Niveau 1").

## Lifecycle
1. **Create** — class recorded → `yoda-extract` → up to 3 (private) / 2 (group)
   focus points, tiered by the AI → `yoda-score` inserts them (`pending_coach`,
   18 h coach review → `active`). `train_target` seeded from tier.
2. **Train** — student trains → `practice_count++` only.
3. **Next private class debrief** (coach):
   - **Default: every old focus point the coach does NOT touch → retired (`past`)**,
     disappears for the student.
   - Coach marks **"pas encore"** on an old FP → it is **kept** (carried over).
   - Coach marks **"ok"** → `past` (explicit done).
4. **Reconcile** kept-old + new focus points to **max 3**:
   - **Case A — kept-old IS one of the new (same root cause → merge):** merge them.
     Keep `practice_count`, **`train_target += 2`**, keep its rank. (e.g. 3/3 → 3/5)
   - **Case B — kept-old is DISTINCT from the 3 new:** 4 total → cut to 3:
     - Kept-old was **critical or important** → AUTO: **drop the new supporting**;
       re-rank → [ new critical = critical (1st), kept-old = important (2nd),
       new important = supporting (3rd) ]. Kept-old gets `train_target += 2`.
     - Kept-old was **supporting** → **coach chooses** which of { new important (Y),
       new supporting (Z), kept-old (A) } to drop (new critical X is always kept).
       The 2 survivors keep their rank; if A survives it takes the rank of the focus
       it replaces (the freed slot). A gets `train_target += 2` if kept.
       - drop Z → [X critical, Y important, A supporting]
       - drop Y → [X critical, A important, Z supporting]
       - drop A → [X critical, Y important, Z supporting]
   - **Couple lessons: identical rules** (on `couple_focus_points`).

## Removed / now vestigial
- **Niveau 1 (code, in this batch):** `computePriority`, `selectFocusPoints`, all
  priority constants, `applyCoachSignal`, client `COACH_*` / `FOCUS_REMENTIONED`
  events, the decay (`applyStateTransition` / `applyCoachInaction` → no-op), the
  `lessons_since_mentioned` increment, the in-code cap-to-3, the reactivation
  mechanism (`applyReactivation` has no caller), the "validate covered" debrief
  feature (lists `past_candidate`, which nothing creates anymore).
- **`past_candidate` status** is dead (nothing transitions to it).
- **DB (this batch):** DROP the out-of-band cap-3 trigger `trg_enforce_cap_to_3_per_class`
  (migration `20260615e`).
- **Niveau 2 (later cleanup):** DROP columns `base_score`, `coach_signal`,
  `lessons_since_mentioned`, `last_exposed_at`, `reactivated`; DROP `focus_score_history`
  + its trigger; remove `monitor-report` base_score checks; remove/rework the two
  trainer screens `TrainerStudentsScreen` + `TrainerFocusHistoryScreen` (monitoring
  built on the score). `TrainerReviewScreen` (AI-output review) is unrelated — keep.

## Implementation surface (batched deploy)
- **Migrations:**
  - ADD `train_target int` to `focus_points` + `couple_focus_points`; backfill from
    tier (critical 3 else 2).
  - Change `get_lesson_readiness` + `get_couple_readiness` target from
    `CASE tier WHEN 'critical' THEN 3 ELSE 2` → the `train_target` column.
  - DROP cap-3 trigger (`20260615e`, staged).
- **`yoda-extract`:** cap `shared_focus_points` to 2 (group).
- **`yoda-score`:** seed `train_target` on create; `applyMerge` → KEEP `practice_count`
  + `train_target += 2` (no reset); the max-3 reconciliation + re-tier logic.
- **Coach debrief (`StartClassScreen.finishDebrief`):** default-retire untouched old
  FPs; "pas encore" → keep/carry; the max-3 reconciliation incl. the supporting
  coach-choice step.
- **Client (`algorithm.js`):** Niveau 1 score removal — staged.
- **Deploy:** `yoda-extract` + `yoda-score` together; apply migrations; reload app.

## Reconciliation surfacing & auto-resolution (decided)
- Surfaces as a **card in Action Needed** (coach) → opens `ReconcileFocusSheet`
  (built, matches the design). ALSO shown in the student's **"actions" subtab**
  (StudentDetailScreen) — done.
- The sheet is **multi-select**: the new **critical is always kept** (locked hero);
  the coach taps any of the others to remove and may end with **1 to 3** kept
  (handles 5+ when several were carried over). Confirm is enabled once kept ≤ 3;
  a live "keeping N" counter + a red error guide the coach. No preselection.
  Carried-over focuses show their post-keep target (+2) upfront (e.g. 1/4). Each
  focus has a "?" → popup with its concept (`context`).
- The Dashboard "Action Needed" badge is **RED** when a reconciliation is pending
  (it's important), even if there are no other pending items. (Done:
  `actionCounts.reconcile` → red.)
- The coach gets a **notification** when a reconciliation becomes needed (created
  server-side in `yoda-score` when a class leaves a student with >3 + supporting
  carryover). TODO (edge fn).
- **Auto-resolution** if the coach doesn't respond by the 18h auto-publish window:
  default = the carried-over focus **replaces the last (lowest) new focus point**
  (drop the new supporting, keep the carried-over), applied at the same moment the
  new focus points auto-publish. TODO (edge fn, in `publishExpiredFocusPoints`).
- Auto cases (kept-old critical/important) resolve **silently** server-side — no
  notification, no coach action.
