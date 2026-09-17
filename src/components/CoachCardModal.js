import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Fonts } from '../theme';
import CoachCard from './CoachCard';

// The coach card the coach built during onboarding, exactly as a student reads it.
// `card` is the coach_cards row; `observed` what their captured lessons unlock.
export default function CoachCardModal({ visible, onClose, name, card, observed }) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={cc.backdrop}>
        <SafeAreaView style={cc.sheet}>
          <View style={cc.head}>
            <Text style={cc.headT}>Your coach card</Text>
            <TouchableOpacity onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
              <Ionicons name="close" size={22} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
          <ScrollView showsVerticalScrollIndicator={false}>
            <CoachCard card={{
              name,
              credential: card?.credential,
              essence: card?.essence,
              styleWords: card?.style_words,
              teaches: card?.teaches,
              worksWith: card?.works_with,
              howITeach: card?.how_i_teach,
              myMethod: card?.my_method,
              alloc: card?.alloc,
              bestFor: card?.best_for,
            }} observed={observed} />
            <Text style={cc.note}>
              The public page is not live yet — the link is reserved for you.
            </Text>
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const cc = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(10,10,10,0.72)' },
  sheet: { flex: 1, paddingHorizontal: 20, paddingTop: 8, paddingBottom: 28 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14 },
  headT: { fontFamily: Fonts.ttExtraBold, fontSize: 18, letterSpacing: -0.4, color: '#FFFFFF' },
  note: { fontFamily: Fonts.ttRegular, fontSize: 12.5, lineHeight: 18, color: 'rgba(255,255,255,0.62)',
    textAlign: 'center', marginTop: 16 },
});
