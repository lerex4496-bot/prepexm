import React, { useCallback, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import { Button, Card, EmptyState, Screen, SectionHeader, SourceBadge, Text } from '@/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { useT } from '@/i18n/useT';
import { getMeta, listPapers, listTopics, type PaperRow } from '@/db/content';
import { elapsedMs, findResumable, listAttempts, type AttemptRow } from '@/db/local';
import { DRILL_SIZE, SECTIONS, isMockId, mockIdFor, newMockSeed } from '@/exam/mockBuilder';
import { TOPIC_PRIORITY, TOTAL_SITTINGS } from '@/exam/topicPriority';

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
  const [topics, setTopics] = useState<Record<string, number>>({});
  const [showTopics, setShowTopics] = useState(false);
  const [ready, setReady] = useState(false);

  // Refresh on focus so a submitted attempt shows immediately on return.
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        try {
          const [ps, m, as, ts] = await Promise.all([
            listPapers(),
            getMeta(),
            listAttempts(),
            listTopics().catch(() => []),
          ]);
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
          setTopics(Object.fromEntries(ts.map((t) => [t.topicId, t.questions])));
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

  // Attempts whose paper id carries a mock seed. Newest first, de-duplicated
  // per mock so re-opening one shows a single row rather than one per sitting.
  const mockAttempts = Array.from(
    new Map(
      [...attempts]
        .filter((a) => isMockId(a.paper_id))
        .sort((x, y) => y.started_at - x.started_at)
        .map((a) => [a.paper_id, a] as const)
    ).values()
  );

  const go = (mode: 'full' | 'section' | 'topic' | 'priority' | 'weak', param: string) =>
    router.push({
      pathname: '/exam/[paperId]',
      params: { paperId: mockIdFor(newMockSeed(), mode, param) },
    });

  // How many questions exist for a section, so an empty one is not offered.
  const sectionCount = (code: string) => {
    const subjects = SECTIONS[code]?.subjects ?? [];
    return papers.length && subjects.length ? 1 : 0;
  };

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
        <View style={{ gap: spacing.md, marginBottom: sectionGap }}>
          <Text variant="caption" tone="secondary">
            {t('mock.intro')}
          </Text>

          <Button
            label={t('mock.start')}
            size="lg"
            fullWidth
            onPress={() => go('full', '-')}
          />

          {/* Shorter, sharper practice. A full paper is the right rehearsal but
              the wrong tool on a weeknight, and useless for fixing one topic. */}
          <SectionHeader title={t('mock.focused')} />

          <Card onPress={() => go('priority', '-')} accessibilityLabel={t('mock.priority')}>
            <Text variant="bodyStrong">{t('mock.priority')}</Text>
            <Text variant="caption" tone="secondary">
              {t('mock.priorityBody', { n: TOTAL_SITTINGS })}
            </Text>
          </Card>

          <Card onPress={() => go('weak', '-')} accessibilityLabel={t('mock.weak')}>
            <Text variant="bodyStrong">{t('mock.weak')}</Text>
            <Text variant="caption" tone="secondary">
              {t('mock.weakBody', { n: DRILL_SIZE })}
            </Text>
          </Card>

          {Object.keys(SECTIONS).map((code) => {
            const available = sectionCount(code);
            if (!available) return null;
            return (
              <Card key={code} onPress={() => go('section', code)} accessibilityLabel={t(`mock.section.${code}`)}>
                <Text variant="bodyStrong">{t(`mock.section.${code}`)}</Text>
                <Text variant="caption" tone="secondary">
                  {t('mock.sectionBody', {
                    n: SECTIONS[code].count,
                    min: SECTIONS[code].minutes,
                  })}
                </Text>
              </Card>
            );
          })}

          <Pressable onPress={() => setShowTopics((v) => !v)} hitSlop={8}>
            <Text variant="button" color={colors.accent}>
              {showTopics ? t('mock.hideTopics') : t('mock.byTopic')} {showTopics ? '˄' : '˅'}
            </Text>
          </Pressable>

          {/* Ordered by how often the examiners actually set each topic, so the
              top of this list is where revision time is best spent. */}
          {showTopics
            ? TOPIC_PRIORITY.filter((tp) => topics[tp.id]).map((tp) => (
                <Card key={tp.id} onPress={() => go('topic', tp.id)} accessibilityLabel={tp.name}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text variant="bodyStrong">{tp.name}</Text>
                      <Text variant="caption" tone="muted">
                        {tp.strand} · {t('mock.inSittings', { n: tp.sittings, of: TOTAL_SITTINGS })}
                      </Text>
                    </View>
                    <Text variant="caption" tone="muted">
                      {topics[tp.id]}
                    </Text>
                  </View>
                </Card>
              ))
            : null}

          {/* Mocks she has already sat. Attempts key on paper id, and a mock's
              id carries its seed, so reopening one rebuilds exactly the same
              paper — nothing about the selection has to be stored. */}
          {mockAttempts.length > 0 ? (
            <>
              <SectionHeader title={t('mock.previous')} />
              {mockAttempts.map((a) => (
                <Card
                  key={a.id}
                  onPress={() =>
                    router.push({ pathname: '/exam/[paperId]', params: { paperId: a.paper_id } })
                  }
                  accessibilityLabel={`${t('papers.mocks')} ${a.paper_id}`}
                >
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <View style={{ flex: 1, gap: 3 }}>
                      <Text variant="bodyStrong">{t('mock.title')}</Text>
                      <Text variant="caption" tone="secondary">
                        {a.submitted_at
                          ? t('papers.bestScore', { score: a.score ?? 0, max: a.max_score ?? 150 })
                          : t('papers.resume')}
                      </Text>
                    </View>
                    <SourceBadge kind="mock" label={t('badge.mock')} />
                  </View>
                </Card>
              ))}
            </>
          ) : null}
        </View>
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
