import React, { useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, TextInput, View } from 'react-native';

import { Divider, EmptyState, Text } from '@/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { useT } from '@/i18n/useT';
import { useChat, type ChatSession } from './chatStore';

/**
 * The list of saved conversations.
 *
 * WHY A SHEET RATHER THAN A SCREEN
 * --------------------------------
 * Picking a chat is a detour, not a destination — she is mid-question and wants
 * the one from Tuesday. A pushed route would put the conversation behind a back
 * stack and make returning to it a second navigation; a sheet drops away and
 * leaves her where she was.
 *
 * WHY RENAME IS A CUSTOM OVERLAY
 * ------------------------------
 * `Alert.prompt` is iOS-only. Both students are on Android, where it does
 * nothing at all — the rename button would appear to work and silently never
 * open anything. Deletes use `Alert.alert`, which is cross-platform and matches
 * the destructive confirmations already in app/account.tsx.
 */

/** Coarse relative time. Exact timestamps are noise in a list she scans. */
function ago(t: (k: string, p?: Record<string, string | number>) => string, at: number): string {
  const mins = Math.floor((Date.now() - at) / 60000);
  if (mins < 1) return t('chat.justNow');
  if (mins < 60) return t('chat.minutesAgo', { n: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t('chat.hoursAgo', { n: hours });
  return t('chat.daysAgo', { n: Math.floor(hours / 24) });
}

export function SessionsSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { colors, spacing, radius } = useTheme();
  const { t } = useT();

  const sessions = useChat((s) => s.sessions);
  const currentId = useChat((s) => s.currentId);
  const selectSession = useChat((s) => s.selectSession);
  const renameSession = useChat((s) => s.renameSession);
  const deleteSession = useChat((s) => s.deleteSession);
  const deleteAll = useChat((s) => s.deleteAll);

  /** The session being renamed, plus the draft title. Null when not renaming. */
  const [renaming, setRenaming] = useState<{ id: string; draft: string } | null>(null);

  const ordered = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);

  const confirmDelete = (s: ChatSession) => {
    Alert.alert(s.title || t('chat.untitled'), t('chat.deleteConfirm'), [
      { text: t('chat.cancel'), style: 'cancel' },
      { text: t('chat.delete'), style: 'destructive', onPress: () => deleteSession(s.id) },
    ]);
  };

  const confirmDeleteAll = () => {
    Alert.alert(t('chat.deleteAll'), t('chat.deleteAllConfirm'), [
      { text: t('chat.cancel'), style: 'cancel' },
      {
        text: t('chat.delete'),
        style: 'destructive',
        onPress: () => {
          deleteAll();
          onClose();
        },
      },
    ]);
  };

  const rowActions = (s: ChatSession) => {
    Alert.alert(s.title || t('chat.untitled'), undefined, [
      { text: t('chat.rename'), onPress: () => setRenaming({ id: s.id, draft: s.title }) },
      { text: t('chat.delete'), style: 'destructive', onPress: () => confirmDelete(s) },
      { text: t('chat.cancel'), style: 'cancel' },
    ]);
  };

  const saveRename = () => {
    if (!renaming) return;
    renameSession(renaming.id, renaming.draft);
    setRenaming(null);
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
      statusBarTranslucent
    >
      {/* Tapping the dimmed area closes, which is what every sheet on the phone
          already does. */}
      <Pressable style={{ flex: 1, backgroundColor: colors.scrim }} onPress={onClose} />

      <View
        style={{
          maxHeight: '75%',
          backgroundColor: colors.bg,
          borderTopLeftRadius: radius.lg,
          borderTopRightRadius: radius.lg,
          paddingHorizontal: spacing.lg,
          paddingTop: spacing.lg,
          paddingBottom: spacing.xl,
        }}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: spacing.md,
          }}
        >
          <Text variant="h2">{t('chat.sessions')}</Text>
          <Pressable onPress={onClose} hitSlop={10} accessibilityLabel={t('chat.close')}>
            <Text variant="h3" tone="muted">
              ✕
            </Text>
          </Pressable>
        </View>

        {ordered.length === 0 ? (
          <EmptyState glyph="◇" title={t('chat.empty')} body={t('chat.emptyBody')} />
        ) : (
          <>
            <ScrollView style={{ flexGrow: 0 }}>
              {ordered.map((s, i) => {
                const active = s.id === currentId;
                return (
                  <View key={s.id}>
                    {i > 0 ? <Divider /> : null}
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <Pressable
                        onPress={() => {
                          selectSession(s.id);
                          onClose();
                        }}
                        onLongPress={() => rowActions(s)}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                        style={({ pressed }) => ({
                          flex: 1,
                          paddingVertical: spacing.md,
                          opacity: pressed ? 0.6 : 1,
                        })}
                      >
                        <Text
                          variant={active ? 'bodyStrong' : 'body'}
                          color={active ? colors.accent : undefined}
                          numberOfLines={1}
                        >
                          {s.title || t('chat.untitled')}
                        </Text>
                        <Text variant="caption" tone="muted">
                          {ago(t, s.updatedAt)}
                        </Text>
                      </Pressable>

                      <Pressable
                        onPress={() => rowActions(s)}
                        hitSlop={12}
                        accessibilityLabel={t('chat.actions')}
                        style={{ paddingHorizontal: spacing.sm, paddingVertical: spacing.md }}
                      >
                        <Text variant="h3" tone="muted">
                          ⋯
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                );
              })}
            </ScrollView>

            <Pressable
              onPress={confirmDeleteAll}
              style={{ marginTop: spacing.lg, alignSelf: 'flex-start' }}
              hitSlop={8}
            >
              <Text variant="caption" color={colors.error}>
                {t('chat.deleteAll')}
              </Text>
            </Pressable>
          </>
        )}
      </View>

      {/* Rename, stacked above the sheet. Nested Modals are supported on
          Android and keep the list mounted underneath, so cancelling returns
          her to exactly the scroll position she left. */}
      <Modal
        visible={renaming !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setRenaming(null)}
        statusBarTranslucent
      >
        <View
          style={{
            flex: 1,
            backgroundColor: colors.scrim,
            justifyContent: 'center',
            paddingHorizontal: spacing.xl,
          }}
        >
          <View
            style={{
              backgroundColor: colors.bg,
              borderRadius: radius.lg,
              padding: spacing.lg,
              gap: spacing.md,
            }}
          >
            <Text variant="h3">{t('chat.renameTitle')}</Text>
            <TextInput
              value={renaming?.draft ?? ''}
              onChangeText={(v) => setRenaming((r) => (r ? { ...r, draft: v } : r))}
              autoFocus
              selectTextOnFocus
              returnKeyType="done"
              onSubmitEditing={saveRename}
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
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.lg }}>
              <Pressable onPress={() => setRenaming(null)} hitSlop={8}>
                <Text variant="button" tone="muted">
                  {t('chat.cancel')}
                </Text>
              </Pressable>
              <Pressable onPress={saveRename} hitSlop={8}>
                <Text variant="button" color={colors.accent}>
                  {t('chat.save')}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </Modal>
  );
}
