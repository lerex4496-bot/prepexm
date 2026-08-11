import React, { useCallback, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';

import { Button, Card, EmptyState, Screen, SectionHeader, Text } from '@/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { useT } from '@/i18n/useT';
import { getPaper, type PaperRow } from '@/db/content';
import {
  elapsedMs,
  findResumable,
  listAttempts,
  type AttemptRow,
} from '@/db/local';

/**
 * Every attempt at one paper.
 *
 * WHY THIS SCREEN EXISTS
 * ----------------------
 * Only the best score was ever shown, on the practice card. That is the least
 * useful number in the set: it hides whether she is improving, and improvement
 * is the only thing worth knowing eight months out from a real sitting. Three
 * attempts at 61%, 68%, 74% is a completely different situation from 74%, 68%,
 * 61%, and the card rendered both as "74".
 *
 * Re-attempting is deliberately allowed and deliberately additive: a retake
 * creates a NEW attempt rather than overwriting, so the trend survives. A study
 * app that quietly replaces your history teaches you nothing.
 */
export default function AttemptHistory() {
  const { paperId } = useLocalSearchParams<{ paperId: string }>();
  const router = useRouter();
  const { colors, spacing } = useTheme();
  const { t } = useT();

  const [paper, setPaper] = useState<PaperRow | null>(null);
  const [attempts, setAttempts] = useState<AttemptRow[]>([]);
  const [open, setOpen] = useState<AttemptRow | null>(null);
  const [ready, setReady] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        try {
          const [p, as, res] = await Promise.all([
            getPaper(paperId),
            listAttempts(paperId),
            findResumable(paperId),
          ]);
          if (!alive) return;
          setPaper(p);
          setAttempts(as);
          setOpen(res);
        } finally {
          if (alive) setReady(true);
        }
      })();
      return () => {
        alive = false;
      };
    }, [paperId])
  );

  const scored = attempts.filter((a) => a.max_score);
  const bestPct = scored.length
    ? Math.max(...scored.map((a) => (a.score ?? 0) / (a.max_score ?? 1)))
    : null;

  return (
    <Screen>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: spacing.lg,
        }}
      >
        <Text variant="display" style={{ flex: 1 }}>
          {t('history.title')}
        </Text>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Text variant="button" tone="muted">
            ✕
          </Text>
        </Pressable>
      </View>

      {paper ? (
        <Text variant="caption" tone="secondary" style={{ marginBottom: spacing.lg }}>
          {paper.paper_type.replace(/_/g, ' ')} · {paper.session_label}
        </Text>
      ) : null}

      {/* An open attempt is not history — it is unfinished work, and burying it
          under finished attempts is how it gets abandoned. */}
      {open ? (
        <Card
          onPress={() => router.push({ pathname: '/exam/[paperId]', params: { paperId } })}
          accessibilityLabel={t('papers.resume')}
        >
          <View style={{ gap: 3 }}>
            <Text variant="bodyStrong" color={colors.accent}>
              ▸ {t('papers.resume')}
            </Text>
            <Text variant="caption" tone="secondary">
              {open.active_since === null
                ? t('history.paused', { n: Math.floor(elapsedMs(open) / 60000) })
                : t('history.inProgress')}
            </Text>
          </View>
        </Card>
      ) : null}

      {!ready ? null : attempts.length === 0 ? (
        <EmptyState glyph="◇" title={t('history.empty')} body={t('history.emptyBody')} />
      ) : (
        <>
          <SectionHeader title={t('history.title')} />
          <View style={{ gap: spacing.md }}>
            {attempts.map((a) => {
              const pct = a.max_score
                ? Math.round(((a.score ?? 0) / a.max_score) * 100)
                : null;
              const isBest =
                bestPct !== null &&
                a.max_score != null &&
                (a.score ?? 0) / a.max_score === bestPct;
              const mins = Math.round(elapsedMs(a, a.submitted_at ?? undefined) / 60000);
              return (
                <Card
                  key={a.id}
                  onPress={() =>
                    router.push({
                      pathname: '/exam/result/[attemptId]',
                      params: { attemptId: a.id },
                    })
                  }
                  accessibilityLabel={`${pct ?? 0}%`}
                >
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: spacing.md,
                    }}
                  >
                    <View style={{ flex: 1, gap: 3 }}>
                      <Text variant="bodyStrong">
                        {a.score ?? 0} / {a.max_score ?? 0}
                        {isBest ? `  · ${t('history.best')}` : ''}
                      </Text>
                      <Text variant="caption" tone="secondary">
                        {new Date(a.submitted_at ?? a.started_at).toLocaleDateString()} ·{' '}
                        {t('history.took', { n: mins })}
                      </Text>
                    </View>
                    <Text variant="numeric" color={isBest ? colors.accent : colors.inkMuted}>
                      {pct !== null ? `${pct}%` : '—'}
                    </Text>
                  </View>
                </Card>
              );
            })}
          </View>
        </>
      )}

      {/* Hidden while an attempt is open: two live attempts at one paper is a
          state nothing downstream expects, and "resume" is almost always what
          she actually meant. */}
      {ready && !open ? (
        <View style={{ marginTop: spacing.xl }}>
          <Button
            label={t('history.retake')}
            onPress={() => router.push({ pathname: '/exam/[paperId]', params: { paperId } })}
          />
        </View>
      ) : null}
    </Screen>
  );
}
