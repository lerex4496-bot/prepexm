import React, { useCallback, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import { Card, EmptyState, Screen, SectionHeader, SourceBadge, Text } from '@/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { useT } from '@/i18n/useT';
import { getMeta, listPapers, type PaperRow } from '@/db/content';
import { elapsedMs, findResumable, listAttempts, type AttemptRow } from '@/db/local';

type Segment = 'papers' | 'mocks';

/**
 * Practice hub.
 *
 * Papers and Mocks are separate SEGMENTS rather than separate destinations —
 * to a student both are "practice", and navigation shouldn't force her to
 * learn our provenance taxonomy to find a test. The separation that matters is
 * in the data and the badging: official papers come from a bundle that only
 * contains approved PYQ rows, and AI mocks will carry a visibly different
 * badge when they exist.
 */
export default function Practice() {
  const router = useRouter();
  const { colors, spacing, radius, sectionGap } = useTheme();
  const { t } = useT();

  const [segment, setSegment] = useState<Segment>('papers');
  const [papers, setPapers] = useState<PaperRow[]>([]);
  const [attempts, setAttempts] = useState<AttemptRow[]>([]);
  const [resumable, setResumable] = useState<Record<string, AttemptRow | null>>({});
  const [meta, setMeta] = useState<Record<string, string>>({});
  const [ready, setReady] = useState(false);

  // Refresh on focus so a submitted attempt shows immediately on return.
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        try {
          const [ps, m, as] = await Promise.all([listPapers(), getMeta(), listAttempts()]);
          if (!alive) return;
          // Keep the row, not a boolean: the card shows how much time she has
          // already spent, which is the thing that decides whether she has
          // enough left right now to be worth resuming.
          const res: Record<string, AttemptRow | null> = {};
          for (const p of ps) res[p.id] = await findResumable(p.id);
          if (!alive) return;
          setPapers(ps);
          setMeta(m);
          setAttempts(as);
          setResumable(res);
        } finally {
          if (alive) setReady(true);
        }
      })();
      return () => {
        alive = false;
      };
    }, [])
  );

  const bestFor = (paperId: string) => {
    const mine = attempts.filter((a) => a.paper_id === paperId && a.score != null);
    if (!mine.length) return null;
    return mine.reduce((b, a) => ((a.score ?? 0) > (b.score ?? 0) ? a : b));
  };

  return (
    <Screen>
      <Text variant="display" style={{ marginTop: spacing.lg }}>
        {t('tab.practice')}
      </Text>

      {/* Honest about a partial content bundle — an incomplete paper must
          never masquerade as the real thing. */}
      {meta.completeness === 'PARTIAL-DEV-BUILD' ? (
        <View
          style={{
            marginTop: spacing.md,
            padding: spacing.sm,
            borderRadius: radius.sm,
            backgroundColor: colors.warningSoft,
          }}
        >
          <Text variant="caption" color={colors.warningText}>
            ⚠ {t('papers.devBundle')}
          </Text>
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xl, marginBottom: spacing.lg }}>
        {(['papers', 'mocks'] as Segment[]).map((s) => {
          const active = segment === s;
          return (
            <Pressable
              key={s}
              onPress={() => setSegment(s)}
              style={{
                flex: 1,
                paddingVertical: spacing.sm,
                borderRadius: radius.sm,
                borderWidth: 1.5,
                borderColor: active ? colors.accent : colors.hairlineStrong,
                backgroundColor: active ? colors.accentSoft : 'transparent',
                alignItems: 'center',
              }}
            >
              <Text variant="button" color={active ? colors.accent : colors.inkSecondary}>
                {s === 'papers' ? t('papers.official') : t('papers.mocks')}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {segment === 'mocks' ? (
        <EmptyState glyph="◇" title={t('papers.mocks')} body={t('papers.mocksSoon')} />
      ) : !ready ? null : papers.length === 0 ? (
        <EmptyState glyph="◇" title={t('papers.empty')} body={t('papers.emptyBody')} />
      ) : (
        <>
          <SectionHeader title={t('papers.title')} />
          <View style={{ gap: spacing.md, marginBottom: sectionGap }}>
            {papers.map((p) => {
              const best = bestFor(p.id);
              const open = resumable[p.id];
              const usedMin = open ? Math.floor(elapsedMs(open) / 60000) : 0;
              const mine = attempts.filter((a) => a.paper_id === p.id);
              return (
                <Card
                  key={p.id}
                  onPress={() => router.push({ pathname: '/exam/[paperId]', params: { paperId: p.id } })}
                  accessibilityLabel={`${p.paper_type} ${p.session_label}`}
                >
                  <View style={{ gap: spacing.sm }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <View style={{ flex: 1, gap: 3 }}>
                        <Text variant="bodyStrong">{p.paper_type.replace(/_/g, ' ')}</Text>
                        <Text variant="caption" tone="secondary">
                          {p.session_label} · {t('papers.questions', { n: p.total_questions })} ·{' '}
                          {t('papers.minutes', { n: p.duration_min })}
                        </Text>
                      </View>
                      <SourceBadge kind="official" label={t('badge.official')} />
                    </View>

                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                      <Text
                        variant="caption"
                        color={open ? colors.accent : colors.inkMuted}
                        style={{ flex: 1 }}
                      >
                        {open
                          ? `▸ ${t('papers.resume')} · ${t('papers.usedMin', { n: usedMin })}`
                          : best
                            ? t('papers.bestScore', { score: best.score ?? 0, max: best.max_score ?? 0 })
                            : t('papers.notAttempted')}
                      </Text>
                      {mine.length ? (
                        <Pressable
                          onPress={() =>
                            router.push({ pathname: '/exam/history/[paperId]', params: { paperId: p.id } })
                          }
                          hitSlop={8}
                          accessibilityLabel={t('history.title')}
                        >
                          <Text variant="caption" color={colors.accent}>
                            {t('papers.attempts', { n: mine.length })}
                          </Text>
                        </Pressable>
                      ) : null}
                      <Text variant="h3" tone="muted">
                        ›
                      </Text>
                    </View>
                  </View>
                </Card>
              );
            })}
          </View>
        </>
      )}
    </Screen>
  );
}
