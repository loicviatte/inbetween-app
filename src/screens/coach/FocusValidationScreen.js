import React, { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, Modal
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import HeroCardGradient from '../../components/HeroCardGradient';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { Colors, Fonts, Spacing } from '../../theme';
import { GenericListSkeleton } from '../../components/Skeleton';
import {
  getPendingFocusPoints, approveFocusPoint, editAndApproveFocusPoint,
  deletePendingFocusPoint, approveAllPendingForStudent
} from '../../storage/coachStorage';
import FocusPointEditSheet from '../../components/FocusPointEditSheet';
import { useCoachData } from '../../context/CoachDataContext';

// Tier palette tuned for the dark hero-card background. Each tier gets a
// translucent fill, a slightly stronger border, and a lifted text color so
// the pill stays legible against the brown→black gradient.
const TIER_PALETTE = {
  critical:   { bg: 'rgba(232,64,64,0.18)',  border: 'rgba(232,64,64,0.40)',  text: '#FF8C8C' },
  important:  { bg: 'rgba(255,157,0,0.18)',  border: 'rgba(255,157,0,0.40)',  text: '#FFC477' },
  supporting: { bg: 'rgba(76,175,80,0.18)',  border: 'rgba(76,175,80,0.40)',  text: '#8BD98F' },
};

function hoursLeft(deadlineIso) {
  if (!deadlineIso) return null;
  const ms = new Date(deadlineIso) - Date.now();
  if (ms <= 0) return 0;
  return Math.ceil(ms / 3600000);
}

function PendingFocusCard({ fp, onApprove, onEdit, onDelete }) {
  const tierKey = fp.tier && TIER_PALETTE[fp.tier] ? fp.tier : 'important';
  const tier = TIER_PALETTE[tierKey];
  const tierLabel = tierKey.toUpperCase();
  const hrs = hoursLeft(fp.coach_review_deadline);
  const danceLabel = Array.isArray(fp.dance) && fp.dance.length > 0
    ? fp.dance.join(' · ').toUpperCase()
    : null;

  return (
    <View style={s.card}>
      <HeroCardGradient />

      {(danceLabel || hrs !== null) && (
        <View style={s.cardTopRow}>
          <Text style={s.cardMetaLeft} numberOfLines={1}>{danceLabel ?? ''}</Text>
          {hrs !== null && (
            <Text style={s.cardMetaRight} numberOfLines={1}>
              {hrs === 0 ? 'AUTO-PUBLISHING' : `${hrs}H LEFT`}
            </Text>
          )}
        </View>
      )}

      <View style={s.cardPills}>
        <View style={[s.tierPill, { backgroundColor: tier.bg, borderColor: tier.border }]}>
          <Text style={[s.tierPillText, { color: tier.text }]}>{tierLabel}</Text>
        </View>
        {!!fp.group_fp && (
          <View style={s.pill}>
            <Text style={s.pillText}>GROUP</Text>
          </View>
        )}
        {fp.mention_count > 1 && (
          <View style={s.pill}>
            <Text style={s.pillText}>{fp.mention_count}× MENTIONED</Text>
          </View>
        )}
      </View>

      <Text style={s.fpName} numberOfLines={3}>{fp.name}</Text>
      {!!fp.subtitle && <Text style={s.fpSubtitle}>{fp.subtitle}</Text>}

      {(!!fp.context || !!fp.drill) && <View style={s.divider} />}

      {!!fp.context && <Text style={s.fpContext} numberOfLines={3}>{fp.context}</Text>}
      {!!fp.drill && (
        <View style={s.drillBlock}>
          <Text style={s.drillLabel}>DRILL</Text>
          <Text style={s.drillText}>{fp.drill}</Text>
        </View>
      )}

      <View style={s.actions}>
        <TouchableOpacity style={[s.actionBtn, s.actionApprove]} onPress={() => onApprove(fp.id)} activeOpacity={0.8}>
          <Ionicons name="checkmark" size={16} color="#0A0A0A" />
          <Text style={s.actionApproveText}>Approve</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.actionIconBtn} onPress={() => onEdit(fp)} activeOpacity={0.8}>
          <Ionicons name="pencil-outline" size={18} color="rgba(255,255,255,0.85)" />
        </TouchableOpacity>
        <TouchableOpacity style={s.actionIconBtn} onPress={() => onDelete(fp.id)} activeOpacity={0.8}>
          <Ionicons name="trash-outline" size={18} color="#FF8C8C" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default function FocusValidationScreen({ navigation, route }) {
  const { studentId, studentName } = route.params ?? {};
  const { refresh: refreshCoachData } = useCoachData();
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
    refreshCoachData();
  }

  async function handleDelete(fpId) {
    await deletePendingFocusPoint(fpId);
    setFps(prev => prev.filter(f => f.id !== fpId));
    refreshCoachData();
  }

  async function handleEdit(fp) { setEditingFp(fp); }

  async function handleSaveEdit(fpId, updates) {
    await editAndApproveFocusPoint(fpId, updates);
    setFps(prev => prev.filter(f => f.id !== fpId));
    setEditingFp(null);
    refreshCoachData();
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
    refreshCoachData();
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
        <GenericListSkeleton rows={4} variant="detail" showHeader={false} showTitle={false} />
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
        {editingFp && (
          <FocusPointEditSheet
            fp={editingFp}
            onSave={handleSaveEdit}
            onClose={() => setEditingFp(null)}
            saveLabel="Save & Approve"
          />
        )}
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
  // ── Dark hero card (matches CoachClassDetailScreen heroCard) ──
  card: {
    borderRadius: 18,
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(240,194,74,0.28)',
    overflow: 'hidden',
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 6,
  },
  cardMetaLeft: {
    fontFamily: Fonts.jakartaMedium,
    fontSize: 11,
    color: 'rgba(255,255,255,0.55)',
    letterSpacing: 0.4,
  },
  cardMetaRight: {
    flexShrink: 1,
    fontFamily: Fonts.jakartaBold,
    fontSize: 11,
    color: '#F6D27A',
    letterSpacing: 0.4,
    textAlign: 'right',
  },
  cardPills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginBottom: 10,
  },
  tierPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  tierPillText: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 8.5,
    letterSpacing: 0.8,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  pillText: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 8.5,
    color: 'rgba(255,255,255,0.72)',
    letterSpacing: 0.8,
  },
  fpName: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 22,
    color: '#FFFFFF',
    letterSpacing: -0.55,
    lineHeight: 26,
  },
  fpSubtitle: {
    fontFamily: Fonts.jakartaSemiBold,
    fontSize: 13,
    color: '#F6D27A',
    lineHeight: 18,
    marginTop: 6,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.10)',
    marginTop: 14,
    marginBottom: 12,
  },
  fpContext: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 12.5,
    color: 'rgba(255,255,255,0.78)',
    lineHeight: 18,
  },
  drillBlock: {
    marginTop: 12,
  },
  drillLabel: {
    fontFamily: Fonts.jakartaExtraBold,
    fontSize: 8.5,
    color: '#F6D27A',
    letterSpacing: 1,
    marginBottom: 4,
  },
  drillText: {
    fontFamily: Fonts.jakartaRegular,
    fontSize: 12.5,
    color: 'rgba(255,255,255,0.85)',
    lineHeight: 18,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 16,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 11,
    borderRadius: 12,
  },
  actionApprove: {
    backgroundColor: '#FFFFFF',
  },
  actionApproveText: {
    fontFamily: Fonts.jakartaBold,
    fontSize: 13,
    color: '#0A0A0A',
    letterSpacing: -0.2,
  },
  actionIconBtn: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.14)',
  },
});

