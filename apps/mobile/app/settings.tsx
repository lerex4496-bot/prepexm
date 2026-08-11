import React, { useEffect, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Button, Card, Screen, SectionHeader, Text } from '@/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { useT } from '@/i18n/useT';
import { useAccount } from '@/account/sync';
import { LANGUAGE_LABEL, EXAM_LANGUAGES } from '@/i18n/strings';
import { useProfile, type Lang, type ThemePref } from '@/store/profile';
import { getMeta } from '@/db/content';
import { pingApi } from '@/tutor/client';

/**
 * Profile & settings.
 *
 * Reached from the avatar on Today rather than a fifth bottom tab — in a
 * one-student-per-device app this is visited rarely, and a tab slot costs
 * cognitive load on the screen she opens every day.
 */
export default function Settings() {
  const { colors, spacing, radius, sectionGap } = useTheme();
  const { t, contentLang } = useT();
  const router = useRouter();

  const profile = useProfile((s) => s.profile);
  const set = useProfile((s) => s.set);
  const reset = useProfile((s) => s.reset);

  const [meta, setMeta] = useState<Record<string, string>>({});
  const [confirmReset, setConfirmReset] = useState(false);
  const [apiDraft, setApiDraft] = useState(profile.apiBaseUrl ?? '');
  const [apiStatus, setApiStatus] = useState<string | null>(null);

  useEffect(() => {
    void getMeta().then(setMeta).catch(() => setMeta({}));
  }, []);

  const exam = profile.exam ?? 'CTET';
  const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <View style={{ gap: spacing.sm, marginBottom: spacing.lg }}>
      <Text variant="caption" tone="muted">
        {label.toUpperCase()}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>{children}</View>
    </View>
  );

  const Chip = ({
    active,
    label,
    onPress,
  }: {
    active: boolean;
    label: string;
    onPress: () => void;
  }) => (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected: active }}
      style={{
        minHeight: 44,
        justifyContent: 'center',
        paddingHorizontal: spacing.lg,
        borderRadius: 999,
        borderWidth: 1.5,
        borderColor: active ? colors.accent : colors.hairlineStrong,
        backgroundColor: active ? colors.accentSoft : 'transparent',
      }}
    >
      <Text variant="button" color={active ? colors.accent : colors.inkSecondary}>
        {label}
      </Text>
    </Pressable>
  );

  return (
    <Screen>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: spacing.md,
          marginBottom: spacing.xl,
        }}
      >
        <Text variant="h1">{t('settings.title')}</Text>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel={t('common.done')}>
          <Text variant="button" tone="muted">
            ✕
          </Text>
        </Pressable>
      </View>

      <Card>
        <Row label={t('settings.language')}>
          {EXAM_LANGUAGES[exam].map((code: Lang) => (
            <Chip
              key={code}
              active={contentLang === code}
              label={LANGUAGE_LABEL[code]}
              onPress={() => set({ contentLang: code })}
            />
          ))}
        </Row>
        {/* Says plainly what this does and does not change. The control used to
            translate the tab bar too, which was the confusing part. */}
        <Text variant="caption" tone="muted" style={{ marginTop: -spacing.xs, marginBottom: spacing.sm }}>
          {t('settings.languageHint')}
        </Text>

        <Row label={t('settings.account')}>
          <Pressable onPress={() => router.push('/account')} hitSlop={8}>
            <Text variant="button" color={colors.accent}>
              {useAccount.getState().username ?? t('account.signIn')}
            </Text>
          </Pressable>
        </Row>
        <Text variant="caption" tone="muted" style={{ marginTop: -spacing.xs, marginBottom: spacing.sm }}>
          {t('settings.accountHint')}
        </Text>

        <Row label={t('settings.theme')}>
          {(['system', 'light', 'dark'] as ThemePref[]).map((m) => (
            <Chip
              key={m}
              active={profile.theme === m}
              label={t(`settings.theme.${m}`)}
              onPress={() => set({ theme: m })}
            />
          ))}
        </Row>

        <Row label={t('settings.dailyTime')}>
          {[5, 10, 20, 30, 60].map((m) => (
            <Chip
              key={m}
              active={profile.dailyMinutes === m}
              label={`${m}`}
              onPress={() => set({ dailyMinutes: m })}
            />
          ))}
        </Row>

        <Row label={t('settings.motion')}>
          <Chip
            active={profile.reducedMotion}
            label={t('settings.reduceMotion')}
            onPress={() => set({ reducedMotion: !profile.reducedMotion })}
          />
        </Row>
      </Card>

      {/* The tutor is the only networked feature, so its address is
          configurable and its reachability is shown rather than assumed. */}
      <View style={{ marginTop: sectionGap }}>
        <SectionHeader title={t('settings.api')} />
        <Card>
          <Text variant="caption" tone="muted">
            {t('settings.apiHint')}
          </Text>
          <TextInput
            value={apiDraft}
            onChangeText={setApiDraft}
            onBlur={() => set({ apiBaseUrl: apiDraft.trim() || null })}
            placeholder="http://172.16.2.8:8008"
            placeholderTextColor={colors.inkMuted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            style={{
              marginTop: spacing.sm,
              borderWidth: 1.5,
              borderColor: colors.hairlineStrong,
              borderRadius: radius.md,
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.sm,
              color: colors.ink,
              fontSize: 15,
            }}
          />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.sm }}>
            <Pressable
              onPress={async () => {
                set({ apiBaseUrl: apiDraft.trim() || null });
                setApiStatus('…');
                const r = await pingApi();
                setApiStatus(
                  r.ok ? `${t('settings.apiReachable')} · ${r.detail}` : `${t('settings.apiUnreachable')} · ${r.detail}`
                );
              }}
              style={{
                paddingHorizontal: spacing.lg,
                paddingVertical: spacing.sm,
                borderRadius: 999,
                borderWidth: 1.5,
                borderColor: colors.hairlineStrong,
              }}
            >
              <Text variant="caption" tone="secondary">
                {t('settings.apiCheck')}
              </Text>
            </Pressable>
            {apiStatus ? (
              <Text variant="caption" tone="muted" style={{ flex: 1 }}>
                {apiStatus}
              </Text>
            ) : null}
          </View>
        </Card>
      </View>

      {/* Content provenance, surfaced rather than hidden — she should be able
          to see exactly which bundle she is studying from. */}
      <View style={{ marginTop: sectionGap }}>
        <SectionHeader title={t('settings.content')} />
        <Card tone="sunken">
          <View style={{ gap: 4 }}>
            <Text variant="caption" tone="muted">
              {t('settings.bundleBuilt')}: {meta.built_at?.slice(0, 16).replace('T', ' ') ?? '—'}
            </Text>
            <Text variant="caption" tone="muted">
              {t('settings.bundleGate')}: {meta.gate ?? '—'}
            </Text>
            {meta.completeness === 'PARTIAL-DEV-BUILD' ? (
              <Text variant="caption" color={colors.warningText}>
                ⚠ {t('papers.devBundle')}
              </Text>
            ) : null}
          </View>
        </Card>
      </View>

      <View style={{ marginTop: sectionGap, marginBottom: sectionGap, gap: spacing.md }}>
        {confirmReset ? (
          <Card>
            <Text variant="bodyStrong">{t('settings.resetConfirm')}</Text>
            <Text variant="caption" tone="secondary" style={{ marginTop: 4 }}>
              {t('settings.resetBody')}
            </Text>
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
              <Button
                label={t('common.cancel')}
                variant="secondary"
                onPress={() => setConfirmReset(false)}
                style={{ flex: 1 }}
              />
              <Button
                label={t('settings.reset')}
                variant="danger"
                onPress={() => {
                  reset();
                  router.replace('/onboarding/welcome');
                }}
                style={{ flex: 1 }}
              />
            </View>
          </Card>
        ) : (
          <Button
            label={t('settings.reset')}
            variant="secondary"
            fullWidth
            onPress={() => setConfirmReset(true)}
          />
        )}
      </View>
    </Screen>
  );
}
