import {
  extractPrimaryFocus,
  extractSecondaryFocus,
  generateClassTitle,
  generateCoachingSummary,
} from './ai/anthropic';
import {
  saveClassInput,
  getFocusPoints,
  getRecentClassInputs,
  updateUserSummary,
  invalidateCache,
} from '../storage/storage';
import { supabase } from './supabase/client';

export async function processClassDraft(draft) {
  const {
    class_summary,
    practicePoint1,
    priorityScore1,
    showDrill,
    drill,
    showSecond,
    practicePoint2,
    priorityScore2,
    showDrill2,
    drill2,
    lessonType,
    selectedDances,
    teacherName,
    createdAt,
  } = draft;

  const existingPoints = await getFocusPoints();
  const existingNames = existingPoints.map((p) => p.name);
  const pp2 = showSecond && practicePoint2?.trim() ? practicePoint2 : null;

  const [primaryFocus, secondaryFocus, title] = await Promise.all([
    extractPrimaryFocus({ practicePoint1, priorityScore1, existingNames }),
    pp2
      ? extractSecondaryFocus({ practicePoint2: pp2, priorityScore2: showSecond ? priorityScore2 : null, existingNames })
      : Promise.resolve(null),
    generateClassTitle(class_summary, practicePoint1),
  ]);

  const primaryFocusName = primaryFocus?.name || null;
  const secondaryFocusName = secondaryFocus?.name || null;

  const drill1Value = showDrill ? drill?.trim() || null : null;
  const drill2Value = showDrill2 ? drill2?.trim() || null : null;

  const classInputId = await saveClassInput({
    title,
    class_summary: class_summary?.trim() || null,
    practice_point_1: practicePoint1,
    priority_score_1: priorityScore1,
    practice_point_2: pp2,
    priority_score_2: showSecond ? priorityScore2 : null,
    ai_primary_focus: primaryFocusName || null,
    ai_secondary_focus: secondaryFocusName || null,
    lesson_type: lessonType,
    dance: selectedDances?.length > 0 ? selectedDances.join(', ') : null,
    teacher_name: teacherName?.trim() || null,
    created_at: createdAt,
  });

  // Server creates focus_points as pending_coach (or active if no linked coach)
  // and notifies the coach. This is the single source of truth.
  if (classInputId) {
    const focuses = [
      primaryFocusName
        ? {
            name: primaryFocusName,
            subtitle: primaryFocus?.subtitle || null,
            context: primaryFocus?.context || null,
            priority_score: priorityScore1,
            drill: drill1Value,
          }
        : null,
      pp2 && secondaryFocusName
        ? {
            name: secondaryFocusName,
            subtitle: secondaryFocus?.subtitle || null,
            context: secondaryFocus?.context || null,
            priority_score: showSecond ? priorityScore2 : null,
            drill: drill2Value,
          }
        : null,
    ].filter(Boolean);

    const { error: fnErr } = await supabase.functions.invoke('student-class-score', {
      body: { class_input_id: classInputId, focuses },
    });
    if (fnErr) {
      let serverBody = null;
      try {
        serverBody = await fnErr.context?.json?.();
      } catch {
        try { serverBody = await fnErr.context?.text?.(); } catch {}
      }
      console.warn('[classSubmission] student-class-score invoke failed:', fnErr, 'body:', serverBody);
      throw fnErr;
    }
    invalidateCache('classInputs');
  }

  // Background: coaching summary + nudge refresh
  getRecentClassInputs(3).then((recent) =>
    generateCoachingSummary(recent).then(updateUserSummary).catch(() => {})
  );
  import('../utils/algorithm').then(({ refreshNudgeMessage }) =>
    refreshNudgeMessage().catch(() => {})
  );
}
