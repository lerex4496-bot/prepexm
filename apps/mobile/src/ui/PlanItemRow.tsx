import React from 'react';
import { Pressable, View } from 'react-native';

import { pick, type PlanItem, type PlanKind, type Rationale } from '@/content/contract';
import { useT } from '@/i18n/useT';
import { useTheme } from '@/theme/ThemeProvider';
import { Text } from './Text';

/** Each plan kind gets a distinct glyph — colour is never the only cue. */
const KIND_GLYPH: Record<PlanKind, string> = {
  learn: '◐',
  practice: '◑',
  recall: '◒',
  fix: '◓',
};

/**
 * Renders the "why was this chosen for me" line.
 *
 * The rationale arrives as {code, params} and is looked up per language here.
 * That is the whole point: if the planner emitted an English sentence, this
 * line could never be shown properly to a Gujarati-medium student — and this
 * line is the single thing that makes the app feel like it understands her.
 */
export function RationaleNote({ rationale }: { rationale: Rationale }) {
  const { t } = useT();
  const { colors } = useTheme();

  return (
    <View style={{ flexDirection: 'row', gap: 6, alignItems: 'flex-start' }}>
      <Text variant="caption" color={colors.inkMuted}>
        ↳
      </Text>
      <Text variant="caption" tone="muted" style={{ flexShrink: 1 }}>
        {t(`why.${rationale.code}`, rationale.params as Record<string, string | number>)}
      </Text>
    </View>
  );
}

export function PlanItemRow({
  item,
  onPress,
  last = false,
}: {
  item: PlanItem;
  onPress?: () => void;
  last?: boolean;
}) {
  const { t, uiLang } = useT();
  const { colors, spacing } = useTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${t(`today.kind.${item.kind}`)}, ${pick(item.title, uiLang)}, ${item.minutes} ${t('common.min')}`}
      style={({ pressed }) => ({
        flexDirection: 'row',
        gap: spacing.md,
        paddingVertical: spacing.md,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: colors.hairline,
        opacity: pressed ? 0.7 : item.done ? 0.5 : 1,
      })}
    >
      <Text variant="h3" color={colors.accent} style={{ marginTop: 1 }}>
        {KIND_GLYPH[item.kind]}
      </Text>

      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm }}>
          <Text variant="caption" tone="muted">
            {t(`today.kind.${item.kind}`).toUpperCase()}
          </Text>
          <Text variant="numeric" tone="muted" style={{ fontSize: 12 }}>
            {item.minutes} {t('common.min')}
          </Text>
        </View>

        <Text variant="bodyStrong" style={{ textDecorationLine: item.done ? 'line-through' : 'none' }}>
          {pick(item.title, uiLang)}
        </Text>

        <Text variant="caption" tone="secondary">
          {pick(item.detail, uiLang)}
        </Text>

        <View style={{ marginTop: 2 }}>
          <RationaleNote rationale={item.rationale} />
        </View>
      </View>
    </Pressable>
  );
}
