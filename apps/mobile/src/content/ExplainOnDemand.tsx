import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { Markdown, Text } from '@/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { useT } from '@/i18n/useT';
import { useProfile } from '@/store/profile';
import { DirectError, directAvailable, explainDirect } from '@/ai/direct';
import { explanationFor } from './localise';
import type { LoadedQuestion } from '@/db/content';

/**
 * The explanation for a question, generated on the phone if the bundle has none.
 *
 * WHY THIS IS SAFE WITHOUT A SERVER OR A CORPUS
 * ---------------------------------------------
 * An explanation here is built from three things that already ship inside the
 * app: the question stem, its options, and the OFFICIAL ANSWER KEY. The model
 * is handed the correct answer as a fact and asked to explain it. It never
 * chooses an answer, so it cannot contradict the board — which is the one
 * guarantee that actually matters for exam prep.
 *
 * That is the same contract as the server-side pipeline. The chat is different
 * and weaker without a server, because grounding there comes from retrieval
 * over NCERT; this does not need retrieval at all.
 *
 * WHY IT IS ON DEMAND RATHER THAN PRE-GENERATED
 * ---------------------------------------------
 * Generating all 370 costs 370 API calls and about six hours. Generating the
 * one she is actually looking at costs one call and a few seconds, and most
 * questions are never reviewed. The result is held for the session only: a
 * cache that survived restarts would be unreviewed model output accumulating
 * on the device, and the review gate exists precisely to stop that.
 */
export function ExplainOnDemand({ question }: { question: LoadedQuestion }) {
  const { colors, spacing } = useTheme();
  const { t } = useT();
  const contentLang = useProfile((s) => s.profile.contentLang);

  const shipped = explanationFor(question, contentLang)?.text;
  const [generated, setGenerated] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const correct = question.options.filter((o) => o.is_correct).map((o) => o.label);
      const r = await explainDirect({
        stem: question.stem_en,
        options: question.options.map((o) => ({ label: o.label, text: o.text_en })),
        correctLabels: correct,
        lang: contentLang,
        isBonus: question.status === 'bonus',
      });
      setGenerated(r.text);
    } catch (e) {
      setError(e instanceof DirectError ? e.message : t('review.explainFailed'));
    } finally {
      setBusy(false);
    }
  }, [question, contentLang, t]);

  // A reviewed explanation from the bundle always wins. It has been through the
  // human gate; a freshly generated one has not.
  if (shipped) return <Text variant="body">{shipped}</Text>;
  if (generated) {
    return (
      <View style={{ gap: spacing.xs }}>
        <Markdown text={generated} />
        <Text variant="caption" tone="muted">
          {t('review.generatedNow')}
        </Text>
      </View>
    );
  }

  if (busy) {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <ActivityIndicator size="small" color={colors.inkMuted} />
        <Text variant="caption" tone="muted">
          {t('review.explaining')}
        </Text>
      </View>
    );
  }

  return (
    <View style={{ gap: spacing.xs }}>
      <Text variant="body" tone="muted">
        {t('review.noExplanation')}
      </Text>
      {directAvailable() ? (
        <Pressable onPress={() => void generate()} hitSlop={8}>
          <Text variant="button" color={colors.accent}>
            {t('review.explainNow')}
          </Text>
        </Pressable>
      ) : null}
      {error ? (
        <Text variant="caption" color={colors.error}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}
