import React, { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from 'react-native';

import { Card, Screen, Text } from '@/ui';
import { useTheme } from '@/theme/ThemeProvider';
import { useT } from '@/i18n/useT';
import { TutorUnavailable, type Citation } from '@/tutor/client';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';

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
  const { t } = useT();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
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
  const takePhoto = useCallback(
    async (fromCamera: boolean) => {
      if (busy) return;
      const perm = fromCamera
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) return;

      const res = fromCamera
        ? await ImagePicker.launchCameraAsync({ quality: 0.7 })
        : await ImagePicker.launchImageLibraryAsync({ quality: 0.7 });
      if (res.canceled || !res.assets?.[0]?.uri) return;

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
        const r = await askPhoto(res.assets[0].uri);
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
    [busy, t]
  );

  /** Add a PDF of her own notes to the searchable corpus. */
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
      const doc = await uploadDoc(file.uri, file.name, file.name.replace(/\.pdf$/i, ''));
      setMessages((prev) =>
        prev.map((m) =>
          m.id !== note.id
            ? m
            : { ...m, pending: false, content: t('ask.docAdded', { name: doc.title, pages: doc.pages }) }
        )
      );
    } catch (e) {
      // The server's own wording is shown: "only 0% of pages have selectable
      // text" tells her to use the camera instead, which a generic failure
      // message never would.
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
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Text variant="display" style={{ marginTop: spacing.lg }}>
          {t('tab.ask')}
        </Text>
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
    </Screen>
  );
}

function Bubble({ message }: { message: ChatMessage }) {
  const { colors, spacing, radius } = useTheme();
  const { t } = useT();
  const [showSources, setShowSources] = useState(false);
  const mine = message.role === 'user';

  if (message.pending) {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <ActivityIndicator size="small" color={colors.inkMuted} />
        <Text variant="caption" tone="muted">
          {t('ask.thinking')}
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
        ) : (
          <Text variant="body">{message.content}</Text>
        )}
      </View>

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
  return (
    <Card>
      <View style={{ gap: 3 }}>
        <Text variant="caption" tone="secondary">
          [{citation.n}] {citation.book} · class {citation.class}
        </Text>
        {citation.chapter ? (
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
