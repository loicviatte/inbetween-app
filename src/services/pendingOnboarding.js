// The part of onboarding that needs a signed-in account — a coach's new studio
// and card, a parent's child, a student's coach request, weekly goal and
// recalled focus points. Onboarding does it right after sign-up when sign-up
// returns a session. When email confirmation holds the session back, the same
// answers ride in the account's metadata (pending_onboarding) and are applied
// here at the first sign-in, instead of being lost.
import { supabase } from './supabase/client';
import { giveHealthConsent } from './healthConsent';
import { recordAccountConsent } from './consentRecord';

const running = new Set();

// Sign-up signs in (and App.js hears it) before the onboarding screen gets its
// session back: while the screen is doing these steps itself, hands off.
let heldByScreen = false;
export function holdPendingOnboarding(on) { heldByScreen = !!on; }

export async function applyPendingOnboarding(session) {
  const plan = session?.user?.user_metadata?.pending_onboarding;
  const userId = session?.user?.id;
  if (!plan || !userId || heldByScreen || running.has(userId)) return;
  running.add(userId);
  try {
    // Cleared first: whatever happens below, it runs once.
    const { error: clearErr } = await supabase.auth.updateUser({ data: { pending_onboarding: null } });
    if (clearErr) return;

    // Health-data permission, given at sign-up before the session existed. The
    // version travels with it: the wording that was on screen then is the one
    // that was agreed to, even if the app has since changed it.
    if (plan.healthConsentAt) {
      await giveHealthConsent(userId, plan.healthConsentAt, plan.healthConsentVersion ?? null);
    }
    // The three statements as they were shown, stamped with the moment they
    // were ticked rather than the moment the session finally arrived.
    if (plan.accountChecksAcceptedAt) {
      await recordAccountConsent({
        userId,
        isCoach: plan.role === 'coach',
        role: plan.role,
        acceptedAt: plan.accountChecksAcceptedAt,
      });
    }

    if (plan.role === 'coach') {
      let studioId = plan.studioId || null;
      if (plan.createStudio) {
        const { data: made } = await supabase
          .from('studios').insert({ name: plan.createStudio, created_by: userId }).select('id').maybeSingle();
        if (made?.id) studioId = made.id;
      }
      await supabase.from('users').update({ dance_style: plan.style, studio_id: studioId }).eq('id', userId);
      if (plan.card) {
        const { saveCoachCard } = require('../storage/coachCardStorage');
        await saveCoachCard(userId, plan.card);
      }
      return;
    }

    if (plan.child) {
      const { createChildAccount } = require('./childAccount');
      const { error } = await createChildAccount(plan.child);
      // If it fails the parent still has Stats ▸ Settings ▸ Add a child.
      if (!error) {
        const { clearSubjectCache, invalidateCache } = require('../storage/storage');
        clearSubjectCache();
        invalidateCache();
      }
      return;
    }

    if (plan.student) {
      const s = plan.student;
      await supabase.from('users').update({
        lessons_per_month: s.lessons, solo_practice_frequency: s.soloLabel, weekly_goal_minutes: s.weeklyGoal,
      }).eq('id', userId);
      if (s.coachId && s.cats?.length) {
        await supabase.from('coach_requests').insert(
          s.cats.map((category) => ({ student_id: userId, coach_id: s.coachId, status: 'pending', category })),
        );
      }
      if (s.focus?.length) {
        const { saveOnboardingFocusPoints } = require('./ai/onboardingRecall');
        await saveOnboardingFocusPoints(userId, s.focus);
      }
    }
  } catch (e) {
    console.warn('[onboarding] pending steps not applied:', e?.message || e);
  } finally {
    running.delete(userId);
  }
}
