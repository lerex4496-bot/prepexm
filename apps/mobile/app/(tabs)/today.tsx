import React, { useCallback, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import {
  Button,
  Card,
  EmptyState,
  MasteryBar,
  ProgressRing,
  Screen,
  SectionHeader,
  Text,
} from '@/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { useT } from '@/i18n/useT';
import { LANGUAGE_LABEL, EXAM_LANGUAGES } from '@/i18n/strings';
import { useProfile } from '@/store/profile';
import { buildToday, type PlanItem, type TodayData } from '@/plan/todayPlan';

const KIND_GLYPH: Record<string, string> = {
  learn: '◐',
  practice: '◑',
  recall: '◒',
  fix: '◓',
};

/**
 * TODAY — answers "what should I do now?" from her real data.
 *
 * Everything here is computed locally from the content bundle and her own
 * attempts, so it renders instantly and works with no signal. No model is
 * involved: the intelligence has to feel immediate, and a spinner on the first
 * screen every morning would undo that.
 *
 * Deliberately excluded: XP, badges, accuracy charts, question totals. The
 * brief asked for motivation without gamification, so analytics live in
 * Progress and this screen carries exactly one primary action.
 */
export default function Today() {
  const { colors, spacing, sectionGap } = useTheme();
  const { t, contentLang } = useT();
  const router = useRouter();

  const profile = useProfile((s) => s.profile);
  const set = useProfile((s) => s.set);
  const exam = profile.exam ?? 'CTET';
  const languages = EXAM_LANGUAGES[exam];

  const [data, setData] = useState<TodayData | null>(null);
  // A failure here used to be invisible. The loader had no catch, so if
  // buildToday threw — a corrupt content copy, a missing table — `data` stayed
  // null forever and everything below the greeting rendered as nothing. On a
  // real phone that looked like a finished, empty app rather than a broken one,
  // and there was no way for her to tell the difference or act on it.
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void (async () => {
        try {
          const d = await buildToday(profile.dailyMinutes);
          if (alive) {
            setData(d);
            setError(null);
          }
        } catch (e) {
          if (alive) {
            setError(e instanceof Error ? e.message : t('today.loadFailed'));
            setData(null);
          }
        }
      })();
      return () => {
        alive = false;
      };
    }, [profile.dailyMinutes, t])
  );

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return t('today.morning');
    if (h < 17) return t('today.afternoon');
    return t('today.evening');
  })();

  const run = (item: PlanItem) => {
    const a = item.action;
    if (a.type === 'paper') {
      router.push({ pathname: '/exam/[paperId]', params: { paperId: a.paperId } });
    } else if (a.type === 'mistakes') {
      router.push({ pathname: '/practice/quick', params: { mode: 'mistakes' } });
    } else {
      router.push({ pathname: '/practice/quick', params: { subject: a.subject } });
    }
  };

  return (
    <Screen>
      {/* ── header: exam, language, settings ───────────────────────────── */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: spacing.xl,
        }}
      >
        <Pressable
          onPress={() => router.push('/settings')}
          accessibilityLabel={t('settings.title')}
          style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexShrink: 1 }}
        >
          <View
            style={{
              width: 32,
              height: 32,
              borderRadius: 999,
              backgroundColor: colors.accentSoft,
              borderWidth: 1.5,
              borderColor: colors.accent,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text variant="caption" color={colors.accent}>
              {exam[0]}
            </Text>
          </View>
          <Text variant="caption" tone="muted" style={{ letterSpacing: 1.5 }}>
            {exam}
          </Text>
        </Pressable>

        <View style={{ flexDirection: 'row', gap: spacing.xs }}>
          {languages.map((code) => {
            const active = contentLang === code;
            return (
              <Pressable
                key={code}
                onPress={() => set({ contentLang: code })}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={LANGUAGE_LABEL[code]}
                hitSlop={8}
                style={{
                  paddingHorizontal: 10,
                  paddingVertical: 5,
                  borderRadius: 999,
                  backgroundColor: active ? colors.accentSoft : 'transparent',
                  borderWidth: 1,
                  borderColor: active ? colors.accent : colors.hairline,
                }}
              >
                <Text variant="caption" color={active ? colors.accent : colors.inkMuted}>
                  {LANGUAGE_LABEL[code]}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <Text variant="display">{greeting}</Text>

      {/* Three distinct states, because they mean different things to her:
          an error she can act on, a still-loading screen, and a genuinely
          empty plan. Collapsing them into one blank view is what made a
          broken install look like a finished app. */}
      {error ? (
        <EmptyState glyph="⚠" title={t('today.loadFailed')} body={error} />
      ) : !data ? (
        <EmptyState glyph="◌" title={t('today.loading')} body="" />
      ) : !data.hasContent ? (
        // Exam-aware, because "no papers" means two different things. For CTET
        // it means the review queue has not been worked through; for NEET it
        // means the content pipeline has not been built yet. Showing the same
        // sentence for both reads as a bug to the NEET student.
        <EmptyState
          glyph="◇"
          title={exam === 'NEET' ? t('papers.neetSoon') : t('papers.empty')}
          body={exam === 'NEET' ? t('papers.neetSoonBody') : t('papers.emptyBody')}
        />
      ) : (
        <>
          <Text variant="body" tone="secondary" style={{ marginTop: spacing.xs }}>
            {t('today.summary', { minutes: data.minutes, count: data.items.length })}
          </Text>

          {/* ── today's plan ──────────────────────────────────────────── */}
          <View style={{ marginTop: sectionGap }}>
            <SectionHeader title={t('today.planTitle')} />

            {data.items.length === 0 ? (
              <EmptyState
                glyph="✓"
                title={t('today.allDone')}
                body={t('today.allDoneBody')}
                ctaLabel={t('today.practiceAnyway')}
                onCta={() => router.push('/practice/quick')}
              />
            ) : (
              <>
                <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
                  {data.items.map((item, i) => (
                    <Pressable
                      key={item.id}
                      onPress={() => run(item)}
                      accessibilityRole="button"
                      accessibilityLabel={`${t(`today.kind.${item.kind}`)}, ${item.title}`}
                      style={({ pressed }) => ({
                        flexDirection: 'row',
                        gap: spacing.md,
                        paddingVertical: spacing.md,
                        borderBottomWidth: i === data.items.length - 1 ? 0 : 1,
                        borderBottomColor: colors.hairline,
                        opacity: pressed ? 0.7 : 1,
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
                        <Text variant="bodyStrong">{item.title}</Text>

                        {/* The reason, rendered from {code, params} so it
                            speaks her language rather than English prose. */}
                        <View style={{ flexDirection: 'row', gap: 6, marginTop: 2 }}>
                          <Text variant="caption" tone="muted">
                            ↳
                          </Text>
                          <Text variant="caption" tone="muted" style={{ flexShrink: 1 }}>
                            {t(`why.${item.rationale.code}`, item.rationale.params as any)}
                          </Text>
                        </View>
                      </View>
                    </Pressable>
                  ))}
                </Card>

                <View style={{ marginTop: spacing.lg }}>
                  <Button
                    label={t('today.start')}
                    size="lg"
                    fullWidth
                    onPress={() => run(data.items[0])}
                  />
                </View>
              </>
            )}
          </View>

          {/* ── needs attention ───────────────────────────────────────── */}
          {data.weakAreas.length > 0 ? (
            <View style={{ marginTop: sectionGap }}>
              <SectionHeader title={t('today.attention')} />
              <View style={{ gap: spacing.md }}>
                {data.weakAreas.map((w) => (
                  <Card
                    key={w.subject}
                    onPress={() =>
                      router.push({ pathname: '/practice/quick', params: { subject: w.subject } })
                    }
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                      <View style={{ flex: 1 }}>
                        <Text variant="bodyStrong">{w.subject}</Text>
                        <Text variant="caption" tone="muted">
                          {t('today.wrongCount', { n: w.count })}
                        </Text>
                      </View>
                      <Text variant="h3" tone="muted">
                        ›
                      </Text>
                    </View>
                  </Card>
                ))}
              </View>
            </View>
          ) : null}

          {/* ── overall, only once she has sat something ──────────────── */}
          {data.overallPct != null ? (
            <View style={{ marginTop: sectionGap, marginBottom: sectionGap }}>
              <SectionHeader title={t('progress.performance')} />
              <Card>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xl }}>
                  <ProgressRing value={data.overallPct} size={64} stroke={7} />
                  <View style={{ flex: 1, gap: 3 }}>
                    <Text variant="bodyStrong">
                      {t('progress.attempts', { n: data.attemptCount })}
                    </Text>
                    <MasteryBar value={data.overallPct} width="100%" />
                  </View>
                </View>
              </Card>
            </View>
          ) : (
            <View style={{ height: sectionGap }} />
          )}
        </>
      )}

      {__DEV__ ? (
        <Pressable onPress={() => router.push('/dev/gallery')} style={{ marginBottom: sectionGap }}>
          <Text variant="caption" tone="muted" align="center">
            ⚙ Design gallery
          </Text>
        </Pressable>
      ) : null}
    </Screen>
  );
}
