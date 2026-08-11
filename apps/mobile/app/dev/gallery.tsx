import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';

import {
  Button,
  Card,
  Chip,
  Divider,
  EmptyState,
  ErrorState,
  MasteryBar,
  OfflineBadge,
  ProgressRing,
  Screen,
  SectionHeader,
  Skeleton,
  SourceBadge,
  Text,
} from '@/ui';
import { useProfile, type Lang, type ThemePref } from '@/store/profile';
import { useTheme } from '@/theme/ThemeProvider';
import { type TypeVariant } from '@/theme/typography';
import { LANGUAGE_LABEL } from '@/i18n/strings';

/**
 * DESIGN GALLERY — the verification surface for the design system.
 *
 * This is where the Slice 0 typography risk actually gets tested. The specimen
 * below renders EVERY type token in all three scripts simultaneously, so
 * matra clipping, line-height and the Indic display step-down are visible side
 * by side on a real device rather than inferred from a spec table.
 *
 * The language and theme switches at the top change the whole app, not just
 * this screen — so flipping them here is a genuine end-to-end check.
 */

// Real strings, not lorem ipsum: a long Devanagari compound, a long Gujarati
// compound, and a mixed Indic+Latin line — the three cases that break layouts.
const SPECIMEN: Record<'latn' | 'deva' | 'gujr', string> = {
  latn: 'Cognitive Development',
  deva: 'संज्ञानात्मक विकास',
  gujr: 'સંજ્ઞાનાત્મક વિકાસ',
};

const LONG: Record<'latn' | 'deva' | 'gujr', string> = {
  latn: 'Continuous and Comprehensive Evaluation in the inclusive classroom',
  deva: 'समावेशी कक्षा में सतत एवं व्यापक मूल्यांकन की प्रक्रिया',
  gujr: 'સમાવેશી વર્ગખંડમાં સતત અને વ્યાપક મૂલ્યાંકનની પ્રક્રિયા',
};

const VARIANTS: TypeVariant[] = [
  'display',
  'h1',
  'h2',
  'h3',
  'body',
  'bodyStrong',
  'question',
  'option',
  'caption',
  'button',
  'numeric',
];

export default function Gallery() {
  const { colors, spacing, sectionGap, mode } = useTheme();
  const router = useRouter();
  const set = useProfile((s) => s.set);
  const contentLang = useProfile((s) => s.profile.contentLang);
  const themePref = useProfile((s) => s.profile.theme);
  const exam = useProfile((s) => s.profile.exam) ?? 'CTET';

  const [showStates, setShowStates] = useState<'empty' | 'error' | 'loading'>('empty');

  return (
    <Screen>
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: spacing.lg,
        }}
      >
        <Text variant="h1">Gallery</Text>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text variant="button" tone="muted">
            ✕
          </Text>
        </Pressable>
      </View>

      {/* ── global switches ────────────────────────────────────────────── */}
      <Card tone="sunken" style={{ marginBottom: sectionGap }}>
        <View style={{ gap: spacing.md }}>
          <Text variant="caption" tone="muted">
            LANGUAGE
          </Text>
          <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
            {(['en', 'hi', 'gu'] as Lang[]).map((l) => (
              <Chip key={l} label={LANGUAGE_LABEL[l]} selected={contentLang === l} onPress={() => set({ contentLang: l })} />
            ))}
          </View>

          <Text variant="caption" tone="muted">
            THEME · {mode}
          </Text>
          <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
            {(['system', 'light', 'dark'] as ThemePref[]).map((m) => (
              <Chip key={m} label={m} selected={themePref === m} onPress={() => set({ theme: m })} />
            ))}
          </View>

          <Text variant="caption" tone="muted">
            EXAM ACCENT · {exam}
          </Text>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            {(['CTET', 'NEET'] as const).map((e) => (
              <Chip key={e} label={e} selected={exam === e} onPress={() => set({ exam: e })} />
            ))}
          </View>
        </View>
      </Card>

      {/* ── the typography specimen: the whole point of this screen ────── */}
      <SectionHeader title="Type scale × 3 scripts" />
      <Text variant="caption" tone="muted" style={{ marginBottom: spacing.lg }}>
        Check for clipped matras above and below, and that display steps down for Indic.
      </Text>

      {VARIANTS.map((v) => (
        <View key={v} style={{ marginBottom: spacing.xl }}>
          <Text variant="caption" tone="muted" style={{ marginBottom: 6 }}>
            {v}
          </Text>
          <View style={{ gap: 4 }}>
            <Text variant={v}>{v === 'numeric' ? '1234567890  ·  02:14:37' : SPECIMEN.latn}</Text>
            <Text variant={v}>{v === 'numeric' ? '180 / 720' : SPECIMEN.deva}</Text>
            <Text variant={v}>{v === 'numeric' ? '47 min · 74%' : SPECIMEN.gujr}</Text>
          </View>
          <Divider />
        </View>
      ))}

      {/* ── mixed-script routing: the Mukta / Mukta Vaani boundary ─────── */}
      <SectionHeader title="Mixed-script routing" />
      <Text variant="caption" tone="muted" style={{ marginBottom: spacing.md }}>
        Each line mixes scripts in one string. The Gujarati runs must be Mukta Vaani and the Latin
        runs Mukta — if a run falls back to a system font the stroke weight will visibly disagree.
      </Text>
      <Card style={{ marginBottom: sectionGap }}>
        <View style={{ gap: spacing.sm }}>
          <Text variant="h2">કોષિકા (Cell)</Text>
          <Text variant="h2">कोशिका (Cell)</Text>
          <Text variant="body">DNA replication એ DNA ની નકલ બનાવવાની પ્રક્રિયા છે.</Text>
          <Text variant="body">Piaget के अनुसार concrete operational अवस्था 7–11 वर्ष की होती है।</Text>
          <Text variant="question">પ્રશ્ન 24: નેફ્રોન (Nephron) નું મુખ્ય કાર્ય શું છે?</Text>
        </View>
      </Card>

      {/* ── long strings: the text-expansion budget ────────────────────── */}
      <SectionHeader title="Long strings (expansion)" />
      <Card style={{ marginBottom: sectionGap }}>
        <View style={{ gap: spacing.md }}>
          <Text variant="bodyStrong">{LONG.latn}</Text>
          <Text variant="bodyStrong">{LONG.deva}</Text>
          <Text variant="bodyStrong">{LONG.gujr}</Text>
          <Divider />
          <Text variant="caption" tone="muted">
            Buttons must wrap, never clip:
          </Text>
          <Button label={LONG.deva} fullWidth onPress={() => {}} />
          <Button label={LONG.gujr} variant="secondary" fullWidth onPress={() => {}} />
        </View>
      </Card>

      {/* ── buttons ───────────────────────────────────────────────────── */}
      <SectionHeader title="Buttons" />
      <View style={{ gap: spacing.sm, marginBottom: sectionGap }}>
        {(['primary', 'secondary', 'ghost', 'danger'] as const).map((v) => (
          <Button key={v} label={v} variant={v} fullWidth onPress={() => {}} />
        ))}
        <Button label="loading" loading fullWidth onPress={() => {}} />
        <Button label="disabled" disabled fullWidth onPress={() => {}} />
      </View>

      {/* ── provenance badges: must never look alike ───────────────────── */}
      <SectionHeader title="Provenance" />
      <Card style={{ marginBottom: sectionGap }}>
        <View style={{ gap: spacing.md }}>
          <SourceBadge kind="official" label="OFFICIAL" />
          <SourceBadge kind="ai" label="AI MOCK" />
          <Text variant="caption" tone="muted">
            Solid border + tick vs dashed border + diamond. The distinction survives greyscale,
            colour-blindness and a screenshot.
          </Text>
        </View>
      </Card>

      {/* ── progress ──────────────────────────────────────────────────── */}
      <SectionHeader title="Progress" />
      <Card style={{ marginBottom: sectionGap }}>
        <View style={{ flexDirection: 'row', gap: spacing.xl, alignItems: 'center', flexWrap: 'wrap' }}>
          <ProgressRing value={74} />
          <ProgressRing value={38} size={56} stroke={6} />
          <View style={{ gap: spacing.md, flex: 1, minWidth: 140 }}>
            <MasteryBar value={34} label="Counter-current" width={140} />
            <MasteryBar value={61} label="Genetics" width={140} />
            <MasteryBar value={88} label="Cell Biology" width={140} />
          </View>
        </View>
      </Card>

      {/* ── the four required states ──────────────────────────────────── */}
      <SectionHeader title="States" />
      <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md, flexWrap: 'wrap' }}>
        {(['empty', 'error', 'loading'] as const).map((s) => (
          <Chip key={s} label={s} selected={showStates === s} onPress={() => setShowStates(s)} />
        ))}
      </View>
      <Card style={{ marginBottom: sectionGap }}>
        {showStates === 'empty' ? (
          <EmptyState title="No mistakes yet" body="Sit a paper and anything you miss shows up here." />
        ) : showStates === 'error' ? (
          <ErrorState title="Couldn't load" body="Your data is safe on the device." retryLabel="Try again" onRetry={() => {}} />
        ) : (
          <View style={{ gap: spacing.sm }}>
            <Skeleton height={22} width="60%" />
            <Skeleton height={16} />
            <Skeleton height={16} width="80%" />
          </View>
        )}
      </Card>

      <View style={{ marginBottom: sectionGap }}>
        <OfflineBadge label="Offline" />
      </View>

      {/* ── colour tokens ─────────────────────────────────────────────── */}
      <SectionHeader title="Colour" />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: sectionGap }}>
        {(
          [
            ['bg', colors.bg],
            ['surface', colors.surface],
            ['ink', colors.ink],
            ['inkMuted', colors.inkMuted],
            ['primary', colors.primary],
            ['accent', colors.accent],
            ['success', colors.successText],
            ['warning', colors.warning],
            ['error', colors.error],
            ...colors.series.map((c, i) => [`series ${i + 1}`, c] as [string, string]),
          ] as [string, string][]
        ).map(([name, hex]) => (
          <View key={name} style={{ width: 88, gap: 4 }}>
            <View
              style={{
                height: 40,
                borderRadius: 8,
                backgroundColor: hex,
                borderWidth: 1,
                borderColor: colors.hairline,
              }}
            />
            <Text variant="caption" tone="muted" style={{ fontSize: 10 }}>
              {name}
            </Text>
          </View>
        ))}
      </View>

      <Button
        label="Reset app (re-run onboarding)"
        variant="secondary"
        fullWidth
        onPress={() => {
          useProfile.getState().reset();
          router.replace('/onboarding/welcome');
        }}
      />
    </Screen>
  );
}
