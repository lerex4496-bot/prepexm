import React, { useCallback, useState } from 'react';
import { View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import { Card, EmptyState, Screen, SectionHeader, Text } from '@/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { useT } from '@/i18n/useT';
import { listSubjects, type SubjectRow } from '@/plan/todayPlan';

/**
 * Learn — browse the approved bank by the paper's own structure.
 *
 * An honest scope note: full concept pages (three explanation depths, diagrams,
 * key points) need authored concept content that the pipeline does not produce
 * yet — every question currently carries an empty topic_id. Rather than ship a
 * "coming soon" placeholder, this uses the structure we genuinely have: the
 * parts and subjects of the real papers, each drilling into practice.
 *
 * It becomes the concept tree once the syllabus tagger runs.
 */
export default function Learn() {
  const { colors, spacing, sectionGap } = useTheme();
  const { t } = useT();
  const router = useRouter();

  const [subjects, setSubjects] = useState<SubjectRow[] | null>(null);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void (async () => {
        const s = await listSubjects();
        if (alive) setSubjects(s);
      })();
      return () => {
        alive = false;
      };
    }, [])
  );

  // Group by part so Paper I's five sections read as sections, not a flat list.
  const byPart = new Map<string, SubjectRow[]>();
  for (const s of subjects ?? []) {
    const key = s.part ?? '—';
    const list = byPart.get(key);
    if (list) list.push(s);
    else byPart.set(key, [s]);
  }

  return (
    <Screen>
      <Text variant="display" style={{ marginTop: spacing.lg }}>
        {t('tab.learn')}
      </Text>

      {subjects === null ? null : subjects.length === 0 ? (
        <EmptyState glyph="◇" title={t('papers.empty')} body={t('papers.emptyBody')} />
      ) : (
        <>
          <Text variant="body" tone="secondary" style={{ marginTop: spacing.xs }}>
            {t('learn.subtitle')}
          </Text>

          {[...byPart.entries()].map(([part, rows]) => (
            <View key={part} style={{ marginTop: sectionGap }}>
              <SectionHeader title={part === '—' ? t('learn.other') : `${t('learn.part')} ${part}`} />
              <View style={{ gap: spacing.md }}>
                {rows.map((s) => (
                  <Card
                    key={`${part}-${s.subject}`}
                    onPress={() =>
                      router.push({ pathname: '/practice/quick', params: { subject: s.subject } })
                    }
                    accessibilityLabel={s.subject}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text variant="bodyStrong">{s.subject}</Text>
                        <Text variant="caption" tone="muted">
                          {t('papers.questions', { n: s.count })}
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
          ))}

          <View style={{ height: sectionGap }} />
        </>
      )}
    </Screen>
  );
}
