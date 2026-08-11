import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BackHandler, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Text } from '@/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { useT } from '@/i18n/useT';
import { useProfile } from '@/store/profile';
import { useExam } from '@/exam/useExam';
import { ExamTimer } from '@/exam/ExamTimer';
import { QuestionPalette, PaletteLegend, useStateColors } from '@/exam/QuestionPalette';
import { paletteState, scoreAttempt } from '@/exam/scoring';
import { openLocalDb } from '@/db/local';
import { optionTextFor, stemFor } from '@/content/localise';
import { LanguageToggle } from '@/content/LanguageToggle';
import { Passage } from '@/content/Passage';

/**
 * The exam player.
 *
 * PERFORMANCE OVER BEAUTY, deliberately. Inside an active timed test there are
 * no transitions, no Reanimated on the question surface and no haptics: option
 * selection is an instant colour swap. Everything decorative in this app is
 * suspended here, because a dropped frame while she is reading under time
 * pressure costs more than any animation is worth.
 *
 * Faithful to the real NTA/CBSE interface — five palette states, Save & Next,
 * Clear Response, Mark for Review & Next, section tabs, in-test language
 * toggle, pre-submit summary — with cleaner typography and spacing.
 */
export default function ExamPlayer() {
  const { paperId } = useLocalSearchParams<{ paperId: string }>();
  const router = useRouter();
  const { colors, spacing, radius } = useTheme();
  const { t, contentLang } = useT();
  const insets = useSafeAreaInsets();
  const setProfile = useProfile((s) => s.set);
  const sc = useStateColors();

  const exam = useExam(paperId!);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [confirmExit, setConfirmExit] = useState(false);
  const [submitting, setSubmitting] = useState(false);


  const submit = useCallback(
    async (auto: boolean) => {
      if (!exam.attemptId || !exam.paper || submitting) return;
      setSubmitting(true);

      if (exam.current) exam.flushTime(exam.current.id);

      const responses = new Map(
        [...exam.responses.entries()].map(([k, v]) => [k, { chosen: v.chosen, timeMs: v.timeMs }])
      );
      const result = scoreAttempt(exam.paper, exam.questions, responses);

      // Commit to SQLite BEFORE navigating. The results screen is proof of a
      // local write, never of a network call.
      const db = await openLocalDb();
      // Measured from the attempt's own start time, so a resumed attempt
      // reports the real total rather than only the final sitting.
      const started = await db.getFirstAsync<{ started_at: number }>(
        'SELECT started_at FROM attempts WHERE id = ?',
        exam.attemptId
      );
      const durationS = started ? Math.floor((Date.now() - started.started_at) / 1000) : 0;
      await db.runAsync(
        `UPDATE attempts SET submitted_at = ?, duration_s = ?, score = ?, max_score = ?,
           correct = ?, incorrect = ?, unattempted = ?, bonus_awarded = ? WHERE id = ?`,
        Date.now(),
        durationS,
        result.score,
        result.maxScore,
        result.correct,
        result.incorrect,
        result.unattempted,
        result.bonusAwarded,
        exam.attemptId
      );

      for (const o of result.outcomes) {
        await db.runAsync(
          `UPDATE responses SET is_correct = ? WHERE attempt_id = ? AND question_id = ?`,
          o.attempted ? (o.isCorrect ? 1 : 0) : null,
          exam.attemptId,
          o.questionId
        );
        if (o.attempted && !o.isCorrect) {
          await db.runAsync(
            `INSERT OR REPLACE INTO mistakes
               (id, attempt_id, question_id, paper_id, topic_id, chosen, correct, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            `mis_${exam.attemptId}_${o.questionId}`,
            exam.attemptId,
            o.questionId,
            exam.paper.id,
            o.topicId,
            o.chosen,
            o.correctLabels.join('/'),
            Date.now()
          );
        }
      }

      router.replace({ pathname: '/exam/result/[attemptId]', params: { attemptId: exam.attemptId } });
    },
    [exam, router, submitting]
  );

  // Android back must never silently discard a timed attempt.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setConfirmExit(true);
      return true;
    });
    return () => sub.remove();
  }, []);

  if (exam.loading || !exam.paper || !exam.current) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center', alignItems: 'center' }}>
        <Text variant="body" tone="muted">
          {t('exam.loading')}
        </Text>
      </View>
    );
  }

  const q = exam.current;
  const r = exam.responses.get(q.id);
  const stem = stemFor(q, contentLang).text;

  const activeSection = exam.sections.find((s) => exam.index >= s.from && exam.index <= s.to);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
      {/* ── section tabs ─────────────────────────────────────────────── */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0, borderBottomWidth: 1, borderBottomColor: colors.hairline }}
        contentContainerStyle={{ paddingHorizontal: spacing.md, gap: spacing.sm }}
      >
        {exam.sections.map((s) => {
          const active = activeSection?.part === s.part;
          return (
            <Pressable
              key={s.part + s.from}
              onPress={() => exam.go(s.from)}
              style={{
                paddingVertical: spacing.sm,
                paddingHorizontal: spacing.md,
                borderBottomWidth: 2.5,
                borderBottomColor: active ? colors.accent : 'transparent',
              }}
            >
              <Text variant="caption" color={active ? colors.accent : colors.inkMuted} numberOfLines={1}>
                {s.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* ── status bar: number, timer, language ──────────────────────── */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: spacing.lg,
          paddingVertical: spacing.sm,
          borderBottomWidth: 1,
          borderBottomColor: colors.hairline,
        }}
      >
        <Text variant="numeric" tone="secondary">
          {t('exam.question')} {q.number} / {exam.questions.length}
        </Text>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <ExamTimer
            durationS={exam.paper.duration_min * 60}
            elapsedAtStartS={exam.elapsedAtStartS}
            paused={exam.paused}
            onExpire={() => void submit(true)}
          />
          <Pressable
            onPress={() => void exam.pause()}
            hitSlop={10}
            accessibilityLabel={t('exam.pause')}
            disabled={exam.paused}
          >
            <Text variant="caption" tone="secondary">
              ⏸
            </Text>
          </Pressable>
        </View>

        {/* Switches the rendering in place — her answer, the running timer and
            her scroll position are untouched, because none of them are keyed
            on language. */}
        <LanguageToggle question={q} options={q.options} compact />
      </View>

      {/* ── question surface ─────────────────────────────────────────── */}
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing['2xl'] }}
        keyboardShouldPersistTaps="handled"
      >
        {/* The passage a comprehension question refers to. Expanded only on the
            first question of its block — after that it is 2,000 characters
            between her and the question she is trying to answer. */}
        <Passage
          question={q}
          startExpanded={exam.questions[exam.index - 1]?.passage_en !== q.passage_en}
        />

        {q.status === 'bonus' ? (
          <View
            style={{
              padding: spacing.sm,
              marginBottom: spacing.md,
              borderRadius: radius.sm,
              backgroundColor: colors.warningSoft,
            }}
          >
            <Text variant="caption" color={colors.warningText}>
              ⓘ {t('exam.bonusNotice')}
            </Text>
          </View>
        ) : null}

        <Text variant="question" style={{ marginBottom: spacing.xl }}>
          {stem}
        </Text>

        {q.options.map((o) => {
          const selected = r?.chosen === o.label;
          const text = optionTextFor(o, contentLang).text;
          return (
            <Pressable
              key={o.label}
              onPress={() => exam.select(o.label)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={`${o.label}. ${text}`}
              // No animation: inside a timed test this is an instant swap.
              style={{
                flexDirection: 'row',
                gap: spacing.md,
                alignItems: 'flex-start',
                padding: spacing.md,
                marginBottom: spacing.sm,
                borderRadius: radius.md,
                borderWidth: selected ? 2 : 1,
                borderColor: selected ? colors.accent : colors.hairlineStrong,
                backgroundColor: selected ? colors.accentSoft : colors.surface,
              }}
            >
              <View
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 999,
                  borderWidth: 1.5,
                  borderColor: selected ? colors.accent : colors.hairlineStrong,
                  backgroundColor: selected ? colors.accent : 'transparent',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text variant="caption" color={selected ? colors.accentInk : colors.inkMuted}>
                  {o.label}
                </Text>
              </View>
              <Text variant="option" style={{ flex: 1 }}>
                {text}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* ── action bar ───────────────────────────────────────────────── */}
      <View
        style={{
          borderTopWidth: 1,
          borderTopColor: colors.hairline,
          backgroundColor: colors.surface,
          paddingHorizontal: spacing.md,
          paddingTop: spacing.sm,
          paddingBottom: Math.max(insets.bottom, spacing.sm),
          gap: spacing.sm,
        }}
      >
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <ActionButton label={t('exam.clear')} onPress={exam.clearResponse} />
          <ActionButton label={t('exam.markNext')} onPress={exam.markAndNext} />
          <ActionButton label={t('exam.saveNext')} onPress={exam.saveAndNext} primary />
        </View>

        <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
          <Pressable
            onPress={() => setPaletteOpen(true)}
            style={{
              flex: 1,
              paddingVertical: spacing.sm,
              borderRadius: radius.sm,
              borderWidth: 1,
              borderColor: colors.hairlineStrong,
              alignItems: 'center',
            }}
            accessibilityLabel={t('exam.palette')}
          >
            <Text variant="caption" tone="secondary">
              ▦ {t('exam.palette')}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setConfirmExit(true)}
            style={{
              paddingVertical: spacing.sm,
              paddingHorizontal: spacing.lg,
              borderRadius: radius.sm,
              backgroundColor: colors.primary,
            }}
            accessibilityLabel={t('exam.submit')}
          >
            <Text variant="button" color={colors.primaryInk}>
              {t('exam.submit')}
            </Text>
          </Pressable>
        </View>
      </View>

      <QuestionPalette
        visible={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        questions={exam.questions}
        responses={exam.responses}
        index={exam.index}
        onJump={exam.go}
        counts={exam.counts}
      />

      {/* ── pre-submit summary ───────────────────────────────────────── */}
      {confirmExit ? (
        <View
          style={{
            position: 'absolute',
            inset: 0,
            backgroundColor: colors.scrim,
            justifyContent: 'center',
            padding: spacing.lg,
          }}
        >
          <View style={{ backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md }}>
            <Text variant="h2">{t('exam.submitTitle')}</Text>
            <PaletteLegend counts={exam.counts} />
            {exam.counts.notAnswered + exam.counts.notVisited > 0 ? (
              <Text variant="caption" color={colors.error}>
                ⚠ {t('exam.unansweredWarning', {
                  n: exam.counts.notAnswered + exam.counts.notVisited,
                })}
              </Text>
            ) : null}
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
              <Pressable
                onPress={() => setConfirmExit(false)}
                style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.hairlineStrong, alignItems: 'center' }}
              >
                <Text variant="button" tone="secondary">
                  {t('exam.keepGoing')}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => void submit(false)}
                style={{ flex: 1, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: 'center' }}
              >
                <Text variant="button" color={colors.primaryInk}>
                  {t('exam.submitConfirm')}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      ) : null}

      {/*
        PAUSED OVERLAY.

        It covers the question completely, and that is the point rather than a
        side effect: if the stem stayed readable with the clock stopped, pause
        would be a way to study the paper untimed and the practice score would
        stop meaning anything. She is preparing for a real sitting where no such
        button exists.

        It is an overlay and not a route, so the question surface underneath
        stays mounted — resuming restores her selection and scroll position
        exactly, with nothing reloaded.
      */}
      {exam.paused ? (
        <View
          style={[
            StyleSheet.absoluteFill,
            {
            backgroundColor: colors.bg,
            justifyContent: 'center',
            alignItems: 'center',
            padding: spacing.xl,
            gap: spacing.md,
            },
          ]}
        >
          <Text variant="display">{t('exam.paused')}</Text>
          <Text variant="body" tone="muted" style={{ textAlign: 'center' }}>
            {t('exam.pausedBody')}
          </Text>
          <View style={{ height: spacing.md }} />
          <Button label={t('exam.resume')} onPress={() => void exam.resume()} />
          <Pressable onPress={() => router.back()} hitSlop={10}>
            <Text variant="button" tone="muted">
              {t('exam.exitPaused')}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function ActionButton({
  label,
  onPress,
  primary = false,
}: {
  label: string;
  onPress: () => void;
  primary?: boolean;
}) {
  const { colors, spacing, radius } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{
        flex: 1,
        minHeight: 44,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: spacing.sm,
        borderRadius: radius.sm,
        borderWidth: primary ? 0 : 1.5,
        borderColor: colors.hairlineStrong,
        backgroundColor: primary ? colors.accent : 'transparent',
      }}
    >
      <Text
        variant="caption"
        color={primary ? colors.accentInk : colors.inkSecondary}
        align="center"
        numberOfLines={2}
      >
        {label}
      </Text>
    </Pressable>
  );
}
