import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Fonts, Spacing } from '../theme';
import { supabase } from '../services/supabase/client';
import { clearUserCaches } from '../storage/userCaches';
import { clearPushToken } from '../services/notifications';

// ─── Constants ────────────────────────────────────────────────────────────────

const BG = '#0D0D12';
const CARD_BG = '#18181F';
const CARD_BORDER = 'rgba(255,255,255,0.08)';
const SECONDARY = 'rgba(255,255,255,0.45)';
const WHITE = '#FFFFFF';
const ORANGE = '#FF9D00';

const RATING_OPTIONS = [
  { value: 'good', label: 'Good', emoji: '👍', color: '#4CAF50' },
  { value: 'ok', label: 'OK', emoji: '😐', color: '#FF9D00' },
  { value: 'bad', label: 'Bad', emoji: '👎', color: '#E84040' },
];

const ACTION_BADGE = {
  create: { label: 'NEW FP', color: '#4CAF50' },
  auto_merge: { label: 'AUTO MERGE', color: '#2196F3' },
  merge_request: { label: 'MERGE REQUEST', color: '#FF9D00' },
  signal_positive: { label: 'SIGNAL +', color: '#4CAF50' },
  signal_negative: { label: 'SIGNAL -', color: '#E84040' },
};

// ─── FieldRatingSection ────────────────────────────────────────────────────────

const VERSION_FIELDS = [
  { key: 'title',    label: 'Title' },
  { key: 'subtitle', label: 'Subtitle' },
  { key: 'context',  label: 'Context' },
  { key: 'drill',    label: 'Drill' },
];

function FieldRatingSection({ fieldLabel, content, rating, onRatingChange, comment, onCommentChange }) {
  const showComment = rating === 'bad' || rating === 'ok';
  return (
    <View style={vStyles.fieldSection}>
      <Text style={vStyles.fieldLabel}>{fieldLabel}</Text>
      <Text style={vStyles.fieldContent}>{content}</Text>
      <View style={vStyles.ratingRow}>
        {RATING_OPTIONS.map(opt => {
          const active = rating === opt.value;
          return (
            <TouchableOpacity
              key={opt.value}
              style={[vStyles.ratingBtn, active && { borderColor: opt.color, backgroundColor: `${opt.color}18` }]}
              onPress={() => onRatingChange(active ? null : opt.value)}
              activeOpacity={0.75}
            >
              <Text style={vStyles.ratingEmoji}>{opt.emoji}</Text>
              <Text style={[vStyles.ratingLabel, active && { color: opt.color }]}>{opt.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {showComment && (
        <TextInput
          style={[vStyles.commentInput, { marginBottom: 4 }]}
          value={comment}
          onChangeText={onCommentChange}
          placeholder="Why? (optional)"
          placeholderTextColor="rgba(255,255,255,0.2)"
          multiline
          numberOfLines={2}
        />
      )}
    </View>
  );
}

// ─── VersionCard ──────────────────────────────────────────────────────────────

// ratings: { title: null|'good'|'ok'|'bad', subtitle: ..., context: ..., drill: ... }
// comments: { title: '', subtitle: '', ... }
function VersionCard({ version, label, ratings, onRatingChange, comments, onCommentChange }) {
  const presentFields = VERSION_FIELDS.filter(f => !!version[f.key]);

  return (
    <View style={vStyles.card}>
      <View style={vStyles.cardHeader}>
        <Text style={vStyles.labelBadge}>{label}</Text>
      </View>

      {!!version.reasoning && (
        <View style={vStyles.reasoningBox}>
          <Text style={vStyles.reasoningLabel}>Reasoning</Text>
          <Text style={vStyles.reasoningText}>{version.reasoning}</Text>
        </View>
      )}

      {Array.isArray(version.dance) && version.dance.length > 0 && (
        <View style={vStyles.danceRow}>
          {version.dance.map((d, i) => (
            <View key={i} style={vStyles.danceBadge}>
              <Text style={vStyles.danceBadgeText}>{d}</Text>
            </View>
          ))}
        </View>
      )}

      {presentFields.map(f => (
        <FieldRatingSection
          key={f.key}
          fieldLabel={f.label}
          content={version[f.key]}
          rating={ratings?.[f.key] ?? null}
          onRatingChange={(val) => onRatingChange(f.key, val)}
          comment={comments?.[f.key] ?? ''}
          onCommentChange={(val) => onCommentChange(f.key, val)}
        />
      ))}
    </View>
  );
}

// ─── CandidateReview ──────────────────────────────────────────────────────────

function CandidateReview({ candidate, onSubmit, onBack, isReviewed }) {
  const { versions } = candidate;

  // Per-version, per-field ratings: [{ title: null, subtitle: null, ... }, ...]
  const [ratings, setRatings] = useState(() => versions.map(() => ({})));
  const [comments, setComments] = useState(() => versions.map(() => ({})));
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(isReviewed ?? false);

  function setRating(vIdx, fieldKey, val) {
    setRatings(prev => {
      const n = [...prev];
      n[vIdx] = { ...n[vIdx], [fieldKey]: val };
      return n;
    });
  }

  function setComment(vIdx, fieldKey, val) {
    setComments(prev => {
      const n = [...prev];
      n[vIdx] = { ...n[vIdx], [fieldKey]: val };
      return n;
    });
  }

  // All fields that exist in each version must be rated
  const allRated = versions.every((version, i) => {
    const fields = VERSION_FIELDS.filter(f => !!version[f.key]);
    return fields.every(f => ratings[i]?.[f.key] != null);
  });

  async function handleSubmit() {
    if (!allRated || submitting) return;
    setSubmitting(true);
    await onSubmit(candidate.id, ratings, comments, versions);
    setSubmitting(false);
    setSubmitted(true);
  }

  const versionLabels = ['Chosen ✓', 'Alt 1', 'Alt 2'];

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={crStyles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Back */}
        <TouchableOpacity onPress={onBack} style={crStyles.backBtn} activeOpacity={0.7}>
          <Text style={crStyles.backBtnText}>← Back</Text>
        </TouchableOpacity>

        {/* Submitted banner */}
        {submitted && (
          <View style={crStyles.submittedBanner}>
            <Text style={crStyles.submittedBannerText}>✓ Feedback submitted</Text>
          </View>
        )}

        {/* Version cards */}
        {versions.map((version, i) => (
          <VersionCard
            key={i}
            version={version}
            label={versionLabels[i]}
            ratings={ratings[i]}
            onRatingChange={(fieldKey, val) => setRating(i, fieldKey, val)}
            comments={comments[i]}
            onCommentChange={(fieldKey, val) => setComment(i, fieldKey, val)}
          />
        ))}

        {/* Submit */}
        {!submitted && (
          <TouchableOpacity
            style={[crStyles.submitBtn, (!allRated || submitting) && crStyles.submitBtnDisabled]}
            onPress={handleSubmit}
            disabled={!allRated || submitting}
            activeOpacity={0.85}
          >
            {submitting
              ? <ActivityIndicator color={BG} size="small" />
              : <Text style={crStyles.submitBtnText}>Submit feedback</Text>
            }
          </TouchableOpacity>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ─── DecisionCard ─────────────────────────────────────────────────────────────

function DecisionCard({ decision, rating, onRatingChange, comment, onCommentChange }) {
  const showComment = rating === 'bad' || rating === 'ok';
  const badge = ACTION_BADGE[decision.action] ?? { label: decision.action.toUpperCase(), color: SECONDARY };

  return (
    <View style={vStyles.card}>
      <View style={vStyles.cardHeader}>
        <View style={[dcStyles.actionBadge, { borderColor: badge.color, backgroundColor: `${badge.color}18` }]}>
          <Text style={[dcStyles.actionBadgeText, { color: badge.color }]}>{badge.label}</Text>
        </View>
      </View>

      <Text style={vStyles.title}>{decision.fp_name}</Text>

      {!!decision.existing_fp_name && (
        <Text style={dcStyles.existingText}>→ existing: {decision.existing_fp_name}</Text>
      )}

      {!!decision.reasoning && (
        <View style={vStyles.reasoningBox}>
          <Text style={vStyles.reasoningLabel}>Reasoning</Text>
          <Text style={vStyles.reasoningText}>{decision.reasoning}</Text>
        </View>
      )}

      {/* Rating buttons */}
      <View style={vStyles.ratingRow}>
        {RATING_OPTIONS.map((opt) => {
          const active = rating === opt.value;
          return (
            <TouchableOpacity
              key={opt.value}
              style={[vStyles.ratingBtn, active && { borderColor: opt.color, backgroundColor: `${opt.color}18` }]}
              onPress={() => onRatingChange(active ? null : opt.value)}
              activeOpacity={0.75}
            >
              <Text style={vStyles.ratingEmoji}>{opt.emoji}</Text>
              <Text style={[vStyles.ratingLabel, active && { color: opt.color }]}>{opt.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {showComment && (
        <TextInput
          style={vStyles.commentInput}
          value={comment}
          onChangeText={onCommentChange}
          placeholder="Why? (optional)"
          placeholderTextColor="rgba(255,255,255,0.2)"
          multiline
          numberOfLines={2}
        />
      )}
    </View>
  );
}

// ─── DecisionReview ───────────────────────────────────────────────────────────

function DecisionReview({ scoreDecision, onSubmit, onSkip, currentIndex, total, reviewerId, classTitle }) {
  const { decisions } = scoreDecision;

  const [ratings, setRatings] = useState(() => decisions.map(() => null));
  const [comments, setComments] = useState(() => decisions.map(() => ''));
  const [submitting, setSubmitting] = useState(false);

  function setRating(idx, val) {
    setRatings(prev => { const n = [...prev]; n[idx] = val; return n; });
  }

  function setComment(idx, val) {
    setComments(prev => { const n = [...prev]; n[idx] = val; return n; });
  }

  const allRated = ratings.every(r => r !== null);

  async function handleSubmit() {
    if (!allRated || submitting) return;
    setSubmitting(true);
    await onSubmit(scoreDecision.id, ratings, comments);
    setSubmitting(false);
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={crStyles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Progress */}
        <View style={crStyles.progressRow}>
          <Text style={crStyles.progressText}>{currentIndex} of {total} remaining</Text>
          <TouchableOpacity onPress={onSkip} activeOpacity={0.6} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={crStyles.skipText}>Skip</Text>
          </TouchableOpacity>
        </View>

        {/* Student + class header */}
        <View style={dcStyles.studentHeader}>
          <Text style={dcStyles.studentName}>{scoreDecision.student_name ?? 'Student'}</Text>
          {!!classTitle && <Text style={dcStyles.classTitle}>{classTitle}</Text>}
        </View>

        {/* Decision cards */}
        {decisions.map((decision, i) => (
          <DecisionCard
            key={i}
            decision={decision}
            rating={ratings[i]}
            onRatingChange={(val) => setRating(i, val)}
            comment={comments[i]}
            onCommentChange={(val) => setComment(i, val)}
          />
        ))}

        {/* Submit */}
        <TouchableOpacity
          style={[crStyles.submitBtn, (!allRated || submitting) && crStyles.submitBtnDisabled]}
          onPress={handleSubmit}
          disabled={!allRated || submitting}
          activeOpacity={0.85}
        >
          {submitting
            ? <ActivityIndicator color={BG} size="small" />
            : <Text style={crStyles.submitBtnText}>Submit & Next</Text>
          }
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ─── SubmitTranscript ─────────────────────────────────────────────────────────

function SubmitTranscript() {
  const [coaches, setCoaches] = useState([]);
  const [students, setStudents] = useState([]);
  const [loadingCoaches, setLoadingCoaches] = useState(true);
  const [loadingStudents, setLoadingStudents] = useState(false);

  const [coachId, setCoachId] = useState('');
  const [lessonType, setLessonType] = useState('private');
  const [studentId, setStudentId] = useState('');
  const [date, setDate] = useState(new Date());
  const [transcript, setTranscript] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [lastResult, setLastResult] = useState(null); // { ok: bool, msg: string }

  // Load coaches on mount
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('users')
        .select('id, name, email')
        .eq('role', 'coach')
        .order('name');
      setCoaches(data ?? []);
      setLoadingCoaches(false);
    })();
  }, []);

  // Load students when coach changes — query via coach_requests so it works
  // even if latin_coach_id / ballroom_coach_id haven't been backfilled yet.
  useEffect(() => {
    if (!coachId) { setStudents([]); setStudentId(''); return; }
    setLoadingStudents(true);
    setStudentId('');
    (async () => {
      const { data } = await supabase
        .from('coach_requests')
        .select('student_id, users!coach_requests_student_id_fkey(id, name)')
        .eq('coach_id', coachId)
        .eq('status', 'accepted');
      const list = (data ?? [])
        .map(r => r.users)
        .filter(Boolean)
        .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      setStudents(list);
      setLoadingStudents(false);
    })();
  }, [coachId]);

  async function handleSubmit() {
    if (!coachId) { setLastResult({ ok: false, msg: 'Select a coach first.' }); return; }
    if (!transcript.trim()) { setLastResult({ ok: false, msg: 'Transcript is required.' }); return; }
    if (lessonType === 'private' && !studentId) { setLastResult({ ok: false, msg: 'Select a student for a private lesson.' }); return; }

    setSubmitting(true);
    setLastResult(null);
    try {
      const { data, error } = await supabase.rpc('trainer_insert_class_input', {
        p_coach_id:    coachId,
        p_lesson_type: lessonType,
        p_student_id:  (lessonType === 'private' && studentId) ? studentId : null,
        p_transcript:  transcript.trim(),
        p_created_at:  date.toISOString(),
      });

      if (error) throw error;

      setLastResult({ ok: true, msg: `✓ class_input created (${data})\n\nyoda-extract triggered. Focus points will appear for coach review within ~30s.` });
      setTranscript('');
      setStudentId('');
    } catch (e) {
      setLastResult({ ok: false, msg: e.message || 'Unknown error.' });
    }
    setSubmitting(false);
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={subStyles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Coach */}
        <Text style={subStyles.label}>Coach (user_id)</Text>
        {loadingCoaches ? (
          <ActivityIndicator color={ORANGE} style={{ marginBottom: 16 }} />
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={subStyles.pillRow}>
            {coaches.map(c => (
              <TouchableOpacity
                key={c.id}
                style={[subStyles.pill, coachId === c.id && subStyles.pillActive]}
                onPress={() => setCoachId(c.id)}
                activeOpacity={0.75}
              >
                <Text style={[subStyles.pillText, coachId === c.id && subStyles.pillTextActive]}>
                  {c.name || c.email}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}
        {!!coachId && (
          <Text style={subStyles.idHint} numberOfLines={1}>{coachId}</Text>
        )}

        {/* Lesson type */}
        <Text style={subStyles.label}>Lesson type</Text>
        <View style={subStyles.pillRow}>
          {['private', 'public'].map(t => (
            <TouchableOpacity
              key={t}
              style={[subStyles.pill, lessonType === t && subStyles.pillActive]}
              onPress={() => setLessonType(t)}
              activeOpacity={0.75}
            >
              <Text style={[subStyles.pillText, lessonType === t && subStyles.pillTextActive]}>
                {t === 'private' ? 'Private' : 'Group'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Student */}
        <Text style={subStyles.label}>
          Reference student{lessonType === 'public' ? ' (optional for group)' : ''}
        </Text>
        {loadingStudents ? (
          <ActivityIndicator color={ORANGE} style={{ marginBottom: 16 }} />
        ) : students.length === 0 ? (
          <Text style={subStyles.emptyStudents}>
            {coachId ? 'No linked students found.' : 'Select a coach to load students.'}
          </Text>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={subStyles.pillRow}>
            {students.map(s => (
              <TouchableOpacity
                key={s.id}
                style={[subStyles.pill, studentId === s.id && subStyles.pillActive]}
                onPress={() => setStudentId(prev => prev === s.id ? '' : s.id)}
                activeOpacity={0.75}
              >
                <Text style={[subStyles.pillText, studentId === s.id && subStyles.pillTextActive]}>
                  {s.name || s.id}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}
        {!!studentId && (
          <Text style={subStyles.idHint} numberOfLines={1}>{studentId}</Text>
        )}

        {/* Date */}
        <Text style={subStyles.label}>Date of class</Text>
        <DateTimePicker
          value={date}
          mode="date"
          display="spinner"
          textColor={WHITE}
          maximumDate={new Date()}
          onChange={(_, selected) => { if (selected) setDate(selected); }}
          style={subStyles.datePicker}
        />

        {/* Transcript */}
        <Text style={subStyles.label}>Transcript</Text>
        <TextInput
          style={subStyles.transcriptInput}
          value={transcript}
          onChangeText={setTranscript}
          placeholder={'[00:00 - 00:30] Speaker A: OK so today we\'re going to focus on...\n[00:30 - 01:15] Speaker A: Your hip action needs more settle...'}
          placeholderTextColor="rgba(255,255,255,0.2)"
          multiline
          textAlignVertical="top"
        />

        {/* Result */}
        {!!lastResult && (
          <View style={[subStyles.result, lastResult.ok ? subStyles.resultOk : subStyles.resultErr]}>
            <Text style={[subStyles.resultText, lastResult.ok ? subStyles.resultTextOk : subStyles.resultTextErr]}>
              {lastResult.msg}
            </Text>
          </View>
        )}

        {/* Submit */}
        <TouchableOpacity
          style={[subStyles.submitBtn, submitting && subStyles.submitBtnDisabled]}
          onPress={handleSubmit}
          disabled={submitting}
          activeOpacity={0.85}
        >
          {submitting
            ? <ActivityIndicator color={BG} size="small" />
            : <Text style={subStyles.submitBtnText}>Submit & trigger extraction</Text>
          }
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ─── ClassCard ────────────────────────────────────────────────────────────────

function ClassCard({ classGroup, onPress }) {
  const reviewed = classGroup.candidates.filter(c => c.reviewed).length;
  const total = classGroup.candidates.length;
  const allDone = reviewed === total;

  return (
    <TouchableOpacity style={clStyles.card} onPress={onPress} activeOpacity={0.78}>
      <View style={clStyles.cardBody}>
        <Text style={clStyles.title} numberOfLines={2}>{classGroup.title}</Text>
        <Text style={clStyles.date}>
          {new Date(classGroup.candidates[0]?.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
        </Text>
      </View>
      <View style={[clStyles.badge, allDone && clStyles.badgeDone]}>
        <Text style={[clStyles.badgeText, allDone && clStyles.badgeTextDone]}>
          {reviewed}/{total}
        </Text>
      </View>
      <Text style={clStyles.chevron}>›</Text>
    </TouchableOpacity>
  );
}

// ─── ClassFieldCard ───────────────────────────────────────────────────────────

function ClassFieldCard({ label, content, onPress, reviewed }) {
  if (!content) return null;
  return (
    <TouchableOpacity
      style={[fpStyles.card, reviewed && fpStyles.cardDone]}
      onPress={onPress}
      activeOpacity={0.78}
    >
      {reviewed && (
        <View style={fpStyles.doneBadge}>
          <Text style={fpStyles.doneBadgeText}>✓ Feedback submitted</Text>
        </View>
      )}
      <Text style={fpStyles.index}>{label}</Text>
      <Text style={fpStyles.title} numberOfLines={3}>{content}</Text>
      <Text style={fpStyles.tapHint}>{reviewed ? 'Tap to edit feedback' : 'Tap to review'}</Text>
    </TouchableOpacity>
  );
}

// ─── FieldReview ──────────────────────────────────────────────────────────────

function FieldReview({ label, content, classInputId, fieldName, reviewerId, onBack, initialReviewed, onFieldReviewed }) {
  const [rating, setRating] = useState(null);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(initialReviewed ?? false);

  async function handleSubmit() {
    if (!rating || submitting) return;
    setSubmitting(true);
    try {
      await supabase.from('ai_feedback').insert({
        class_input_id: classInputId,
        field_name: fieldName,
        version_index: 0,
        rating,
        comment: comment.trim() || null,
        reviewer_id: reviewerId,
      });
      setSubmitted(true);
      onFieldReviewed?.();
    } catch (e) {
      console.error('[FieldReview] submit error', e);
    }
    setSubmitting(false);
  }

  const showComment = rating === 'bad' || rating === 'ok';

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={crStyles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <TouchableOpacity onPress={onBack} style={crStyles.backBtn} activeOpacity={0.7}>
          <Text style={crStyles.backBtnText}>← Back</Text>
        </TouchableOpacity>

        {submitted && (
          <View style={crStyles.submittedBanner}>
            <Text style={crStyles.submittedBannerText}>✓ Feedback submitted</Text>
          </View>
        )}

        <View style={vStyles.card}>
          <Text style={fpStyles.index}>{label}</Text>
          <Text style={vStyles.title}>{content}</Text>
        </View>

        {!submitted && (
          <>
            <View style={vStyles.ratingRow}>
              {RATING_OPTIONS.map(opt => {
                const active = rating === opt.value;
                return (
                  <TouchableOpacity
                    key={opt.value}
                    style={[vStyles.ratingBtn, active && { borderColor: opt.color, backgroundColor: `${opt.color}18` }]}
                    onPress={() => setRating(active ? null : opt.value)}
                    activeOpacity={0.75}
                  >
                    <Text style={vStyles.ratingEmoji}>{opt.emoji}</Text>
                    <Text style={[vStyles.ratingLabel, active && { color: opt.color }]}>{opt.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            {showComment && (
              <TextInput
                style={[vStyles.commentInput, { marginBottom: 16 }]}
                value={comment}
                onChangeText={setComment}
                placeholder="Why? (optional)"
                placeholderTextColor="rgba(255,255,255,0.2)"
                multiline
                numberOfLines={2}
              />
            )}
            <TouchableOpacity
              style={[crStyles.submitBtn, (!rating || submitting) && crStyles.submitBtnDisabled]}
              onPress={handleSubmit}
              disabled={!rating || submitting}
              activeOpacity={0.85}
            >
              {submitting
                ? <ActivityIndicator color={BG} size="small" />
                : <Text style={crStyles.submitBtnText}>Submit feedback</Text>
              }
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ─── FocusPointCard ───────────────────────────────────────────────────────────

function FocusPointCard({ candidate, onPress }) {
  const chosen = candidate.versions?.[candidate.chosen_index ?? 0] ?? candidate.versions?.[0] ?? {};

  return (
    <TouchableOpacity
      style={[fpStyles.card, candidate.reviewed && fpStyles.cardDone]}
      onPress={onPress}
      activeOpacity={0.78}
    >
      {candidate.reviewed && (
        <View style={fpStyles.doneBadge}>
          <Text style={fpStyles.doneBadgeText}>✓ Feedback submitted</Text>
        </View>
      )}
      <Text style={fpStyles.index}>Focus point #{(candidate.focus_point_index ?? 0) + 1}</Text>
      <Text style={fpStyles.title} numberOfLines={2}>{chosen.title || '—'}</Text>
      <Text style={fpStyles.subtitle} numberOfLines={2}>{chosen.subtitle || ''}</Text>
      {Array.isArray(chosen.dance) && chosen.dance.length > 0 && (
        <View style={fpStyles.danceRow}>
          {chosen.dance.map((d, i) => (
            <View key={i} style={fpStyles.danceBadge}>
              <Text style={fpStyles.danceBadgeText}>{d}</Text>
            </View>
          ))}
        </View>
      )}
      <Text style={fpStyles.tapHint}>{candidate.reviewed ? 'Tap to edit feedback' : 'Tap to review alternatives'}</Text>
    </TouchableOpacity>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function TrainerReviewScreen({ navigation }) {
  const [activeTab, setActiveTab] = useState('extract');

  // Extract tab state
  const [candidates, setCandidates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [reviewerId, setReviewerId] = useState(null);
  const [sectionTitles, setSectionTitles] = useState({});

  // Extract tab navigation
  const [extractView, setExtractView] = useState('classList'); // 'classList' | 'focusList' | 'versionReview'
  const [selectedClassId, setSelectedClassId] = useState(null);
  const [selectedCandidate, setSelectedCandidate] = useState(null);
  const [selectedField, setSelectedField] = useState(null); // 'title' | 'class_summary' | null
  const [classInputData, setClassInputData] = useState(null); // { id, title, class_summary }
  const [reviewedFields, setReviewedFields] = useState({}); // { [classInputId]: { title?: bool, class_summary?: bool } }

  // Score tab state
  const [scoreDecisions, setScoreDecisions] = useState([]);
  const [scoreLoading, setScoreLoading] = useState(true);
  const [scoreCurrentIdx, setScoreCurrentIdx] = useState(0);
  const [scoreSectionTitles, setScoreSectionTitles] = useState({});

  useEffect(() => {
    loadCandidates();
    loadScoreDecisions();
  }, []);

  async function loadCandidates() {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user?.id) setReviewerId(session.user.id);

      const { data, error } = await supabase
        .from('ai_training_candidates')
        .select('id, class_input_id, student_id, focus_point_index, versions, chosen_index, created_at, reviewed')
        .order('created_at', { ascending: false });

      if (error) throw error;

      const items = data ?? [];
      setCandidates(items);

      // Load class titles
      const uniqueClassIds = [...new Set(items.map(c => c.class_input_id).filter(Boolean))];
      if (uniqueClassIds.length > 0) {
        const { data: classRows } = await supabase
          .from('class_inputs')
          .select('id, title')
          .in('id', uniqueClassIds);
        const titlesMap = {};
        for (const row of classRows ?? []) {
          titlesMap[row.id] = row.title || 'Untitled Class';
        }
        setSectionTitles(titlesMap);
      }
    } catch (err) {
      console.error('[TrainerReview] Load error:', err);
    }
    setLoading(false);
  }

  async function loadScoreDecisions() {
    setScoreLoading(true);
    try {
      const { data, error } = await supabase
        .from('yoda_score_decisions')
        .select('id, class_input_id, student_id, student_name, decisions, created_at')
        .eq('reviewed', false)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const items = data ?? [];
      setScoreDecisions(items);

      // Load class titles
      const uniqueClassIds = [...new Set(items.map(c => c.class_input_id).filter(Boolean))];
      if (uniqueClassIds.length > 0) {
        const { data: classRows } = await supabase
          .from('class_inputs')
          .select('id, title')
          .in('id', uniqueClassIds);
        const titlesMap = {};
        for (const row of classRows ?? []) {
          titlesMap[row.id] = row.title || 'Untitled Class';
        }
        setScoreSectionTitles(titlesMap);
      }
    } catch (err) {
      console.error('[TrainerReview] Score decisions load error:', err);
    }
    setScoreLoading(false);
  }

  async function handleSubmit(candidateId, ratings, comments, versions) {
    try {
      // One row per (version_index, field_name)
      const feedbackRows = versions.flatMap((version, versionIndex) =>
        VERSION_FIELDS
          .filter(f => !!version[f.key])
          .map(f => ({
            candidate_id:  candidateId,
            version_index: versionIndex,
            field_name:    f.key,
            rating:        ratings[versionIndex]?.[f.key],
            comment:       comments[versionIndex]?.[f.key]?.trim() || null,
            reviewer_id:   reviewerId,
          }))
      );

      const { error: feedbackError } = await supabase
        .from('ai_feedback')
        .insert(feedbackRows);

      if (feedbackError) throw feedbackError;

      const { error: updateError } = await supabase
        .from('ai_training_candidates')
        .update({ reviewed: true })
        .eq('id', candidateId);

      if (updateError) throw updateError;

      setCandidates(prev => prev.map(c => c.id === candidateId ? { ...c, reviewed: true } : c));
    } catch (err) {
      console.error('[TrainerReview] Submit error:', err);
    }
  }

  async function handleScoreSubmit(decisionId, ratings, comments) {
    try {
      const feedbackRows = ratings.map((rating, decisionIndex) => ({
        decision_id: decisionId,
        decision_index: decisionIndex,
        rating,
        comment: comments[decisionIndex]?.trim() || null,
        reviewer_id: reviewerId,
      }));

      const { error: feedbackError } = await supabase
        .from('yoda_score_feedback')
        .insert(feedbackRows);

      if (feedbackError) throw feedbackError;

      const { error: updateError } = await supabase
        .from('yoda_score_decisions')
        .update({ reviewed: true })
        .eq('id', decisionId);

      if (updateError) throw updateError;

      setScoreCurrentIdx(prev => prev + 1);
    } catch (err) {
      console.error('[TrainerReview] Score submit error:', err);
    }
  }

  function handleScoreSkip() {
    setScoreCurrentIdx(prev => prev + 1);
  }

  async function loadClassInputData(classInputId) {
    try {
      const [{ data: ciData }, { data: feedbackData }] = await Promise.all([
        supabase
          .from('class_inputs')
          .select('id, title, class_summary')
          .eq('id', classInputId)
          .single(),
        supabase
          .from('ai_feedback')
          .select('field_name')
          .eq('class_input_id', classInputId)
          .not('field_name', 'is', null),
      ]);
      setClassInputData(ciData ?? null);
      const reviewed = {};
      for (const row of feedbackData ?? []) {
        if (row.field_name) reviewed[row.field_name] = true;
      }
      setReviewedFields(prev => ({ ...prev, [classInputId]: reviewed }));
    } catch (err) {
      console.error('[TrainerReview] loadClassInputData error:', err);
    }
  }

  async function handleLogout() {
    await clearUserCaches();
    // Drop this device's push token before sign-out (shared-device hygiene).
    const { data: { session } } = await supabase.auth.getSession();
    clearPushToken(session?.user?.id);
    await supabase.auth.signOut();
  }

  const isLoading = loading || scoreLoading;

  if (isLoading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <ActivityIndicator color={ORANGE} size="large" />
        </View>
      </SafeAreaView>
    );
  }

  // Group candidates by class for Extract tab
  const classGroups = (() => {
    const groups = {};
    for (const c of candidates) {
      if (!groups[c.class_input_id]) {
        groups[c.class_input_id] = {
          classInputId: c.class_input_id,
          title: sectionTitles[c.class_input_id] || 'Untitled Class',
          candidates: [],
        };
      }
      groups[c.class_input_id].candidates.push(c);
    }
    return Object.values(groups).sort((a, b) =>
      (b.candidates[0]?.created_at ?? '').localeCompare(a.candidates[0]?.created_at ?? '')
    );
  })();

  const pendingCount = candidates.filter(c => !c.reviewed).length;
  const scoreRemaining = scoreDecisions.slice(scoreCurrentIdx);
  const currentScore = scoreRemaining[0];
  const scoreClassTitle = currentScore ? (scoreSectionTitles[currentScore.class_input_id] || 'Untitled Class') : '';

  const selectedClassCandidates = selectedClassId
    ? (classGroups.find(g => g.classInputId === selectedClassId)?.candidates ?? [])
    : [];

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Class Review</Text>
        <TouchableOpacity onPress={handleLogout} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={styles.logoutText}>Log out</Text>
        </TouchableOpacity>
      </View>

      {/* Tab switcher */}
      <View style={tabStyles.tabRow}>
        <TouchableOpacity
          style={[tabStyles.tabPill, activeTab === 'extract' && tabStyles.tabPillActive]}
          onPress={() => { setActiveTab('extract'); setExtractView('classList'); }}
          activeOpacity={0.75}
        >
          <Text style={[tabStyles.tabPillText, activeTab === 'extract' && tabStyles.tabPillTextActive]}>
            Extract{pendingCount > 0 ? ` ${pendingCount}` : ''}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[tabStyles.tabPill, activeTab === 'score' && tabStyles.tabPillActive]}
          onPress={() => setActiveTab('score')}
          activeOpacity={0.75}
        >
          <Text style={[tabStyles.tabPillText, activeTab === 'score' && tabStyles.tabPillTextActive]}>
            Score{scoreRemaining.length > 0 ? ` ${scoreRemaining.length}` : ''}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[tabStyles.tabPill, activeTab === 'submit' && tabStyles.tabPillActive]}
          onPress={() => setActiveTab('submit')}
          activeOpacity={0.75}
        >
          <Text style={[tabStyles.tabPillText, activeTab === 'submit' && tabStyles.tabPillTextActive]}>
            Submit
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={tabStyles.tabPill}
          onPress={() => navigation.navigate('TrainerStudents')}
          activeOpacity={0.75}
        >
          <Text style={tabStyles.tabPillText}>Students</Text>
        </TouchableOpacity>
      </View>

      {activeTab === 'extract' ? (
        extractView === 'classList' ? (
          /* ── Level 1: Class list ── */
          classGroups.length === 0 ? (
            <View style={styles.center}>
              <Text style={styles.doneEmoji}>✓</Text>
              <Text style={styles.doneTitle}>All caught up!</Text>
              <Text style={styles.doneSubtitle}>No focus points to review.</Text>
              <TouchableOpacity style={styles.refreshBtn} onPress={loadCandidates} activeOpacity={0.8}>
                <Text style={styles.refreshBtnText}>Refresh</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <ScrollView contentContainerStyle={clStyles.list} showsVerticalScrollIndicator={false}>
              {classGroups.map(group => (
                <ClassCard
                  key={group.classInputId}
                  classGroup={group}
                  onPress={() => {
                    setSelectedClassId(group.classInputId);
                    setClassInputData(null);
                    loadClassInputData(group.classInputId);
                    setExtractView('focusList');
                  }}
                />
              ))}
            </ScrollView>
          )
        ) : extractView === 'focusList' ? (
          /* ── Level 2: Focus points for a class ── */
          <ScrollView contentContainerStyle={clStyles.list} showsVerticalScrollIndicator={false}>
            <TouchableOpacity onPress={() => { setExtractView('classList'); setSelectedClassId(null); setClassInputData(null); }} style={crStyles.backBtn} activeOpacity={0.7}>
              <Text style={crStyles.backBtnText}>← All classes</Text>
            </TouchableOpacity>
            <Text style={clStyles.classHeader}>
              {sectionTitles[selectedClassId] || 'Untitled Class'}
            </Text>

            {/* Class-level fields: title + class_summary */}
            {!!classInputData?.title && (
              <ClassFieldCard
                label="Title"
                content={classInputData.title}
                reviewed={!!(reviewedFields[selectedClassId]?.title)}
                onPress={() => {
                  setSelectedField('title');
                  setSelectedCandidate(null);
                  setExtractView('versionReview');
                }}
              />
            )}
            {!!classInputData?.class_summary && (
              <ClassFieldCard
                label="Class Summary"
                content={classInputData.class_summary}
                reviewed={!!(reviewedFields[selectedClassId]?.class_summary)}
                onPress={() => {
                  setSelectedField('class_summary');
                  setSelectedCandidate(null);
                  setExtractView('versionReview');
                }}
              />
            )}

            {/* Focus point candidates */}
            {selectedClassCandidates
              .sort((a, b) => (a.focus_point_index ?? 0) - (b.focus_point_index ?? 0))
              .map(candidate => (
                <FocusPointCard
                  key={candidate.id}
                  candidate={candidate}
                  onPress={() => {
                    setSelectedCandidate(candidate);
                    setSelectedField(null);
                    setExtractView('versionReview');
                  }}
                />
              ))}
          </ScrollView>
        ) : (
          /* ── Level 3: Version review ── */
          selectedField ? (
            <FieldReview
              key={selectedField}
              label={selectedField === 'title' ? 'Title' : 'Class Summary'}
              content={selectedField === 'title' ? classInputData?.title : classInputData?.class_summary}
              classInputId={selectedClassId}
              fieldName={selectedField}
              reviewerId={reviewerId}
              initialReviewed={!!(reviewedFields[selectedClassId]?.[selectedField])}
              onFieldReviewed={() => {
                setReviewedFields(prev => ({
                  ...prev,
                  [selectedClassId]: { ...(prev[selectedClassId] ?? {}), [selectedField]: true },
                }));
              }}
              onBack={() => {
                setSelectedField(null);
                setExtractView('focusList');
              }}
            />
          ) : (
            <CandidateReview
              key={selectedCandidate?.id}
              candidate={selectedCandidate}
              isReviewed={candidates.find(c => c.id === selectedCandidate?.id)?.reviewed ?? false}
              onSubmit={handleSubmit}
              onBack={() => {
                setSelectedCandidate(null);
                setExtractView('focusList');
              }}
            />
          )
        )
      ) : activeTab === 'score' ? (
        scoreRemaining.length === 0 ? (
          <View style={styles.center}>
            <Text style={styles.doneEmoji}>✓</Text>
            <Text style={styles.doneTitle}>All caught up!</Text>
            <Text style={styles.doneSubtitle}>No pending score decisions to review.</Text>
            <TouchableOpacity style={styles.refreshBtn} onPress={loadScoreDecisions} activeOpacity={0.8}>
              <Text style={styles.refreshBtnText}>Refresh</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <DecisionReview
            key={currentScore.id}
            scoreDecision={currentScore}
            onSubmit={handleScoreSubmit}
            onSkip={handleScoreSkip}
            currentIndex={scoreRemaining.length}
            total={scoreDecisions.length}
            reviewerId={reviewerId}
            classTitle={scoreClassTitle}
          />
        )
      ) : (
        <SubmitTranscript />
      )}
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: BG,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.side,
    paddingVertical: 14,
  },
  headerTitle: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 16,
    color: WHITE,
    letterSpacing: -0.2,
  },
  logoutText: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 13,
    color: SECONDARY,
  },
  classTitleRow: {
    paddingHorizontal: Spacing.side,
    paddingBottom: 8,
  },
  classTitleText: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 12,
    color: ORANGE,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.side,
  },
  doneEmoji: {
    fontSize: 48,
    marginBottom: 16,
    color: '#4CAF50',
  },
  doneTitle: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 22,
    color: WHITE,
    marginBottom: 8,
    letterSpacing: -0.3,
  },
  doneSubtitle: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 14,
    color: SECONDARY,
    textAlign: 'center',
    marginBottom: 32,
  },
  refreshBtn: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: CARD_BORDER,
  },
  refreshBtnText: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 14,
    color: WHITE,
  },
});

const tabStyles = StyleSheet.create({
  tabRow: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.side,
    paddingBottom: 12,
    gap: 8,
  },
  tabPill: {
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  tabPillActive: {
    backgroundColor: ORANGE,
    borderColor: ORANGE,
  },
  tabPillText: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 13,
    color: SECONDARY,
  },
  tabPillTextActive: {
    color: BG,
  },
  tabBadge: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 13,
  },
});

const crStyles = StyleSheet.create({
  scrollContent: {
    paddingHorizontal: Spacing.side,
    paddingBottom: 40,
  },
  backBtn: {
    marginBottom: 16,
  },
  backBtnText: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 13,
    color: SECONDARY,
  },
  submittedBanner: {
    backgroundColor: 'rgba(76,175,80,0.12)',
    borderWidth: 0.5,
    borderColor: 'rgba(76,175,80,0.3)',
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    alignItems: 'center',
  },
  submittedBannerText: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 14,
    color: '#4CAF50',
  },
  submitBtn: {
    backgroundColor: ORANGE,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  submitBtnDisabled: {
    opacity: 0.35,
  },
  submitBtnText: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 15,
    color: BG,
  },
});

const dcStyles = StyleSheet.create({
  actionBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    overflow: 'hidden',
  },
  actionBadgeText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  existingText: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 13,
    color: SECONDARY,
    marginBottom: 10,
    fontStyle: 'italic',
  },
  studentHeader: {
    marginBottom: 16,
  },
  studentName: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 18,
    color: WHITE,
    letterSpacing: -0.3,
    marginBottom: 2,
  },
  classTitle: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 12,
    color: ORANGE,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
});

const clStyles = StyleSheet.create({
  list: {
    paddingHorizontal: Spacing.side,
    paddingBottom: 48,
  },
  classHeader: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 18,
    color: WHITE,
    letterSpacing: -0.3,
    marginBottom: 16,
    marginTop: 4,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: CARD_BG,
    borderWidth: 0.5,
    borderColor: CARD_BORDER,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    gap: 12,
  },
  cardBody: { flex: 1 },
  title: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 15,
    color: WHITE,
    marginBottom: 4,
    letterSpacing: -0.2,
  },
  date: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 12,
    color: SECONDARY,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    backgroundColor: 'rgba(255,157,0,0.12)',
    borderWidth: 0.5,
    borderColor: 'rgba(255,157,0,0.3)',
  },
  badgeDone: {
    backgroundColor: 'rgba(76,175,80,0.12)',
    borderColor: 'rgba(76,175,80,0.3)',
  },
  badgeText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 13,
    color: ORANGE,
  },
  badgeTextDone: {
    color: '#4CAF50',
  },
  chevron: {
    fontSize: 22,
    color: SECONDARY,
  },
});

const fpStyles = StyleSheet.create({
  card: {
    backgroundColor: CARD_BG,
    borderWidth: 0.5,
    borderColor: CARD_BORDER,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  cardDone: {
    borderColor: 'rgba(76,175,80,0.25)',
  },
  doneBadge: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(76,175,80,0.12)',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginBottom: 10,
  },
  doneBadgeText: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 11,
    color: '#4CAF50',
  },
  index: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 10,
    color: SECONDARY,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  title: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 18,
    color: WHITE,
    letterSpacing: -0.3,
    marginBottom: 4,
  },
  subtitle: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 13,
    color: SECONDARY,
    lineHeight: 19,
    marginBottom: 10,
  },
  danceRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 10,
  },
  danceBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 0.5,
    borderColor: CARD_BORDER,
  },
  danceBadgeText: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 11,
    color: SECONDARY,
  },
  tapHint: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 11,
    color: 'rgba(255,255,255,0.2)',
    fontStyle: 'italic',
  },
});

const subStyles = StyleSheet.create({
  content: {
    paddingHorizontal: Spacing.side,
    paddingBottom: 48,
  },
  label: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 10,
    color: SECONDARY,
    textTransform: 'uppercase',
    letterSpacing: 0.9,
    marginTop: 20,
    marginBottom: 10,
  },
  pillRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'nowrap',
  },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 0.5,
    borderColor: CARD_BORDER,
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  pillActive: {
    backgroundColor: ORANGE,
    borderColor: ORANGE,
  },
  pillText: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 13,
    color: SECONDARY,
  },
  pillTextActive: {
    color: BG,
  },
  idHint: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 10,
    color: 'rgba(255,255,255,0.2)',
    marginTop: 6,
  },
  emptyStudents: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 13,
    color: SECONDARY,
    fontStyle: 'italic',
    marginBottom: 4,
  },
  datePicker: {
    width: '100%',
    height: 140,
  },
  transcriptInput: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 0.5,
    borderColor: CARD_BORDER,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: Fonts.jakartaRegular,
    fontSize: 13,
    color: WHITE,
    minHeight: 220,
    lineHeight: 20,
    textAlignVertical: 'top',
  },
  result: {
    marginTop: 16,
    padding: 14,
    borderRadius: 12,
    borderWidth: 0.5,
  },
  resultOk: {
    backgroundColor: 'rgba(76,175,80,0.12)',
    borderColor: 'rgba(76,175,80,0.3)',
  },
  resultErr: {
    backgroundColor: 'rgba(232,64,64,0.12)',
    borderColor: 'rgba(232,64,64,0.3)',
  },
  resultText: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 13,
    lineHeight: 20,
  },
  resultTextOk: { color: '#4CAF50' },
  resultTextErr: { color: '#E84040' },
  submitBtn: {
    backgroundColor: ORANGE,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 24,
  },
  submitBtnDisabled: { opacity: 0.35 },
  submitBtnText: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 15,
    color: BG,
  },
});

const vStyles = StyleSheet.create({
  card: {
    backgroundColor: CARD_BG,
    borderWidth: 0.5,
    borderColor: CARD_BORDER,
    borderRadius: 18,
    padding: 18,
    marginBottom: 14,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  labelBadge: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 10,
    color: SECONDARY,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 0.5,
    borderColor: CARD_BORDER,
    overflow: 'hidden',
  },
  title: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 22,
    color: WHITE,
    marginBottom: 5,
    letterSpacing: -0.4,
  },
  subtitle: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 14,
    color: 'rgba(255,255,255,0.85)',
    marginBottom: 10,
    lineHeight: 20,
  },
  context: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 13,
    color: SECONDARY,
    lineHeight: 19,
    marginBottom: 10,
  },
  reasoningBox: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 10,
    borderLeftWidth: 2,
    borderLeftColor: 'rgba(255,157,0,0.4)',
  },
  reasoningLabel: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 9,
    color: 'rgba(255,157,0,0.6)',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 3,
  },
  reasoningText: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 12,
    color: 'rgba(255,255,255,0.5)',
    lineHeight: 17,
    fontStyle: 'italic',
  },
  drill: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 12,
    color: 'rgba(255,157,0,0.7)',
    fontStyle: 'italic',
    marginBottom: 10,
    lineHeight: 17,
  },
  danceRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 14,
  },
  danceBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 0.5,
    borderColor: CARD_BORDER,
  },
  danceBadgeText: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 11,
    color: SECONDARY,
  },
  ratingRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 4,
  },
  ratingBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  ratingEmoji: {
    fontSize: 14,
  },
  ratingLabel: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 12,
    color: SECONDARY,
  },
  commentInput: {
    marginTop: 10,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 0.5,
    borderColor: CARD_BORDER,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: Fonts.jakartaRegular,
    fontSize: 13,
    color: WHITE,
    textAlignVertical: 'top',
    minHeight: 56,
  },
  // Per-field rating section inside a VersionCard
  fieldSection: {
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 0.5,
    borderTopColor: 'rgba(255,255,255,0.07)',
  },
  fieldLabel: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 9,
    color: ORANGE,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 6,
    opacity: 0.8,
  },
  fieldContent: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 13,
    color: WHITE,
    lineHeight: 19,
    marginBottom: 10,
  },
});
