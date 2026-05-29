import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Colors, Fonts } from '../theme';

const ATTENDANCE_TYPES = new Set(['attendance_check', 'group_class_attendance']);

const TYPE_LABELS = {
  coach_request_accepted: { label: 'Request',  color: '#34C759' },
  coach_request_declined: { label: 'Request',  color: '#FF3B30' },
  attendance_check:       { label: 'Attendance', color: Colors.orange },
  group_class_attendance: { label: 'Attendance', color: Colors.orange },
  focus_points_added:     { label: 'Review',   color: Colors.orange },
  focus_point_added:      { label: 'Review',   color: Colors.orange },
  focus_point_rejected:   { label: 'Declined', color: '#FF3B30' },
  merge_request:          { label: 'Merge',    color: '#5788E6' },
  merge_request_student:  { label: 'Merge',    color: '#5788E6' },
  name_match_confirm:     { label: 'Name match', color: '#FF9500' },
};

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

export default function NotificationDetailSheet({ notif, priorAttendance, onClose, onAttendanceChange }) {
  if (!notif) return null;

  const isAttendance = ATTENDANCE_TYPES.has(notif.type);

  return (
    <View style={s.overlay}>
      <TouchableOpacity style={s.backdrop} activeOpacity={1} onPress={onClose} />
      <View style={s.sheet}>
        <View style={s.handle} />
        {isAttendance ? (
          <AttendanceEditView
            notif={notif}
            priorAttendance={priorAttendance}
            onChange={onAttendanceChange}
            onClose={onClose}
          />
        ) : (
          <ReadOnlyView notif={notif} onClose={onClose} />
        )}
      </View>
    </View>
  );
}

function ReadOnlyView({ notif, onClose }) {
  const config = TYPE_LABELS[notif.type] ?? { label: 'Notification', color: Colors.secondary };
  return (
    <View>
      <Text style={[s.category, { color: config.color }]}>{config.label}</Text>
      <Text style={s.title}>{notif.title}</Text>
      {!!notif.body && <Text style={s.body}>{notif.body}</Text>}
      <TouchableOpacity style={s.closeBtn} onPress={onClose} activeOpacity={0.85}>
        <Text style={s.closeText}>Got it</Text>
      </TouchableOpacity>
    </View>
  );
}

function AttendanceEditView({ notif, priorAttendance, onChange, onClose }) {
  const [submitting, setSubmitting] = useState(false);
  const [pendingAnswer, setPendingAnswer] = useState(null);
  const coachName = notif.data?.coach_name ?? 'your coach';
  const classDate = notif.data?.lesson_date ?? notif.data?.class_date;
  const hasPrior = typeof priorAttendance === 'boolean';

  async function applyChange(newAnswer) {
    setSubmitting(true);
    setPendingAnswer(newAnswer);
    try {
      await onChange(newAnswer);
    } catch (e) {
      Alert.alert('Error', String(e?.message ?? e));
      setSubmitting(false);
      setPendingAnswer(null);
      return;
    }
    setSubmitting(false);
    onClose();
  }

  function handleTap(newAnswer) {
    if (submitting) return;
    if (hasPrior && priorAttendance === newAnswer) return;
    if (hasPrior && priorAttendance === true && newAnswer === false) {
      Alert.alert(
        'Are you sure?',
        'The focus points your coach assigned from this class will be removed.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Remove', style: 'destructive', onPress: () => applyChange(false) },
        ],
      );
      return;
    }
    applyChange(newAnswer);
  }

  return (
    <View>
      <Text style={[s.category, { color: Colors.orange }]}>Attendance</Text>
      <Text style={s.title}>Were you at {coachName}'s group class?</Text>
      {!!classDate && <Text style={s.date}>{formatDate(classDate)}</Text>}

      {hasPrior && (
        <View style={s.priorRow}>
          <Ionicons
            name={priorAttendance ? 'checkmark-circle' : 'close-circle'}
            size={16}
            color={priorAttendance ? '#34C759' : '#9A9A9A'}
          />
          <Text style={s.priorText}>
            You said: <Text style={s.priorBold}>{priorAttendance ? 'Yes, I was there' : 'No, I wasn’t'}</Text>
          </Text>
        </View>
      )}

      <View style={s.buttons}>
        <AnswerButton
          label="Yes, I was there"
          isCurrent={priorAttendance === true}
          loading={submitting && pendingAnswer === true}
          disabled={submitting}
          onPress={() => handleTap(true)}
        />
        <AnswerButton
          label="No, I wasn't"
          isCurrent={priorAttendance === false}
          loading={submitting && pendingAnswer === false}
          disabled={submitting}
          onPress={() => handleTap(false)}
          secondary
        />
      </View>

      <TouchableOpacity onPress={onClose} disabled={submitting} style={s.cancelBtn} activeOpacity={0.7}>
        <Text style={s.cancelText}>Close</Text>
      </TouchableOpacity>
    </View>
  );
}

function AnswerButton({ label, isCurrent, loading, disabled, onPress, secondary }) {
  const baseStyle = secondary ? s.btnSecondary : s.btnPrimary;
  const baseTextStyle = secondary ? s.btnSecondaryText : s.btnPrimaryText;
  const dim = isCurrent ? { opacity: 0.4 } : null;
  return (
    <TouchableOpacity
      style={[s.btn, baseStyle, dim]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.85}
    >
      {loading ? (
        <ActivityIndicator color={secondary ? Colors.secondary : '#fff'} />
      ) : (
        <View style={s.btnInner}>
          <Text style={baseTextStyle}>{label}</Text>
          {isCurrent && (
            <Text style={[baseTextStyle, s.currentTag]}>· current</Text>
          )}
        </View>
      )}
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 12,
    paddingHorizontal: 22,
    paddingBottom: 32,
  },
  handle: {
    alignSelf: 'center',
    width: 44,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E5E5E5',
    marginBottom: 18,
  },
  category: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 10,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  title: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 20,
    color: Colors.black,
    letterSpacing: -0.3,
    lineHeight: 27,
    marginBottom: 8,
  },
  date: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 13,
    color: Colors.orange,
    marginBottom: 4,
  },
  body: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 14.5,
    color: '#5C6370',
    lineHeight: 21,
    marginTop: 4,
    marginBottom: 24,
  },
  priorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
    marginBottom: 18,
  },
  priorText: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 13.5,
    color: Colors.secondary,
  },
  priorBold: {
    fontFamily: Fonts.jakartaBold,
    color: Colors.black,
  },
  buttons: {
    gap: 10,
    marginBottom: 12,
  },
  btn: {
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
  },
  btnInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  currentTag: {
    fontFamily: Fonts.jakartaMedium,
    opacity: 0.8,
  },
  btnPrimary: { backgroundColor: Colors.black },
  btnPrimaryText: { fontFamily: Fonts.jakartaBold, fontSize: 15, color: Colors.white },
  btnSecondary: {
    backgroundColor: Colors.statCardBg,
    borderWidth: 0.5,
    borderColor: Colors.statCardBorder,
  },
  btnSecondaryText: { fontFamily: Fonts.jakartaBold, fontSize: 15, color: Colors.secondary },
  cancelBtn: {
    alignItems: 'center',
    paddingVertical: 12,
    marginTop: 4,
  },
  cancelText: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 13,
    color: Colors.secondary,
  },
  closeBtn: {
    backgroundColor: Colors.black,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 12,
  },
  closeText: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 15,
    color: Colors.white,
  },
});
