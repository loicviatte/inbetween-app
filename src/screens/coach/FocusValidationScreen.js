import React, { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, TextInput, KeyboardAvoidingView, Platform, ScrollView, Modal
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { Colors, Fonts, Spacing } from '../../theme';
import {
  getPendingFocusPoints, approveFocusPoint, editAndApproveFocusPoint,
  deletePendingFocusPoint, approveAllPendingForStudent
} from '../../storage/coachStorage';

const TIER_COLOR = { critical: '#E84040', important: '#FF9D00', supporting: '#4CAF50' };

function PendingFocusCard({ fp, onApprove, onEdit, onDelete }) {
  return (
    <View style={s.card}>
      <View style={s.cardTop}>
        <View style={[s.tierBadge, { backgroundColor: `${TIER_COLOR[fp.tier] ?? Colors.secondary}18`, borderColor: TIER_COLOR[fp.tier] ?? Colors.secondary }]}>
          <Text style={[s.tierText, { color: TIER_COLOR[fp.tier] ?? Colors.secondary }]}>{fp.tier?.toUpperCase() ?? 'IMPORTANT'}</Text>
        </View>
        {!!fp.group_fp && (
          <View style={s.groupBadge}>
            <Text style={s.groupBadgeText}>GROUP</Text>
          </View>
        )}
      </View>
      <Text style={s.fpName}>{fp.name}</Text>
      {!!fp.subtitle && <Text style={s.fpSubtitle}>{fp.subtitle}</Text>}
      {!!fp.context && <Text style={s.fpContext} numberOfLines={3}>{fp.context}</Text>}
      {!!fp.drill && <Text style={s.fpDrill}>Drill: {fp.drill}</Text>}
      <View style={s.actions}>
        <TouchableOpacity style={[s.actionBtn, s.actionApprove]} onPress={() => onApprove(fp.id)} activeOpacity={0.8}>
          <Ionicons name="checkmark" size={16} color="#fff" />
          <Text style={s.actionApproveText}>Approve</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.actionIconBtn} onPress={() => onEdit(fp)} activeOpacity={0.8}>
          <Ionicons name="pencil-outline" size={18} color={Colors.secondary} />
        </TouchableOpacity>
        <TouchableOpacity style={s.actionIconBtn} onPress={() => onDelete(fp.id)} activeOpacity={0.8}>
          <Ionicons name="trash-outline" size={18} color="#E84040" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

function EditSheet({ fp, onSave, onClose }) {
  const [name, setName] = useState(fp.name ?? '');
  const [subtitle, setSubtitle] = useState(fp.subtitle ?? '');
  const [context, setContext] = useState(fp.context ?? '');
  const [drill, setDrill] = useState(fp.drill ?? '');
  const [tier, setTier] = useState(fp.tier ?? 'important');
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    await onSave(fp.id, { name, subtitle, context, drill, tier });
    setSaving(false);
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={es.overlay}>
      <View style={es.sheet}>
        <View style={es.handle} />
        <Text style={es.title}>Edit Focus Point</Text>
        <ScrollView showsVerticalScrollIndicator={false}>
          {[['Title', name, setName], ['Subtitle', subtitle, setSubtitle], ['Context', context, setContext], ['Drill', drill, setDrill]].map(([label, val, set]) => (
            <View key={label} style={es.field}>
              <Text style={es.label}>{label}</Text>
              <TextInput style={[es.input, label === 'Context' && { minHeight: 80 }]} value={val} onChangeText={set} multiline={label === 'Context'} placeholderTextColor="rgba(13,13,18,0.3)" />
            </View>
          ))}
          <View style={es.field}>
            <Text style={es.label}>Tier</Text>
            <View style={es.pillRow}>
              {['critical', 'important', 'supporting'].map(t => (
                <TouchableOpacity key={t} style={[es.pill, tier === t && es.pillActive]} onPress={() => setTier(t)} activeOpacity={0.8}>
                  <Text style={[es.pillText, tier === t && es.pillTextActive]}>{t}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </ScrollView>
        <TouchableOpacity style={es.saveBtn} onPress={handleSave} disabled={saving} activeOpacity={0.85}>
          <Text style={es.saveBtnText}>{saving ? 'Saving…' : 'Save & Approve'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={es.cancelBtn} onPress={onClose} activeOpacity={0.7}>
          <Text style={es.cancelText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

export default function FocusValidationScreen({ navigation, route }) {
  const { studentId, studentName } = route.params ?? {};
  const [fps, setFps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingFp, setEditingFp] = useState(null);
  const [approving, setApproving] = useState(false);

  useFocusEffect(useCallback(() => {
    let active = true;
    async function load() {
      setLoading(true);
      try {
        const data = await getPendingFocusPoints(studentId ?? null);
        if (active) setFps(data);
      } catch {}
      if (active) setLoading(false);
    }
    load();
    return () => { active = false; };
  }, [studentId]));

  // Hours remaining from coach_review_deadline
  function hoursLeft(fp) {
    if (!fp.coach_review_deadline) return null;
    const ms = new Date(fp.coach_review_deadline) - Date.now();
    if (ms <= 0) return 0;
    return Math.ceil(ms / 3600000);
  }

  async function handleApprove(fpId) {
    await approveFocusPoint(fpId);
    setFps(prev => prev.filter(f => f.id !== fpId));
  }

  async function handleDelete(fpId) {
    await deletePendingFocusPoint(fpId);
    setFps(prev => prev.filter(f => f.id !== fpId));
  }

  async function handleEdit(fp) { setEditingFp(fp); }

  async function handleSaveEdit(fpId, updates) {
    await editAndApproveFocusPoint(fpId, updates);
    setFps(prev => prev.filter(f => f.id !== fpId));
    setEditingFp(null);
  }

  async function handleApproveAll() {
    setApproving(true);
    if (studentId) {
      await approveAllPendingForStudent(studentId);
    } else {
      // Approve all one by one for multi-student view
      for (const fp of fps) {
        await approveFocusPoint(fp.id);
      }
    }
    setFps([]);
    setApproving(false);
  }

  const minDeadline = fps.length > 0
    ? fps.map(f => f.coach_review_deadline).filter(Boolean).sort()[0]
    : null;
  const hours = minDeadline ? Math.max(0, Math.ceil((new Date(minDeadline) - Date.now()) / 3600000)) : null;

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="arrow-back" size={22} color={Colors.black} />
        </TouchableOpacity>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={s.headerTitle}>Pending Review</Text>
          {!!studentName && <Text style={s.headerSub}>{studentName}</Text>}
        </View>
        {fps.length > 1 && (
          <TouchableOpacity onPress={handleApproveAll} disabled={approving} activeOpacity={0.8}>
            <Text style={s.approveAllText}>{approving ? 'Publishing…' : 'Approve all'}</Text>
          </TouchableOpacity>
        )}
      </View>

      {hours !== null && hours > 0 && (
        <View style={s.deadlineBanner}>
          <Text style={s.deadlineText}>Auto-publishes in {hours}h if no action</Text>
        </View>
      )}

      {loading ? (
        <View style={s.center}><ActivityIndicator color={Colors.orange} /></View>
      ) : fps.length === 0 ? (
        <View style={s.center}>
          <Ionicons name="checkmark-circle-outline" size={48} color={Colors.activeLog} />
          <Text style={s.doneText}>All focus points reviewed</Text>
        </View>
      ) : (
        <FlatList
          data={fps}
          keyExtractor={f => f.id}
          contentContainerStyle={s.list}
          renderItem={({ item }) => (
            <PendingFocusCard
              fp={item}
              onApprove={handleApprove}
              onEdit={handleEdit}
              onDelete={handleDelete}
            />
          )}
        />
      )}

      <Modal visible={!!editingFp} transparent animationType="slide" onRequestClose={() => setEditingFp(null)}>
        {editingFp && <EditSheet fp={editingFp} onSave={handleSaveEdit} onClose={() => setEditingFp(null)} />}
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.side, paddingVertical: 14 },
  headerTitle: { fontFamily: Fonts.jakartaExtraBold, fontSize: 17, color: Colors.black, letterSpacing: -0.2 },
  headerSub: { fontFamily: Fonts.jakartaRegular, fontSize: 12, color: Colors.secondary, marginTop: 1 },
  approveAllText: { fontFamily: Fonts.jakartaSemiBold, fontSize: 13, color: Colors.activeLog },
  deadlineBanner: { marginHorizontal: Spacing.side, marginBottom: 8, backgroundColor: 'rgba(255,157,0,0.08)', borderRadius: 10, paddingVertical: 8, paddingHorizontal: 14 },
  deadlineText: { fontFamily: Fonts.jakartaMedium, fontSize: 12, color: Colors.orange, textAlign: 'center' },
  list: { paddingHorizontal: Spacing.side, paddingBottom: 40, gap: 14 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  doneText: { fontFamily: Fonts.jakartaSemiBold, fontSize: 16, color: Colors.secondary },
  card: { backgroundColor: Colors.statCardBg, borderWidth: 0.5, borderColor: Colors.statCardBorder, borderRadius: 16, padding: 16, gap: 6 },
  cardTop: { flexDirection: 'row', gap: 8, marginBottom: 2 },
  tierBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 0.5 },
  tierText: { fontFamily: Fonts.jakartaExtraBold, fontSize: 9, letterSpacing: 0.8 },
  groupBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: 'rgba(87,136,230,0.1)', borderWidth: 0.5, borderColor: 'rgba(87,136,230,0.3)' },
  groupBadgeText: { fontFamily: Fonts.jakartaExtraBold, fontSize: 9, color: '#5788E6', letterSpacing: 0.8 },
  fpName: { fontFamily: Fonts.jakartaExtraBold, fontSize: 18, color: Colors.black, letterSpacing: -0.3 },
  fpSubtitle: { fontFamily: Fonts.jakartaSemiBold, fontSize: 13, color: Colors.black, opacity: 0.75 },
  fpContext: { fontFamily: Fonts.jakartaRegular, fontSize: 12, color: Colors.secondary, lineHeight: 18 },
  fpDrill: { fontFamily: Fonts.jakartaRegular, fontSize: 12, color: Colors.orange, fontStyle: 'italic' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 10 },
  actionApprove: { backgroundColor: Colors.activeLog },
  actionApproveText: { fontFamily: Fonts.jakartaBold, fontSize: 13, color: '#fff' },
  actionIconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: Colors.statCardBg, borderWidth: 0.5, borderColor: Colors.statCardBorder },
});

const es = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: { backgroundColor: Colors.white, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 24, paddingTop: 12, paddingBottom: 44, maxHeight: '90%' },
  handle: { width: 32, height: 3, backgroundColor: 'rgba(13,13,18,0.1)', borderRadius: 2, alignSelf: 'center', marginBottom: 20 },
  title: { fontFamily: Fonts.jakartaExtraBold, fontSize: 17, color: Colors.black, textAlign: 'center', marginBottom: 20, letterSpacing: -0.2 },
  field: { marginBottom: 16 },
  label: { fontFamily: Fonts.jakartaExtraBold, fontSize: 10, color: Colors.secondary, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 },
  input: { backgroundColor: Colors.statCardBg, borderWidth: 0.5, borderColor: Colors.statCardBorder, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontFamily: Fonts.jakartaRegular, fontSize: 14, color: Colors.black },
  pillRow: { flexDirection: 'row', gap: 8 },
  pill: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16, borderWidth: 0.5, borderColor: Colors.statCardBorder, backgroundColor: Colors.statCardBg },
  pillActive: { backgroundColor: Colors.black, borderColor: Colors.black },
  pillText: { fontFamily: Fonts.jakartaMedium, fontSize: 13, color: Colors.secondary },
  pillTextActive: { color: Colors.white },
  saveBtn: { backgroundColor: Colors.black, borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 8 },
  saveBtnText: { fontFamily: Fonts.jakartaBold, fontSize: 15, color: Colors.white },
  cancelBtn: { paddingVertical: 14, alignItems: 'center' },
  cancelText: { fontFamily: Fonts.jakartaRegular, fontSize: 14, color: Colors.secondary },
});
