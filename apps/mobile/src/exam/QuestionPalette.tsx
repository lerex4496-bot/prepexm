import React from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';

import { Text } from '@/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { useT } from '@/i18n/useT';
import { PALETTE_GLYPH, paletteState, type PaletteState } from './scoring';
import type { Response } from './useExam';
import type { LoadedQuestion } from '@/db/content';

/**
 * The real NTA/CBSE question palette.
 *
 * Every state carries a distinct GLYPH as well as a colour. Colour alone would
 * fail for a colour-blind student, in greyscale, and under the glare of a
 * cheap screen — and this grid is the one control she uses to navigate a
 * 150-question paper under time pressure.
 */

export const STATE_ORDER: PaletteState[] = [
  'answered',
  'notAnswered',
  'marked',
  'answeredMarked',
  'notVisited',
];

export function useStateColors() {
  const { colors } = useTheme();
  return {
    answered: { bg: colors.successSoft, fg: colors.successText, border: colors.successText },
    notAnswered: { bg: colors.errorSoft, fg: colors.error, border: colors.error },
    marked: { bg: colors.primarySoft, fg: colors.primary, border: colors.primary },
    answeredMarked: { bg: colors.primarySoft, fg: colors.primary, border: colors.primary },
    notVisited: { bg: colors.surfaceSunken, fg: colors.inkMuted, border: colors.hairlineStrong },
  } as const;
}

export function PaletteLegend({ counts }: { counts: Record<PaletteState, number> }) {
  const { spacing } = useTheme();
  const { t } = useT();
  const sc = useStateColors();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
      {STATE_ORDER.map((s) => (
        <View key={s} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Text variant="caption" color={sc[s].fg}>
            {PALETTE_GLYPH[s]}
          </Text>
          <Text variant="caption" tone="secondary">
            {t(`exam.state.${s}`)}
          </Text>
          <Text variant="numeric" tone="secondary" style={{ fontSize: 12 }}>
            {counts[s]}
          </Text>
        </View>
      ))}
    </View>
  );
}

export function QuestionPalette({
  visible,
  onClose,
  questions,
  responses,
  index,
  onJump,
  counts,
}: {
  visible: boolean;
  onClose: () => void;
  questions: LoadedQuestion[];
  responses: Map<string, Response>;
  index: number;
  onJump: (i: number) => void;
  counts: Record<PaletteState, number>;
}) {
  const { colors, spacing, radius } = useTheme();
  const { t } = useT();
  const sc = useStateColors();

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} transparent>
      <Pressable style={{ flex: 1, backgroundColor: colors.scrim }} onPress={onClose} />
      <View
        style={{
          maxHeight: '76%',
          backgroundColor: colors.bg,
          borderTopLeftRadius: radius.lg,
          borderTopRightRadius: radius.lg,
          paddingTop: spacing.md,
        }}
      >
        <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.md, gap: spacing.sm }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text variant="h3">{t('exam.palette')}</Text>
            <Pressable onPress={onClose} hitSlop={12} accessibilityLabel={t('common.done')}>
              <Text variant="button" tone="muted">
                ✕
              </Text>
            </Pressable>
          </View>
          <PaletteLegend counts={counts} />
        </View>

        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingTop: 0 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            {questions.map((q, i) => {
              const st = paletteState(responses.get(q.id));
              const c = sc[st];
              const isCurrent = i === index;
              return (
                <Pressable
                  key={q.id}
                  onPress={() => {
                    onJump(i);
                    onClose();
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`${t('exam.question')} ${q.number}, ${t(`exam.state.${st}`)}`}
                  style={{
                    width: 46,
                    height: 42,
                    borderRadius: radius.sm,
                    backgroundColor: c.bg,
                    borderWidth: isCurrent ? 2.5 : 1.5,
                    borderColor: isCurrent ? colors.accent : c.border,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text variant="numeric" color={c.fg} style={{ fontSize: 13 }}>
                    {q.number}
                  </Text>
                  <Text variant="caption" color={c.fg} style={{ fontSize: 9, marginTop: -2 }}>
                    {PALETTE_GLYPH[st]}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}
