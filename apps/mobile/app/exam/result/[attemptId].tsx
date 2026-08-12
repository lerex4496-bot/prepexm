import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { Button, Card, ProgressRing, Screen, SectionHeader, Text } from '@/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { useT } from '@/i18n/useT';
import { getPaper, loadPaperQuestions, type LoadedQuestion, type PaperRow } from '@/db/content';
import { getAttempt, loadResponses, openLocalDb, type AttemptRow, type MistakeType } from '@/db/local';
import { explanationFor, optionTextFor, stemFor } from '@/content/localise';
import { ExplainOnDemand } from '@/content/ExplainOnDemand';
import { LanguageToggle } from '@/content/LanguageToggle';
import { Passage } from '@/content/Passage';

const MISTAKE_TYPES: MistakeType[] = [
  'conceptual',
  'calculation',
  'misread',
  'silly',
  'confused',
  'memory',
  'time_pressure',
];

/**
 * Result + question review.
 *
 * The review order is deliberate: verdict, then WHY, then why the other
 * options are wrong, then what it tested, then what to do next. Marks alone
 * teach nothing — the distractor analysis is the part that builds the
 * exam-specific skill of recognising a plausible wrong option.
 *
 * The mistake type is captured from HER, one tap, not inferred by a model.
 */
export default function ResultScreen() {
  const { attemptId } = useLocalSearchParams<{ attemptId: string }>();
  const router = useRouter();
  const { colors, spacing, radius, sectionGap } = useTheme();
  const { t, contentLang } = useT();

  const [attempt, setAttempt] = useState<AttemptRow | null>(null);
  const [paper, setPaper] = useState<PaperRow | null>(null);
  const [questions, setQuestions] = useState<LoadedQuestion[]>([]);
  const [responses, setResponses] = useState<Map<string, { chosen: string | null; isCorrect: number | null; timeMs: number }>>(new Map());
  const [mistakeTypes, setMistakeTypes] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<'all' | 'mistakes'>('mistakes');
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const a = await getAttempt(attemptId!);
      if (!a) return;
      const [p, qs, rows] = await Promise.all([
        getPaper(a.paper_id),
        loadPaperQuestions(a.paper_id),
        loadResponses(attemptId!),
      ]);
      const db = await openLocalDb();
      const mis = await db.getAllAsync<{ question_id: string; mistake_type: string | null }>(
        'SELECT question_id, mistake_type FROM mistakes WHERE attempt_id = ?',
        attemptId!
      );
      setAttempt(a);
      setPaper(p);
      setQuestions(qs);
      setResponses(
        new Map(rows.map((r) => [r.question_id, { chosen: r.chosen, isCorrect: r.is_correct, timeMs: r.time_ms }]))
      );
      setMistakeTypes(Object.fromEntries(mis.filter((m) => m.mistake_type).map((m) => [m.question_id, m.mistake_type!])));
    })();
  }, [attemptId]);

  const shown = useMemo(() => {
    if (filter === 'all') return questions;
    return questions.filter((q) => responses.get(q.id)?.isCorrect === 0);
  }, [filter, questions, responses]);

  const setType = async (questionId: string, type: MistakeType) => {
    setMistakeTypes((m) => ({ ...m, [questionId]: type }));
    const db = await openLocalDb();
    await db.runAsync(
      'UPDATE mistakes SET mistake_type = ? WHERE attempt_id = ? AND question_id = ?',
      type,
      attemptId!,
      questionId
    );
  };

  if (!attempt || !paper) {
    return (
      <Screen>
        <Text variant="body" tone="muted">
          …
        </Text>
      </Screen>
    );
  }

  const pct = attempt.max_score ? Math.round(((attempt.score ?? 0) / attempt.max_score) * 100) : 0;
  const mins = Math.floor((attempt.duration_s ?? 0) / 60);

  return (
    <Screen>
      <Text variant="display" style={{ marginTop: spacing.md }}>
        {t('result.title')}
      </Text>
      <Text variant="caption" tone="muted" style={{ marginBottom: spacing.xl }}>
        {paper.paper_type} · {paper.session_label} · {t('result.savedOffline')}
      </Text>

      {/* ── score ─────────────────────────────────────────────────── */}
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xl }}>
          <ProgressRing value={pct} size={86} label={t('result.score')} />
          <View style={{ flex: 1, gap: 3 }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
              <Text variant="numeric" style={{ fontSize: 30 }}>
                {attempt.score}
              </Text>
              <Text variant="body" tone="muted">
                / {attempt.max_score}
              </Text>
            </View>
            <Text variant="caption" tone="secondary">
              ✓ {attempt.correct} {t('result.correct')} · ✕ {attempt.incorrect} {t('result.incorrect')} · ○{' '}
              {attempt.unattempted} {t('result.unattempted')}
            </Text>
            {attempt.bonus_awarded > 0 ? (
              <Text variant="caption" color={colors.warningText}>
                ⓘ {attempt.bonus_awarded} {t('result.bonus')}
              </Text>
            ) : null}
            <Text variant="caption" tone="muted">
              {t('result.time')} {mins} {t('common.min')}
            </Text>
          </View>
        </View>
      </Card>

      {/* ── review filter ─────────────────────────────────────────── */}
      <View style={{ marginTop: sectionGap }}>
        <SectionHeader title={t('result.reviewAll')} />
        <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md }}>
          {(['mistakes', 'all'] as const).map((f) => (
            <Pressable
              key={f}
              onPress={() => setFilter(f)}
              style={{
                paddingHorizontal: spacing.lg,
                paddingVertical: spacing.sm,
                borderRadius: 999,
                borderWidth: 1.5,
                borderColor: filter === f ? colors.accent : colors.hairlineStrong,
                backgroundColor: filter === f ? colors.accentSoft : 'transparent',
              }}
            >
              <Text variant="caption" color={filter === f ? colors.accent : colors.inkSecondary}>
                {f === 'mistakes' ? t('result.reviewMistakes') : t('result.reviewAll')}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {shown.map((q) => {
        const r = responses.get(q.id);
        const correctLabels = q.options.filter((o) => o.is_correct === 1).map((o) => o.label);
        const isCorrect = r?.isCorrect === 1;
        const attempted = r?.chosen != null;
        const expanded = open === q.id;

        return (
          <Card key={q.id} style={{ marginBottom: spacing.md }}>
            <Pressable onPress={() => setOpen(expanded ? null : q.id)}>
              {/* 1. verdict — icon + label + colour, never colour alone */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                <Text
                  variant="h3"
                  color={!attempted ? colors.inkMuted : isCorrect ? colors.successText : colors.error}
                >
                  {!attempted ? '○' : isCorrect ? '✓' : '✕'}
                </Text>
                <Text variant="numeric" tone="secondary">
                  {t('exam.question')} {q.number}
                </Text>
                {q.status === 'bonus' ? (
                  <Text variant="caption" color={colors.warningText}>
                    {t('result.bonus')}
                  </Text>
                ) : null}
                <View style={{ flex: 1 }} />
                <Text variant="caption" tone="muted">
                  {expanded ? '▴' : '▾'}
                </Text>
              </View>

              <Text variant="body" style={{ marginTop: spacing.sm }} numberOfLines={expanded ? undefined : 2}>
                {stemFor(q, contentLang).text}
              </Text>
            </Pressable>

            {expanded ? (
              <View style={{ marginTop: spacing.md, gap: spacing.md }}>
                {/* Review is where checking a term against the other rendering
                    matters most — she is no longer under time pressure. */}
                <LanguageToggle question={q} options={q.options} />
                {/* Collapsed in review: she has already read it once, and the
                    reason she is here is the answer, not the text. */}
                <Passage question={q} startExpanded={false} />
                {/* 2. every option, with your pick and the official answer */}
                {q.options.map((o) => {
                  const chosen = r?.chosen === o.label;
                  const right = o.is_correct === 1;
                  return (
                    <View
                      key={o.label}
                      style={{
                        flexDirection: 'row',
                        gap: spacing.sm,
                        padding: spacing.sm,
                        borderRadius: radius.sm,
                        backgroundColor: right
                          ? colors.successSoft
                          : chosen
                            ? colors.errorSoft
                            : 'transparent',
                      }}
                    >
                      <Text
                        variant="caption"
                        color={right ? colors.successText : chosen ? colors.error : colors.inkMuted}
                      >
                        {right ? '✓' : chosen ? '✕' : '·'} ({o.label})
                      </Text>
                      <Text variant="option" style={{ flex: 1 }}>
                        {optionTextFor(o, contentLang).text}
                      </Text>
                    </View>
                  );
                })}

                <View style={{ height: 1, backgroundColor: colors.hairline }} />

                {/* 3. why — from approved content only; never invented here */}
                <View>
                  <Text variant="caption" tone="muted">
                    {t('review.whyWrong').toUpperCase()}
                  </Text>
                  <Text variant="body" tone="secondary" style={{ marginTop: 4 }}>
                    <ExplainOnDemand question={q} />
                  </Text>
                </View>

                {/* 4. what it tested */}
                {q.topic_id ? (
                  <Text variant="caption" tone="muted">
                    ◇ {q.topic_id}
                  </Text>
                ) : null}

                {/* 5. how did YOU get it wrong — self-classified, one tap */}
                {attempted && !isCorrect ? (
                  <View style={{ gap: spacing.sm }}>
                    <Text variant="caption" tone="muted">
                      {t('review.howWrong').toUpperCase()}
                    </Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                      {MISTAKE_TYPES.map((mt) => {
                        const active = mistakeTypes[q.id] === mt;
                        return (
                          <Pressable
                            key={mt}
                            onPress={() => void setType(q.id, mt)}
                            style={{
                              paddingHorizontal: spacing.md,
                              paddingVertical: 6,
                              borderRadius: 999,
                              borderWidth: 1.5,
                              borderColor: active ? colors.accent : colors.hairlineStrong,
                              backgroundColor: active ? colors.accentSoft : 'transparent',
                            }}
                          >
                            <Text
                              variant="caption"
                              color={active ? colors.accent : colors.inkSecondary}
                            >
                              {t(`review.mistake.${mt}`)}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                ) : null}
              </View>
            ) : null}
          </Card>
        );
      })}

      <View style={{ marginTop: spacing.lg, marginBottom: sectionGap }}>
        <Button
          label={t('result.done')}
          size="lg"
          fullWidth
          onPress={() => router.replace('/(tabs)/practice')}
        />
      </View>
    </Screen>
  );
}
