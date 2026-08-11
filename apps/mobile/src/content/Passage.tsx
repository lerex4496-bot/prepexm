import React, { useState } from 'react';
import { Pressable, View } from 'react-native';

import { Text } from '@/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { useT } from '@/i18n/useT';
import { useProfile } from '@/store/profile';
import { passageFor, type PassageBearing } from './localise';

/**
 * The reading passage a comprehension question refers to.
 *
 * WHY THIS EXISTS
 * ---------------
 * In the real booklet a passage is printed once above six to nine questions.
 * The parser used to attach it to none of them, so a question arrived as:
 *
 *     "What did the cricket do in summer ?"
 *
 * — unanswerable, with no indication that anything was missing. The passage is
 * now attached to every question in its block, which is what makes those
 * questions answerable at all, and is also what stopped the explanation
 * pipeline reciting the fable from memory instead of reading it.
 *
 * COLLAPSED BY DEFAULT, AFTER THE FIRST READ
 * ------------------------------------------
 * Expanded on arrival, because on the first question of a block she has not
 * read it yet and hiding it would be perverse. Collapsible because by the
 * fourth question of the same block it is 2,000 characters of scrolling
 * between her and the question — the real booklet lets her flick back to the
 * page, and collapsing is the closest equivalent on a phone.
 */
export interface PassageProps {
  question: PassageBearing;
  /**
   * Whether this is the first question of its block. Passed by the caller
   * because only it knows the surrounding questions.
   */
  startExpanded?: boolean;
}

export function Passage({ question, startExpanded = true }: PassageProps) {
  const { colors, spacing, radius } = useTheme();
  const { t } = useT();
  const contentLang = useProfile((s) => s.profile.contentLang);
  const [open, setOpen] = useState(startExpanded);

  const passage = passageFor(question, contentLang);
  if (!passage?.text) return null;

  return (
    <View
      style={{
        marginBottom: spacing.lg,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colors.hairline,
        backgroundColor: colors.surface,
        overflow: 'hidden',
      }}
    >
      <Pressable
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={t('passage.label')}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm,
        }}
      >
        <Text variant="caption" tone="secondary">
          {t('passage.label')}
        </Text>
        <Text variant="caption" tone="muted">
          {open ? t('passage.hide') : t('passage.show')}
        </Text>
      </Pressable>

      {open ? (
        <View style={{ paddingHorizontal: spacing.md, paddingBottom: spacing.md }}>
          {/* `body` rather than `question`: this is prose to be read, not the
              thing being asked, and it should not compete with the stem. */}
          <Text variant="body" tone="secondary">
            {passage.text}
          </Text>
          {passage.fellBack ? (
            <Text variant="caption" tone="muted" style={{ marginTop: spacing.sm }}>
              {t('passage.englishOnly')}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
