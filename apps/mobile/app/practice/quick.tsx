import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';

import { Button, Card, ProgressRing, Screen, Text } from '@/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { useT } from '@/i18n/useT';
import { useProfile } from '@/store/profile';
import { currentExam, openContentDb, type LoadedQuestion } from '@/db/content';
import { loadMistakes } from '@/db/mistakes';
import { AskTutorButton, TutorSheet } from '@/tutor/TutorSheet';
import { explanationFor, optionTextFor, stemFor } from '@/content/localise';
import { LanguageToggle } from '@/content/LanguageToggle';
import { Passage } from '@/content/Passage';

/**
 * Quick practice — untimed, immediate feedback.
 *
 * Deliberately NOT the exam player. That screen is a faithful, austere replica
 * of the real CBSE interface where performance beats beauty; this one is for
 * learning, so it answers immediately, explains, and uses the motion and
 * haptics the exam surface forbids.
 *
 * Sources: a subject, or her own unresolved mistakes.
 */
export default function QuickPractice() {
  const { mode, subject } = useLocalSearchParams<{ mode?: string; subject?: string }>();
  const router = useRouter();
  const { colors, spacing, radius } = useTheme();
  const { t, contentLang } = useT();
  const reducedMotion = useProfile((s) => s.profile.reducedMotion);

  const [questions, setQuestions] = useState<LoadedQuestion[]>([]);
  const [index, setIndex] = useState(0);
  const [chosen, setChosen] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [correctCount, setCorrect] = useState(0);
  const [done, setDone] = useState(false);
  const [tutorOpen, setTutorOpen] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const db = await openContentDb();
      let ids: string[] = [];

      if (mode === 'mistakes') {
        const m = await loadMistakes();
        ids = [...new Set(m.map((x) => x.question_id))].slice(0, 12);
      }

      // Every path joins papers and filters on exam_code. Practice must never
      // serve another exam's questions — that was the NEET-shows-CTET bug.
      const exam = currentExam();
      let rows: LoadedQuestion[] = [];
      if (ids.length) {
        const ph = ids.map(() => '?').join(',');
        rows = await db.getAllAsync<any>(
          `SELECT q.* FROM questions q JOIN papers p ON p.id = q.paper_id
            WHERE q.id IN (${ph}) AND p.exam_code = ?`,
          ...ids,
          exam
        );
      } else if (subject) {
        rows = await db.getAllAsync<any>(
          `SELECT q.* FROM questions q JOIN papers p ON p.id = q.paper_id
            WHERE q.subject = ? AND p.exam_code = ?
            ORDER BY RANDOM() LIMIT 12`,
          subject,
          exam
        );
      } else {
        rows = await db.getAllAsync<any>(
          `SELECT q.* FROM questions q JOIN papers p ON p.id = q.paper_id
            WHERE p.exam_code = ? ORDER BY RANDOM() LIMIT 12`,
          exam
        );
      }

      if (!rows.length) {
        if (alive) { setReady(true); setDone(true); }
        return;
      }

      const ph = rows.map(() => '?').join(',');
      const opts = await db.getAllAsync<any>(
        `SELECT * FROM options WHERE question_id IN (${ph}) ORDER BY question_id, label`,
        ...rows.map((r) => r.id)
      );
      const byQ = new Map<string, any[]>();
      for (const o of opts) {
        const l = byQ.get(o.question_id);
        if (l) l.push(o);
        else byQ.set(o.question_id, [o]);
      }

      if (!alive) return;
      setQuestions(rows.map((r) => ({ ...r, options: byQ.get(r.id) ?? [] })));
      setReady(true);
    })();
    return () => {
      alive = false;
    };
  }, [mode, subject]);

  const q = questions[index];
  const correctLabels = useMemo(
    () => (q ? q.options.filter((o) => o.is_correct === 1).map((o) => o.label) : []),
    [q]
  );

  const pick = useCallback(
    (label: string) => {
      if (revealed || !q) return;
      setChosen(label);
      setRevealed(true);
      // Bonus questions were voided by the board — any attempt is correct.
      const right = q.status === 'bonus' || correctLabels.includes(label);
      if (right) setCorrect((c) => c + 1);
      if (!reducedMotion) {
        void Haptics.notificationAsync(
          right ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error
        );
      }
    },
    [revealed, q, correctLabels, reducedMotion]
  );

  const next = useCallback(() => {
    if (index + 1 >= questions.length) {
      setDone(true);
      return;
    }
    setIndex((i) => i + 1);
    setChosen(null);
    setRevealed(false);
  }, [index, questions.length]);

  if (!ready) {
    return (
      <Screen>
        <Text variant="body" tone="muted">
          {t('exam.loading')}
        </Text>
      </Screen>
    );
  }

  if (done || !q) {
    const pct = questions.length ? Math.round((correctCount / questions.length) * 100) : 0;
    return (
      <Screen>
        <View style={{ alignItems: 'center', paddingVertical: spacing['3xl'], gap: spacing.lg }}>
          {questions.length ? (
            <>
              <ProgressRing value={pct} size={96} label={t('result.score')} />
              <Text variant="h1">
                {correctCount} / {questions.length}
              </Text>
            </>
          ) : (
            <Text variant="h2" align="center">
              {t('quick.nothing')}
            </Text>
          )}
          <Button label={t('result.done')} size="lg" onPress={() => router.back()} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: spacing.md,
          marginBottom: spacing.lg,
        }}
      >
        <Text variant="numeric" tone="secondary">
          {index + 1} / {questions.length}
        </Text>
        <Text variant="caption" tone="muted" numberOfLines={1} style={{ flex: 1, textAlign: 'center' }}>
          {subject ?? (mode === 'mistakes' ? t('quick.fromMistakes') : t('quick.mixed'))}
        </Text>
        <LanguageToggle question={q} options={q.options} compact />
        <Pressable onPress={() => router.back()} hitSlop={10} style={{ marginLeft: spacing.sm }}>
          <Text variant="button" tone="muted">
            ✕
          </Text>
        </Pressable>
      </View>

      {/* Quick practice shuffles questions, so a passage is always new here. */}
      <Passage question={q} />

      <Text variant="question" style={{ marginBottom: spacing.xl }}>
        {stemFor(q, contentLang).text}
      </Text>

      {q.options.map((o) => {
        const isChosen = chosen === o.label;
        const isRight = correctLabels.includes(o.label);
        // Nothing is revealed until she commits — otherwise it is reading, not recall.
        const show = revealed;
        const bg = !show
          ? colors.surface
          : isRight
            ? colors.successSoft
            : isChosen
              ? colors.errorSoft
              : colors.surface;
        const border = !show
          ? isChosen
            ? colors.accent
            : colors.hairlineStrong
          : isRight
            ? colors.successText
            : isChosen
              ? colors.error
              : colors.hairlineStrong;

        return (
          <Pressable
            key={o.label}
            onPress={() => pick(o.label)}
            disabled={revealed}
            accessibilityRole="radio"
            accessibilityState={{ selected: isChosen, disabled: revealed }}
            style={{
              flexDirection: 'row',
              gap: spacing.md,
              padding: spacing.md,
              marginBottom: spacing.sm,
              borderRadius: radius.md,
              borderWidth: show && (isRight || isChosen) ? 2 : 1,
              borderColor: border,
              backgroundColor: bg,
            }}
          >
            <Text variant="caption" tone={show && isRight ? 'success' : 'muted'}>
              {show ? (isRight ? '✓' : isChosen ? '✕' : ' ') : '·'} ({o.label})
            </Text>
            <Text variant="option" style={{ flex: 1 }}>
              {optionTextFor(o, contentLang).text}
            </Text>
          </Pressable>
        );
      })}

      {revealed ? (
        <View style={{ marginTop: spacing.lg, gap: spacing.md }}>
          {q.status === 'bonus' ? (
            <Text variant="caption" color={colors.warningText}>
              ⓘ {t('exam.bonusNotice')}
            </Text>
          ) : null}
          <Card tone="sunken">
            <Text variant="caption" tone="muted">
              {t('review.whyWrong').toUpperCase()}
            </Text>
            <Text variant="body" tone="secondary" style={{ marginTop: 4 }}>
              {explanationFor(q, contentLang)?.text || t('review.noExplanation')}
            </Text>
          </Card>
          {/* Contextual, and only AFTER she has committed to an answer —
              offering help before that would turn recall into reading. */}
          <AskTutorButton onPress={() => setTutorOpen(true)} />
          <Button
            label={index + 1 >= questions.length ? t('result.done') : t('common.next')}
            size="lg"
            fullWidth
            onPress={next}
          />
        </View>
      ) : null}

      <TutorSheet
        visible={tutorOpen}
        onClose={() => setTutorOpen(false)}
        topic={q.stem_en}
        subject={q.subject}
      />
    </Screen>
  );
}
