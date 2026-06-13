# Train page — Couple redesign (design reference)

Source: user-provided HTML/CSS prototype + screenshot ("Prop 2 — solo gold · couple blue").
This is the target for the Train page (`src/screens/HomeScreen.js`), M4 frontend.

## Design language
- **Solo = gold** on a **black hero** card. **Couple = blue** card.
- Accent gold `#E8B530` / `#F0C24A`; couple blue `#2E4670` (deep) → `#16243c`, light `#4A6A9A`.
- Screen bg: warm radial cream (`#F9DF9B → #F7F6F3 → #EDEBE4`). Existing theme.

## Layout (top → bottom)
1. **Topbar**: bell (with unread dot) + avatar. (existing)
2. **Solo hero** (black, primary/expanded):
   - Pill `● SOLO · FOCUS` (white translucent) + small solo avatar top-right.
   - Big title (focus name, ~32px DemiBold), `your focus · {min} min`, description (~3 lines).
   - **Swipe dots** (gold active, elongated) = cycle through the solo focuses (slot1/2/3 → carousel) + "SWIPE »" hint.
   - **Start Now** CTA (gold, dark text, arrow).
3. **Couple card** (blue, secondary/collapsed):
   - Pair avatar stack (my avatar + partner initial) + label `COUPLE · WITH {NAME}` + current couple focus title.
   - **Expand** button = round chevron-down (white translucent, NOT gold) → expands couple (becomes primary) and collapses solo.
   - Swipe dots (blue active `#8fb0dd`) = cycle couple focuses.
   - Collapsed = NO Start button; expanding reveals description + Start (blue CTA).
4. **Get ready · next private** card (light):
   - **Concentric readiness ring**: OUTER ring = **couple readiness** (blue `#2E4670`), INNER ring = **solo readiness** (gold `#E8B530`). Tracks are faint grey.
   - Eyebrow `GET READY · NEXT PRIVATE`.
   - Right: solo avatar (gold halo) + couple pair (blue halo) + chevron.
5. **This week** heatmap + 3 stats (Training / Class / Focus trained). (existing)

## Behaviors
- **Accordion**: primary card is large on top, secondary small below; tapping the small card's expand swaps which is primary (most-trained-in-2-weeks decides the initial primary — `mostTrainedMode`).
- **Couple card only shows if paired.** If paired but no couple focus points → empty state "attend your couple private lesson".
- Couple card style follows the latin/ballroom toggle (couple FP filtered by style like solo).
- Swipe within a card navigates that mode's focus points (does not switch mode).

## Data needed (M4 backend)
- `getMyCouple()` (done, coupleStorage) → partner name/avatar for the label + pair stack.
- `getCoupleSlots(category)` → couple focuses carousel (mirror `getSlots`).
- `getLessonReadiness(userId, category)` → per-style solo readiness (inner gold ring).
- `getCoupleReadiness(coupleId, category)` → couple readiness (outer blue ring).
- `mostTrainedMode(category)` → 'solo' | 'couple' for initial primary (last-14-day counts).
