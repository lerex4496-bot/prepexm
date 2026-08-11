import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, View } from 'react-native';

import { Card, Text } from '@/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { useT } from '@/i18n/useT';
import {
  askTutor,
  TUTOR_ACTIONS,
  TutorUnavailable,
  type Citation,
  type TutorAnswer,
} from './client';

/**
 * The contextual tutor.
 *
 * A BOTTOM SHEET over whatever she is reading, never a destination. The brief
 * was explicit that the tutor must not dominate the product — so there is no
 * tab, no chat history, and no free-text box. It opens with the topic already
 * in hand and offers four concrete actions.
 *
 * Every answer shows its NCERT citations, and the citations render even when
 * the model is unavailable. That is the point of grounding: she should always
 * be able to go and read the page herself.
 */
export function TutorSheet({
  visible,
  onClose,
  topic,
  subject,
}: {
  visible: boolean;
  onClose: () => void;
  /** What she is looking at — a question stem or a concept name. */
  topic: string;
  subject?: string | null;
}) {
  const { colors, spacing, radius } = useTheme();
  const { t, contentLang } = useT();

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TutorAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asked, setAsked] = useState<string | null>(null);

  const ask = useCallback(
    async (question: string, label: string) => {
      setLoading(true);
      setError(null);
      setResult(null);
      setAsked(label);
      try {
        setResult(await askTutor({ question, lang: contentLang, subject }));
      } catch (e) {
        setError(
          e instanceof TutorUnavailable ? e.message : t('tutor.unavailable')
        );
      } finally {
        setLoading(false);
      }
    },
    [contentLang, subject, t]
  );

  const reset = () => {
    setResult(null);
    setError(null);
    setAsked(null);
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: colors.scrim }} onPress={onClose} />
      <View
        style={{
          maxHeight: '82%',
          backgroundColor: colors.bg,
          borderTopLeftRadius: radius.lg,
          borderTopRightRadius: radius.lg,
          paddingTop: spacing.md,
        }}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingHorizontal: spacing.lg,
            paddingBottom: spacing.md,
          }}
        >
          <Text variant="h3">{t('tutor.title')}</Text>
          <Pressable onPress={onClose} hitSlop={12} accessibilityLabel={t('common.done')}>
            <Text variant="button" tone="muted">
              ✕
            </Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingTop: 0 }}>
          {/* What it is about — so she never wonders what it is answering. */}
          <Card tone="sunken" style={{ marginBottom: spacing.lg }}>
            <Text variant="caption" tone="muted">
              {t('tutor.context').toUpperCase()}
            </Text>
            <Text variant="body" numberOfLines={3} style={{ marginTop: 4 }}>
              {topic}
            </Text>
          </Card>

          {!asked ? (
            <View style={{ gap: spacing.sm }}>
              {TUTOR_ACTIONS.map((a) => (
                <Pressable
                  key={a.key}
                  onPress={() => void ask(a.build(topic), t(`tutor.action.${a.key}`))}
                  style={{
                    padding: spacing.md,
                    borderRadius: radius.md,
                    borderWidth: 1.5,
                    borderColor: colors.hairlineStrong,
                    backgroundColor: colors.surface,
                  }}
                >
                  <Text variant="bodyStrong">{t(`tutor.action.${a.key}`)}</Text>
                </Pressable>
              ))}
            </View>
          ) : (
            <>
              <View
                style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md, gap: spacing.sm }}
              >
                <Text variant="caption" tone="accent" style={{ flex: 1 }}>
                  {asked}
                </Text>
                <Pressable onPress={reset} hitSlop={8}>
                  <Text variant="caption" tone="muted">
                    {t('tutor.askAnother')}
                  </Text>
                </Pressable>
              </View>

              {loading ? (
                <View style={{ paddingVertical: spacing['2xl'], alignItems: 'center', gap: spacing.md }}>
                  <ActivityIndicator color={colors.accent} />
                  <Text variant="caption" tone="muted">
                    {t('tutor.thinking')}
                  </Text>
                </View>
              ) : error ? (
                <Card>
                  <Text variant="bodyStrong" tone="error">
                    {t('tutor.unavailable')}
                  </Text>
                  <Text variant="caption" tone="secondary" style={{ marginTop: 4 }}>
                    {error}
                  </Text>
                  <Text variant="caption" tone="muted" style={{ marginTop: spacing.sm }}>
                    {t('tutor.offlineNote')}
                  </Text>
                </Card>
              ) : result ? (
                <View style={{ gap: spacing.lg }}>
                  {result.answer ? (
                    <Card>
                      <Text variant="body">{result.answer}</Text>
                      {result.provider ? (
                        <Text variant="caption" tone="muted" style={{ marginTop: spacing.sm }}>
                          {result.provider} · {result.model}
                        </Text>
                      ) : null}
                    </Card>
                  ) : (
                    // No generated answer, but the retrieval succeeded — this is
                    // still useful, so it is presented as a result, not a failure.
                    <Card tone="sunken">
                      <Text variant="bodyStrong">{t('tutor.citationsOnly')}</Text>
                      <Text variant="caption" tone="secondary" style={{ marginTop: 4 }}>
                        {result.reason ?? ''}
                      </Text>
                    </Card>
                  )}

                  {result.citations.length ? (
                    <View style={{ gap: spacing.md }}>
                      <Text variant="caption" tone="muted">
                        {t('tutor.fromNcert').toUpperCase()}
                      </Text>
                      {result.citations.map((c: Citation) => (
                        <Card key={c.n} tone="sunken">
                          <Text variant="caption" tone="accent">
                            [{c.n}] {c.book} · {t('learn.part')} {c.class} · {c.chapter} · p{c.pages[0]}
                            {c.pages[1] !== c.pages[0] ? `–${c.pages[1]}` : ''}
                          </Text>
                          <Text variant="caption" tone="secondary" style={{ marginTop: 6 }}>
                            {c.excerpt}
                          </Text>
                        </Card>
                      ))}
                    </View>
                  ) : (
                    <Card>
                      <Text variant="body" tone="secondary">
                        {t('tutor.noMatch')}
                      </Text>
                    </Card>
                  )}
                </View>
              ) : null}
            </>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

/** The small contextual entry point. Never a tab, never a floating chat button. */
export function AskTutorButton({ onPress }: { onPress: () => void }) {
  const { colors, spacing, radius } = useTheme();
  const { t } = useT();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t('tutor.didntUnderstand')}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.sm,
        alignSelf: 'flex-start',
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        borderRadius: radius.full,
        borderWidth: 1.5,
        borderColor: colors.accent,
        backgroundColor: colors.accentSoft,
      }}
    >
      <Text variant="caption" color={colors.accent}>
        ✦ {t('tutor.didntUnderstand')}
      </Text>
    </Pressable>
  );
}
