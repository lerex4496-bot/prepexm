import React, { useCallback, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useFocusEffect } from 'expo-router';

import { Card, EmptyState, MasteryBar, Screen, SectionHeader, Text } from '@/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { useT } from '@/i18n/useT';
import {
  countByType,
  groupWeaknesses,
  loadMistakes,
  loadPerformance,
  resolveMistake,
  unresolveMistake,
  type MistakeDetail,
  type PerformancePoint,
  type WeaknessGroup,
} from '@/db/mistakes';

/**
 * Progress — mistake notebook first, analytics second.
 *
 * The brief asked for meaningful metrics rather than vanity analytics, so the
 * screen leads with the one thing that changes what she does tomorrow: the
 * areas she gets wrong REPEATEDLY. Frequency is the ranking, because one wrong
 * answer is noise and four from the same area is a gap.
 *
 * Exam readiness is deliberately absent until it can be justified — see the
 * locked card at the foot.
 */
export default function Progress() {
  const { colors, spacing, radius, sectionGap } = useTheme();
  const { t, contentLang } = useT();

  const [mistakes, setMistakes] = useState<MistakeDetail[]>([]);
  const [groups, setGroups] = useState<WeaknessGroup[]>([]);
  const [perf, setPerf] = useState<PerformancePoint[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    const [m, p] = await Promise.all([loadMistakes(), loadPerformance()]);
    setMistakes(m);
    setGroups(groupWeaknesses(m));
    setPerf(p);
    setReady(true);
  }, []);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void (async () => {
        const [m, p] = await Promise.all([loadMistakes(), loadPerformance()]);
        if (!alive) return;
        setMistakes(m);
        setGroups(groupWeaknesses(m));
        setPerf(p);
        setReady(true);
      })();
      return () => {
        alive = false;
      };
    }, [])
  );

  const types = countByType(mistakes);
  const best = perf.length ? Math.max(...perf.map((p) => p.pct)) : 0;
  const latest = perf.length ? perf[perf.length - 1] : null;

  return (
    <Screen>
      <Text variant="display" style={{ marginTop: spacing.lg }}>
        {t('tab.progress')}
      </Text>

      {!ready ? null : mistakes.length === 0 && perf.length === 0 ? (
        <EmptyState
          glyph="◇"
          title={t('progress.emptyTitle')}
          body={t('progress.emptyBody')}
        />
      ) : (
        <>
          {/* ── performance, only once there is something to say ───────── */}
          {perf.length > 0 ? (
            <View style={{ marginTop: sectionGap }}>
              <SectionHeader title={t('progress.performance')} />
              <Card>
                <View style={{ flexDirection: 'row', gap: spacing.xl }}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text variant="caption" tone="muted">
                      {t('progress.latest')}
                    </Text>
                    <Text variant="numeric" style={{ fontSize: 26 }}>
                      {latest?.score}/{latest?.maxScore}
                    </Text>
                    <Text variant="caption" tone="secondary">
                      {latest?.paperType.replace(/_/g, ' ')}
                    </Text>
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text variant="caption" tone="muted">
                      {t('progress.best')}
                    </Text>
                    <Text variant="numeric" style={{ fontSize: 26 }}>
                      {best}%
                    </Text>
                    <Text variant="caption" tone="secondary">
                      {t('progress.attempts', { n: perf.length })}
                    </Text>
                  </View>
                </View>

                {/* Trend only when a trend exists — two points is a line, one
                    point is a dot pretending to be one. */}
                {perf.length >= 2 ? (
                  <View style={{ marginTop: spacing.lg, gap: spacing.sm }}>
                    {perf.slice(-6).map((p) => (
                      <View
                        key={p.attemptId}
                        style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}
                      >
                        <Text variant="caption" tone="muted" style={{ width: 74 }} numberOfLines={1}>
                          {p.paperType.replace('CTET_', '').replace(/_/g, ' ')}
                        </Text>
                        <View style={{ flex: 1 }}>
                          <MasteryBar value={p.pct} width="100%" />
                        </View>
                        <Text variant="numeric" tone="secondary" style={{ fontSize: 12, width: 36 }}>
                          {p.pct}%
                        </Text>
                      </View>
                    ))}
                  </View>
                ) : null}
              </Card>
            </View>
          ) : null}

          {/* ── the mistake notebook ───────────────────────────────────── */}
          <View style={{ marginTop: sectionGap }}>
            <SectionHeader title={t('progress.mistakes')} />

            {mistakes.length === 0 ? (
              <EmptyState glyph="✓" title={t('progress.noMistakes')} body={t('progress.noMistakesBody')} />
            ) : (
              <>
                <Text variant="bodyStrong" style={{ marginBottom: spacing.md }}>
                  {t('progress.repeatedly')}
                </Text>

                {/* mistake-type distribution — how she fails, not just where */}
                {types.length > 0 ? (
                  <View
                    style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.lg }}
                  >
                    {types.map((tc) => (
                      <View
                        key={tc.type}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 5,
                          paddingHorizontal: spacing.md,
                          paddingVertical: 5,
                          borderRadius: 999,
                          backgroundColor: colors.surfaceSunken,
                        }}
                      >
                        <Text variant="caption" tone="secondary">
                          {tc.type === 'untagged' ? t('progress.untagged') : t(`review.mistake.${tc.type}`)}
                        </Text>
                        <Text variant="numeric" tone="muted" style={{ fontSize: 12 }}>
                          {tc.count}
                        </Text>
                      </View>
                    ))}
                  </View>
                ) : null}

                <View style={{ gap: spacing.md }}>
                  {groups.map((g) => {
                    const expanded = open === g.key;
                    return (
                      <Card key={g.key}>
                        <Pressable onPress={() => setOpen(expanded ? null : g.key)}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                            <View
                              style={{
                                minWidth: 34,
                                height: 34,
                                borderRadius: radius.sm,
                                backgroundColor: g.count >= 3 ? colors.errorSoft : colors.surfaceSunken,
                                alignItems: 'center',
                                justifyContent: 'center',
                                paddingHorizontal: 6,
                              }}
                            >
                              <Text
                                variant="numeric"
                                color={g.count >= 3 ? colors.error : colors.inkSecondary}
                              >
                                {g.count}
                              </Text>
                            </View>
                            <View style={{ flex: 1 }}>
                              <Text variant="bodyStrong" numberOfLines={2}>
                                {g.subject}
                              </Text>
                              {g.topicId ? (
                                <Text variant="caption" tone="muted">
                                  {g.topicId}
                                </Text>
                              ) : null}
                            </View>
                            <Text variant="caption" tone="muted">
                              {expanded ? '▴' : '▾'}
                            </Text>
                          </View>
                        </Pressable>

                        {expanded ? (
                          <View style={{ marginTop: spacing.md, gap: spacing.md }}>
                            {g.items.map((m) => (
                              <View
                                key={m.id}
                                style={{
                                  gap: 6,
                                  paddingTop: spacing.sm,
                                  borderTopWidth: 1,
                                  borderTopColor: colors.hairline,
                                }}
                              >
                                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                                  <Text variant="numeric" tone="muted" style={{ fontSize: 12 }}>
                                    {t('exam.question')} {m.number}
                                  </Text>
                                  <Text variant="caption" tone="muted" style={{ flex: 1 }}>
                                    {m.paperType.replace(/_/g, ' ')}
                                  </Text>
                                  {m.mistake_type ? (
                                    <Text variant="caption" color={colors.accent}>
                                      {t(`review.mistake.${m.mistake_type}`)}
                                    </Text>
                                  ) : null}
                                </View>

                                <Text variant="body" numberOfLines={3}>
                                  {(contentLang === 'hi' && m.stem_hi) || m.stem_en}
                                </Text>

                                <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'center' }}>
                                  <Text variant="caption" color={colors.error}>
                                    ✕ {m.chosen ?? '—'}
                                  </Text>
                                  <Text variant="caption" color={colors.successText}>
                                    ✓ {m.correct ?? '—'}
                                  </Text>
                                  <View style={{ flex: 1 }} />
                                  <Pressable
                                    onPress={async () => {
                                      await resolveMistake(m.id);
                                      await refresh();
                                    }}
                                    hitSlop={8}
                                    accessibilityLabel={t('progress.markFixed')}
                                    style={{
                                      paddingHorizontal: spacing.md,
                                      paddingVertical: 5,
                                      borderRadius: 999,
                                      borderWidth: 1.5,
                                      borderColor: colors.hairlineStrong,
                                    }}
                                  >
                                    <Text variant="caption" tone="secondary">
                                      {t('progress.markFixed')}
                                    </Text>
                                  </Pressable>
                                </View>
                              </View>
                            ))}
                          </View>
                        ) : null}
                      </Card>
                    );
                  })}
                </View>
              </>
            )}
          </View>

          {/* ── readiness stays locked until it can be justified ────────── */}
          <View style={{ marginTop: sectionGap, marginBottom: sectionGap }}>
            <SectionHeader title={t('today.readiness')} />
            <Card tone="sunken">
              <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'center' }}>
                <Text variant="h2" tone="muted">
                  ◌
                </Text>
                <Text variant="caption" tone="muted" style={{ flex: 1 }}>
                  {t('today.readinessLocked')}
                </Text>
              </View>
            </Card>
          </View>
        </>
      )}
    </Screen>
  );
}
