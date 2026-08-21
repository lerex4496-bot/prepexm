import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from 'react-native';

import { Card, Markdown, Screen, Text, looksLikeMarkdown } from '@/ui';
import { TAB_BAR_HEIGHT } from '@/ui/tabBar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/theme/ThemeProvider';
import { useT } from '@/i18n/useT';
import { TutorUnavailable, type Citation } from '@/tutor/client';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';

import { ensureMediaPermission, openAppSettings } from '@/media/permission';

import { useChat } from '@/tutor/chatStore';
import { SessionsSheet } from '@/tutor/SessionsSheet';
import {
  CHAT_STARTERS,
  askPhoto,
  askWeb,
  findUrl,
  sendChat,
  uploadDoc,
  type ChatMessage,
} from '@/tutor/chatClient';

/**
 * The tutor chat.
 *
 * WHAT THIS SCREEN IS CAREFUL ABOUT
 * --------------------------------
 * A chat surface in a study app has one failure mode that matters: she cannot
 * tell an answer drawn from her textbook from an answer the model made up.
 * Fluent prose looks identical either way. So the citations are not a footnote
 * here — every answer that used the corpus shows which book, class and chapter
 * it came from, and an answer with no citations is visibly different from one
 * with them.
 *
 * A refusal is rendered as a normal, calm message rather than an error state.
 * "The extracts do not cover this" is a legitimate and useful answer, not a
 * malfunction, and styling it red would teach her to distrust the one
 * behaviour that keeps the thing honest.
 *
 * The input is deliberately not language-restricted. She may type Hinglish,
 * Gujarati, Devanagari or English, and the server classifies each message on
 * its own — so the placeholder shows a mixed example rather than English.
 */
export default function AskScreen() {
  const { colors, spacing, radius } = useTheme();
  const insets = useSafeAreaInsets();
  const { t } = useT();

  // Persisted, not local state. See src/tutor/chatStore.ts: the transcript
  // used to die on every tab switch, and opening the camera backgrounds the
  // app, which could take the whole conversation with it.
  const messages = useChat((s) => s.messages);
  const setMessages = useChat((s) => s.set);
  const hydrated = useChat((s) => s.hydrated);
  const hydrateChat = useChat((s) => s.hydrate);
  const newSession = useChat((s) => s.newSession);
  const sessionCount = useChat((s) => s.sessions.length);

  const [sessionsOpen, setSessionsOpen] = useState(false);

  useEffect(() => {
    if (!hydrated) void hydrateChat();
  }, [hydrated, hydrateChat]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const scroller = useRef<ScrollView>(null);

  const send = useCallback(
    async (text: string) => {
      const body = text.trim();
      if (!body || busy) return;

      const mine: ChatMessage = { id: `u${Date.now()}`, role: 'user', content: body };
      const placeholder: ChatMessage = {
        id: `a${Date.now()}`,
        role: 'assistant',
        content: '',
        pending: true,
      };
      // Capture the transcript BEFORE adding this turn — the server wants the
      // conversation so far, not including the message it is answering.
      const priorTurns = messages
        .filter((m) => !m.pending && !m.failed && m.content)
        .map((m) => ({ role: m.role, content: m.content }));

      setMessages((prev) => [...prev, mine, placeholder]);
      setDraft('');
      setBusy(true);
      requestAnimationFrame(() => scroller.current?.scrollToEnd({ animated: true }));

      // A pasted link goes to the web reader instead of the corpus. It is the
      // one ungrounded path, so its answer carries a visible warning.
      const link = findUrl(body);
      try {
        if (link) {
          const w = await askWeb(link, body.replace(link, '').trim() || undefined);
          setMessages((prev) =>
            prev.map((m) =>
              m.id !== placeholder.id
                ? m
                : { ...m, pending: false, content: w.reply, citations: w.citations, unverified: true }
            )
          );
          return;
        }
        const res = await sendChat({ message: body, history: priorTurns });
        setMessages((prev) =>
          prev.map((m) =>
            m.id !== placeholder.id
              ? m
              : {
                  ...m,
                  pending: false,
                  content: res.reply ?? '',
                  refusal: res.reply ? undefined : (res.reason ?? t('ask.noAnswer')),
                  citations: res.citations,
                  register: res.register.register,
                  // An answer with no textbook behind it must not look like one
                  // that has. The bubble renders a visible notice for this.
                  ungrounded: !res.grounded,
                }
          )
        );
      } catch (e) {
        const detail = e instanceof TutorUnavailable ? e.message : t('ask.failed');
        setMessages((prev) =>
          prev.map((m) =>
            m.id !== placeholder.id ? m : { ...m, pending: false, failed: true, content: detail }
          )
        );
      } finally {
        setBusy(false);
        requestAnimationFrame(() => scroller.current?.scrollToEnd({ animated: true }));
      }
    },
    [busy, messages, t]
  );

  /**
   * Photograph a question.
   *
   * The transcript is shown as HER message before the answer arrives, so what
   * the camera read is visible at a glance. OCR on Devanagari conjuncts is
   * wrong often enough that an answer to a subtly different question is a real
   * outcome — and one she can only catch if she can see the transcript.
   */
  /** Upload one image and render the answer. Shared by the picker and by recovery. */
  const sendPhoto = useCallback(
    async (uri: string) => {
      const placeholder: ChatMessage = {
        id: `a${Date.now()}`,
        role: 'assistant',
        content: '',
        pending: true,
      };
      setMessages((prev) => [
        ...prev,
        { id: `u${Date.now()}`, role: 'user', content: t('ask.photoSent') },
        placeholder,
      ]);
      setBusy(true);
      try {
        const r = await askPhoto(uri);
        setMessages((prev) =>
          prev.flatMap((m) =>
            m.id !== placeholder.id
              ? [m]
              : [
                  // The transcript replaces the "photo sent" line, so the
                  // conversation reads as if she had typed the question.
                  { ...m, id: `${m.id}-t`, role: 'user' as const, pending: false, content: r.transcript },
                  {
                    ...m,
                    pending: false,
                    content: r.reply ?? '',
                    refusal: r.reply ? undefined : (r.reason ?? t('ask.noAnswer')),
                    citations: r.citations,
                  },
                ]
          )
        );
      } catch (e) {
        const detail = e instanceof TutorUnavailable ? e.message : t('ask.failed');
        setMessages((prev) =>
          prev.map((m) => (m.id !== placeholder.id ? m : { ...m, pending: false, failed: true, content: detail }))
        );
      } finally {
        setBusy(false);
        requestAnimationFrame(() => scroller.current?.scrollToEnd({ animated: true }));
      }
    },
    [t, setMessages]
  );

  /**
   * Recover a photo taken while this screen was destroyed.
   *
   * Opening the camera puts StudyMate in the background, and on a 4 GB phone
   * with the camera running Android frequently kills it outright — 140 MB free
   * was measured on hers. When she returns, the process has restarted, the
   * router is back at its initial route, and the photo is gone. From her side
   * the camera button "sends me to Today".
   *
   * Android hands the result to the recreated activity rather than dropping
   * it, and expo-image-picker exposes it here — its own docs call out handling
   * MainActivity destruction. So on mount we ask whether a picture is waiting
   * and finish the job she started.
   *
   * Only meaningful on Android; it resolves null everywhere else.
   */
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const pending = await ImagePicker.getPendingResultAsync();
        const asset = Array.isArray(pending)
          ? pending[0]
          : (pending as ImagePicker.ImagePickerResult | null);
        const uri =
          asset && 'assets' in asset && !asset.canceled ? asset.assets?.[0]?.uri : undefined;
        if (alive && uri) await sendPhoto(uri);
      } catch {
        // A pending result that cannot be read is not worth surfacing — she
        // can simply take the photo again. Crashing the tab on entry is not.
      }
    })();
    return () => {
      alive = false;
    };
  }, [sendPhoto]);

  const takePhoto = useCallback(
    async (fromCamera: boolean) => {
      if (busy) return;

      // Explain, then ask. See src/media/permission.ts — Android grants exactly
      // one chance at its own dialog, and the previous `if (!perm.granted)
      // return;` turned a refusal into a button that silently did nothing.
      const perm = await ensureMediaPermission(fromCamera ? 'camera' : 'library', {
        title: t(fromCamera ? 'perm.cameraTitle' : 'perm.libraryTitle'),
        body: t(fromCamera ? 'perm.cameraBody' : 'perm.libraryBody'),
        allow: t('perm.allow'),
        notNow: t('perm.notNow'),
      });
      if (!perm.ok) {
        // "Not now" was her decision and needs no reply. A block does: it is
        // the state she cannot get out of from in here, so the message carries
        // the settings route with it.
        if (perm.reason === 'blocked') {
          setMessages((prev) => [
            ...prev,
            {
              id: `p${Date.now()}`,
              role: 'assistant',
              content: t(fromCamera ? 'perm.cameraDenied' : 'perm.libraryDenied'),
              action: 'settings',
            },
          ]);
          requestAnimationFrame(() => scroller.current?.scrollToEnd({ animated: true }));
        }
        return;
      }

      const res = fromCamera
        ? await ImagePicker.launchCameraAsync({ quality: 0.7 })
        : await ImagePicker.launchImageLibraryAsync({ quality: 0.7 });
      if (res.canceled || !res.assets?.[0]?.uri) return;
      await sendPhoto(res.assets[0].uri);
    },
    [busy, t, sendPhoto]
  );

  /**
   * Add a PDF of her own notes to the searchable corpus.
   *
   * No permission gate here, deliberately: DocumentPicker goes through
   * Android's Storage Access Framework, where the picker itself IS the grant.
   * Requesting a runtime permission for it would prompt for something the app
   * does not need.
   */
  const attachDoc = useCallback(async () => {
    if (busy) return;
    const res = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true });
    if (res.canceled || !res.assets?.[0]) return;
    const file = res.assets[0];

    const note: ChatMessage = { id: `a${Date.now()}`, role: 'assistant', content: '', pending: true };
    setMessages((prev) => [
      ...prev,
      { id: `u${Date.now()}`, role: 'user', content: t('ask.docSent', { name: file.name }) },
      note,
    ]);
    setBusy(true);
    try {
      const doc = await uploadDoc(
        file.uri,
        file.name,
        file.name.replace(/\.pdf$/i, ''),
        // Reading a long PDF takes seconds, and a spinner that says nothing for
        // that long reads as a hang. Every eighth page is often enough to look
        // alive without re-rendering the transcript on every tick.
        (done, total) => {
          if (done % 8 !== 0 && done !== total) return;
          const line = t('ask.docReading', { n: done, total });
          setMessages((prev) =>
            prev.map((m) => (m.id !== note.id ? m : { ...m, content: line }))
          );
        }
      );
      const added = t(doc.local ? 'ask.docAddedLocal' : 'ask.docAdded', {
        name: doc.title,
        pages: doc.pages,
      });
      setMessages((prev) =>
        prev.map((m) => (m.id !== note.id ? m : { ...m, pending: false, content: added }))
      );
    } catch (e) {
      // Whichever reader ran, its own wording is shown rather than a generic
      // failure: "this PDF is a scan, photograph the page instead" tells her
      // what to do next, and "could not add the document" does not.
      const detail = e instanceof TutorUnavailable ? e.message : t('ask.failed');
      setMessages((prev) =>
        prev.map((m) => (m.id !== note.id ? m : { ...m, pending: false, failed: true, content: detail }))
      );
    } finally {
      setBusy(false);
      requestAnimationFrame(() => scroller.current?.scrollToEnd({ animated: true }));
    }
  }, [busy, t]);

  return (
    <Screen scroll={false}>
      {/* WHY 'padding' ON ANDROID TOO, AND WHY AN OFFSET
          ------------------------------------------------
          This was `behavior={undefined}` on Android, on the usual reasoning
          that the manifest's android:windowSoftInputMode="adjustResize" moves
          the layout for us. It does not any more: Expo SDK 57 ships
          edge-to-edge, and an edge-to-edge window does NOT resize for the
          keyboard. So the keyboard drew straight over the composer — she could
          type, and the send button was underneath the keys, with no way to
          reach it except Back, which closes the screen.

          The offset is the tab bar. This composer sits inside a tab screen, so
          the keyboard's top edge is that much higher than KeyboardAvoidingView
          would otherwise assume, and without it the input still sits half
          hidden. */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior="padding"
        keyboardVerticalOffset={Platform.OS === 'android' ? TAB_BAR_HEIGHT + insets.bottom : 0}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginTop: spacing.lg,
          }}
        >
          <Text variant="display">{t('tab.ask')}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
            {/* Only offered once there is something to go back to. A list
                button on a first-run screen opens an empty sheet. */}
            {sessionCount > 0 ? (
              <Pressable
                onPress={() => setSessionsOpen(true)}
                hitSlop={10}
                accessibilityLabel={t('chat.sessions')}
              >
                <Text variant="h3" tone="muted">
                  ☰
                </Text>
              </Pressable>
            ) : null}
            {/* Nothing to start when the current chat is already empty. */}
            {messages.length > 0 ? (
              <Pressable onPress={newSession} hitSlop={10} accessibilityLabel={t('chat.new')}>
                <Text variant="h3" tone="muted">
                  ＋
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>
        <Text variant="caption" tone="muted" style={{ marginBottom: spacing.md }}>
          {t('ask.grounding')}
        </Text>

        <ScrollView
          ref={scroller}
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: spacing.lg, gap: spacing.md }}
          keyboardShouldPersistTaps="handled"
        >
          {messages.length === 0 ? (
            <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
              <Text variant="body" tone="secondary">
                {t('ask.emptyBody')}
              </Text>
              {/* Openers in four registers. The point is not the questions —
                  it is showing that all four are accepted. */}
              {CHAT_STARTERS.map((s) => (
                <Pressable
                  key={s.text}
                  onPress={() => void send(s.text)}
                  style={{
                    borderWidth: 1,
                    borderColor: colors.hairline,
                    borderRadius: radius.md,
                    paddingHorizontal: spacing.md,
                    paddingVertical: spacing.sm,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: spacing.sm,
                  }}
                >
                  <Text variant="body" style={{ flex: 1 }}>
                    {s.text}
                  </Text>
                  <Text variant="caption" tone="muted">
                    {s.hint}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          {messages.map((m) => (
            <Bubble key={m.id} message={m} />
          ))}
        </ScrollView>

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'flex-end',
            gap: spacing.sm,
            paddingTop: spacing.sm,
            borderTopWidth: 1,
            borderTopColor: colors.hairline,
          }}
        >
          <Pressable
            onPress={() => void takePhoto(true)}
            disabled={busy}
            hitSlop={8}
            accessibilityLabel={t('ask.camera')}
            style={{ paddingHorizontal: 6, paddingVertical: spacing.sm }}
          >
            <Text variant="h3" tone="muted">
              ⌾
            </Text>
          </Pressable>
          <Pressable
            onPress={() => void attachDoc()}
            disabled={busy}
            hitSlop={8}
            accessibilityLabel={t('ask.attach')}
            style={{ paddingHorizontal: 6, paddingVertical: spacing.sm }}
          >
            <Text variant="h3" tone="muted">
              ⊕
            </Text>
          </Pressable>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder={t('ask.placeholder')}
            placeholderTextColor={colors.inkMuted}
            multiline
            style={{
              flex: 1,
              color: colors.ink,
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.hairline,
              borderRadius: radius.md,
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.sm,
              maxHeight: 120,
              fontSize: 15,
            }}
          />
          <Pressable
            onPress={() => void send(draft)}
            disabled={busy || !draft.trim()}
            accessibilityLabel={t('ask.send')}
            style={{
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.sm + 2,
              borderRadius: radius.md,
              backgroundColor: draft.trim() && !busy ? colors.accent : colors.surface,
              borderWidth: 1,
              borderColor: draft.trim() && !busy ? colors.accent : colors.hairline,
            }}
          >
            <Text variant="button" color={draft.trim() && !busy ? colors.accentInk : colors.inkMuted}>
              {busy ? '…' : '↑'}
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      <SessionsSheet visible={sessionsOpen} onClose={() => setSessionsOpen(false)} />
    </Screen>
  );
}

function Bubble({ message }: { message: ChatMessage }) {
  const { colors, spacing, radius } = useTheme();
  const { t } = useT();
  const [showSources, setShowSources] = useState(false);
  const mine = message.role === 'user';

  if (message.pending) {
    // A pending message may carry its own progress line ("reading page 12 of
    // 64"). That is worth more than the generic wait text, so it wins.
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <ActivityIndicator size="small" color={colors.inkMuted} />
        <Text variant="caption" tone="muted">
          {message.content || t('ask.thinking')}
        </Text>
      </View>
    );
  }

  return (
    <View style={{ alignItems: mine ? 'flex-end' : 'flex-start' }}>
      <View
        style={{
          maxWidth: '92%',
          backgroundColor: mine ? colors.accentSoft : colors.surface,
          borderWidth: 1,
          borderColor: mine ? colors.accentSoft : colors.hairline,
          borderRadius: radius.md,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm,
        }}
      >
        {message.failed ? (
          <Text variant="body" color={colors.error}>
            {message.content}
          </Text>
        ) : message.refusal ? (
          // A refusal is a real answer, styled like one. Making it look like an
          // error would train her to distrust the behaviour that keeps this
          // honest.
          <Text variant="body" tone="secondary">
            {message.refusal}
          </Text>
        ) : mine || !looksLikeMarkdown(message.content) ? (
          // Her own messages are never rendered as Markdown: she typed those
          // characters and is entitled to see them back. A reply with no
          // formatting in it takes the plain path too, so nothing can be
          // mangled by a renderer it did not need.
          <Text variant="body">{message.content}</Text>
        ) : (
          <Markdown text={message.content} />
        )}
      </View>

      {/* A blocked permission cannot be undone from inside the app, so the
          message that reports it carries the only route that still works. */}
      {message.action === 'settings' ? (
        <Pressable
          onPress={() => void openAppSettings()}
          accessibilityRole="button"
          hitSlop={8}
          style={{ marginTop: 6 }}
        >
          <Text variant="caption" color={colors.accent}>
            {t('perm.openSettings')} ›
          </Text>
        </Pressable>
      ) : null}

      {/* Said plainly, under the answer itself. The citations are what make a
          tutor answer checkable; without them she is reading the model's own
          recollection, and she is entitled to know which one she has. */}
      {!mine && message.ungrounded && !message.failed && !message.refusal ? (
        <Text variant="caption" tone="muted" style={{ marginTop: 4, maxWidth: '92%' }}>
          {t('ask.noSources')}
        </Text>
      ) : null}

      {!mine && message.citations?.length ? (
        <View style={{ marginTop: 4, alignItems: 'flex-start' }}>
          <Pressable onPress={() => setShowSources((v) => !v)} hitSlop={8}>
            <Text variant="caption" color={colors.accent}>
              {showSources
                ? t('ask.hideSources')
                : t('ask.sources', { n: message.citations.length })}
            </Text>
          </Pressable>
          {showSources ? (
            <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
              {message.citations.map((c) => (
                <CitationCard key={c.n} citation={c} />
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/**
 * One NCERT source. Book, class and chapter are the whole point — they are what
 * turn "the model said so" into "page 41 of the Class 7 Science book", which is
 * something she can go and read.
 */
function CitationCard({ citation }: { citation: Citation }) {
  const { spacing } = useTheme();
  const { t } = useT();
  // A PDF she added herself has no class and no NCERT chapter. Printing
  // "class 0" there would be worse than useless — a citation is a promise that
  // she can go and check it, so it has to name something that exists.
  const yours = citation.source === 'yours';
  return (
    <Card>
      <View style={{ gap: 3 }}>
        <Text variant="caption" tone="secondary">
          [{citation.n}] {citation.book}
          {yours ? ` · ${t('ask.yourNotes')}` : ` · class ${citation.class}`}
        </Text>
        {yours ? (
          <Text variant="caption" tone="muted">
            {t('ask.page', { n: citation.pages[0] })}
          </Text>
        ) : citation.chapter ? (
          <Text variant="caption" tone="muted">
            {citation.chapter} · pp. {citation.pages[0]}–{citation.pages[1]}
          </Text>
        ) : null}
        <Text variant="caption" tone="muted" numberOfLines={4} style={{ marginTop: spacing.xs }}>
          {citation.excerpt}
        </Text>
      </View>
    </Card>
  );
}
