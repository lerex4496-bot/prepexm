import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Button, Card, Screen, SectionHeader, Text } from '@/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { useT } from '@/i18n/useT';
import {
  SyncError,
  WouldLoseHistory,
  localCounts,
  useAccount,
  type BackupInfo,
} from '@/account/sync';

/**
 * Optional account, for carrying progress across a reinstall or a new phone.
 *
 * THE COPY MATTERS AS MUCH AS THE CODE HERE
 * -----------------------------------------
 * Every account screen in every app looks the same, so a student reasonably
 * assumes this one does what those do: gate the product, collect an email,
 * send things. This one does none of that, and the screen says so in plain
 * words at the top. If she does not read it, the safe assumption ("I don't need
 * this") costs her nothing today, which is the right default.
 *
 * The two destructive moments are handled explicitly rather than with a generic
 * "Are you sure?":
 *   - Restoring REPLACES local history, so the confirmation names both numbers.
 *   - Backing up from a device with less history than the backup is refused by
 *     the server, and the override says exactly what will be lost.
 */
export default function AccountScreen() {
  const router = useRouter();
  const { colors, spacing, radius } = useTheme();
  const { t } = useT();

  const account = useAccount();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [backup, setBackup] = useState<BackupInfo | null>(null);
  const [local, setLocal] = useState({ attempts: 0, mistakes: 0 });

  useEffect(() => {
    void localCounts().then(setLocal);
  }, []);

  const refreshBackup = useCallback(async () => {
    try {
      setBackup(await account.peek());
    } catch {
      /* a stale token or an unreachable server is not an error worth shouting */
    }
  }, [account]);

  useEffect(() => {
    if (account.token) void refreshBackup();
  }, [account.token, refreshBackup]);

  const run = useCallback(
    async (fn: () => Promise<unknown>, ok: string) => {
      setBusy(true);
      setStatus(null);
      try {
        await fn();
        setStatus(ok);
        setLocal(await localCounts());
        await refreshBackup();
      } catch (e) {
        if (e instanceof WouldLoseHistory) {
          Alert.alert(
            t('account.overwriteTitle'),
            t('account.overwriteBody', {
              stored: e.stored.attempts,
              incoming: e.incoming.attempts,
            }),
            [
              { text: t('common.cancel'), style: 'cancel' },
              {
                text: t('account.overwriteConfirm'),
                style: 'destructive',
                onPress: () => void run(() => account.backUpNow(true), t('account.backedUp')),
              },
            ]
          );
          return;
        }
        setStatus(e instanceof SyncError ? e.message : t('account.failed'));
      } finally {
        setBusy(false);
      }
    },
    [account, refreshBackup, t]
  );

  const confirmRestore = useCallback(() => {
    Alert.alert(
      t('account.restoreTitle'),
      t('account.restoreBody', { local: local.attempts, backup: backup?.attempts ?? 0 }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('account.restoreConfirm'),
          style: 'destructive',
          onPress: () => void run(() => account.restoreNow(), t('account.restored')),
        },
      ]
    );
  }, [account, backup, local.attempts, run, t]);

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
          {t('account.title')}
        </Text>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Text variant="button" tone="muted">
            ✕
          </Text>
        </Pressable>
      </View>

      <Text variant="body" tone="secondary" style={{ marginBottom: spacing.lg }}>
        {t('account.intro')}
      </Text>

      {/* What is on this phone right now, so the numbers below mean something. */}
      <Card>
        <View style={{ gap: 3 }}>
          <Text variant="bodyStrong">{t('account.onThisPhone')}</Text>
          <Text variant="caption" tone="secondary">
            {t('account.localCounts', { attempts: local.attempts, mistakes: local.mistakes })}
          </Text>
          <Text variant="caption" tone="muted" style={{ marginTop: spacing.xs }}>
            {t('account.updateSafe')}
          </Text>
        </View>
      </Card>

      {!account.token ? (
        <>
          <SectionHeader title={t('account.signInTitle')} />
          <View style={{ gap: spacing.sm }}>
            <TextInput
              value={username}
              onChangeText={setUsername}
              placeholder={t('account.username')}
              placeholderTextColor={colors.inkMuted}
              autoCapitalize="none"
              autoCorrect={false}
              style={{
                color: colors.ink,
                backgroundColor: colors.surface,
                borderWidth: 1,
                borderColor: colors.hairline,
                borderRadius: radius.md,
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.sm,
                fontSize: 15,
              }}
            />
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder={t('account.password')}
              placeholderTextColor={colors.inkMuted}
              secureTextEntry
              autoCapitalize="none"
              style={{
                color: colors.ink,
                backgroundColor: colors.surface,
                borderWidth: 1,
                borderColor: colors.hairline,
                borderRadius: radius.md,
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.sm,
                fontSize: 15,
              }}
            />
            <Button
              label={busy ? t('account.working') : t('account.signIn')}
              onPress={() => void run(() => account.signIn(username, password), t('account.signedIn'))}
              disabled={busy || !username || !password}
            />
            <Pressable
              onPress={() => void run(() => account.signUp(username, password), t('account.created'))}
              disabled={busy || !username || !password}
              hitSlop={8}
              style={{ alignSelf: 'center', paddingVertical: spacing.sm }}
            >
              <Text variant="button" color={colors.accent}>
                {t('account.createInstead')}
              </Text>
            </Pressable>
            <Text variant="caption" tone="muted">
              {t('account.passwordRule')}
            </Text>
          </View>
        </>
      ) : (
        <>
          <SectionHeader title={t('account.signedInAs', { name: account.username ?? '' })} />
          <Card>
            <View style={{ gap: 3 }}>
              <Text variant="bodyStrong">{t('account.backupTitle')}</Text>
              <Text variant="caption" tone="secondary">
                {backup
                  ? t('account.backupCounts', {
                      attempts: backup.attempts,
                      mistakes: backup.mistakes,
                      when: (backup.savedAt ?? '').slice(0, 10),
                    })
                  : t('account.noBackup')}
              </Text>
            </View>
          </Card>

          <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
            <Button
              label={busy ? t('account.working') : t('account.backUp')}
              onPress={() => void run(() => account.backUpNow(), t('account.backedUp'))}
              disabled={busy}
            />
            <Button
              label={t('account.restore')}
              variant="secondary"
              onPress={confirmRestore}
              disabled={busy || !backup}
            />
            <Pressable
              onPress={() => account.signOut()}
              hitSlop={8}
              style={{ alignSelf: 'center', paddingVertical: spacing.sm }}
            >
              <Text variant="button" tone="muted">
                {t('account.signOut')}
              </Text>
            </Pressable>
            {/* Says the quiet part out loud: signing out is not a delete. */}
            <Text variant="caption" tone="muted" align="center">
              {t('account.signOutSafe')}
            </Text>
          </View>
        </>
      )}

      {status ? (
        <Text variant="caption" tone="secondary" style={{ marginTop: spacing.lg }}>
          {status}
        </Text>
      ) : null}
    </Screen>
  );
}
