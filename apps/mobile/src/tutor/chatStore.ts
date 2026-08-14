import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

import type { ChatMessage } from './chatClient';

/**
 * Chat sessions — separate conversations, kept across navigation and restarts.
 *
 * WHY IT HAS TO PERSIST
 * ---------------------
 * The transcript lived in `useState` inside the Ask screen, so it died on every
 * tab switch. That is worse than it sounds: she asks a question, taps back to
 * Practice to look at what confused her, returns — and the answer is gone. She
 * also cannot photograph a question, because opening the camera backgrounds the
 * app and Android is free to reclaim the activity, taking the whole
 * conversation with it. (A "Don't keep activities" developer setting makes that
 * happen every single time, which is how this surfaced.)
 *
 * A tutor she cannot leave and come back to is a tutor she uses once.
 *
 * WHY SESSIONS RATHER THAN ONE TRANSCRIPT
 * ---------------------------------------
 * One endless transcript makes yesterday's explanation unfindable, and there is
 * nowhere to put a topic down and start a different one. Revision is exactly
 * the case where going back to a specific conversation matters — the point of
 * asking is to be able to re-read the answer the night before the exam.
 *
 * WHAT IS DELIBERATELY NOT KEPT
 * -----------------------------
 * Pending and failed turns are dropped on save. A spinner restored from disk
 * would sit there forever waiting for a request that no longer exists, and a
 * failed bubble restored on a fresh launch reports a network error that has
 * nothing to do with now.
 *
 * Both caps are on counts, not bytes, and both exist to bound an AsyncStorage
 * value that is otherwise unbounded — a transcript with photo transcripts in it
 * grows faster than anyone expects. Fifty turns is far more than a study
 * session; fifty sessions is more than a year of them.
 */

const KEY = 'studymate.chat.v2';
/** The pre-sessions single transcript. Read once, migrated, then removed. */
const LEGACY_KEY = 'studymate.chat.v1';

const MAX_MESSAGES = 50;
const MAX_SESSIONS = 50;
const TITLE_MAX = 42;

export interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
}

interface ChatStore {
  sessions: ChatSession[];
  currentId: string | null;
  hydrated: boolean;

  /** Messages of the session in view. Empty when there is no session yet. */
  messages: ChatMessage[];

  hydrate: () => Promise<void>;
  set: (next: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => void;

  newSession: () => void;
  selectSession: (id: string) => void;
  renameSession: (id: string, title: string) => void;
  deleteSession: (id: string) => void;
  deleteAll: () => void;
}

interface Persisted {
  sessions: ChatSession[];
  currentId: string | null;
}

function newId(): string {
  return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

function emptySession(): ChatSession {
  const now = Date.now();
  return { id: newId(), title: '', createdAt: now, updatedAt: now, messages: [] };
}

function persistableMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages
    .filter((m) => !m.pending && !m.failed && (m.content || m.refusal))
    .slice(-MAX_MESSAGES);
}

/**
 * The title, derived from her first message.
 *
 * Untitled sessions are named on save rather than on creation, because at
 * creation there is nothing to name them after. An explicit rename wins and is
 * never recomputed — `title` is only auto-filled while it is empty.
 */
function titleFrom(messages: ChatMessage[]): string {
  const first = messages.find((m) => m.role === 'user' && m.content.trim());
  if (!first) return '';
  const line = first.content.trim().replace(/\s+/g, ' ');
  return line.length <= TITLE_MAX ? line : `${line.slice(0, TITLE_MAX - 1).trimEnd()}…`;
}

/**
 * Sessions worth writing to disk: newest first, capped, and with the volatile
 * turns stripped. A session that never got a message is dropped rather than
 * saved — an empty "New chat" in the list is clutter she did not ask for.
 */
function persistable(sessions: ChatSession[]): ChatSession[] {
  return sessions
    .map((s) => ({ ...s, messages: persistableMessages(s.messages) }))
    .filter((s) => s.messages.length > 0)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_SESSIONS);
}

function save(sessions: ChatSession[], currentId: string | null): void {
  const body: Persisted = { sessions: persistable(sessions), currentId };
  void AsyncStorage.setItem(KEY, JSON.stringify(body)).catch(() => undefined);
}

/**
 * Read the old single-transcript key and wrap it in one session.
 *
 * Her existing conversation is not thrown away by an app update — that is the
 * same promise made about attempts and mistakes, and it should not quietly stop
 * applying to the tutor. The legacy key is removed only after the migrated
 * shape has been written.
 */
async function migrateLegacy(): Promise<Persisted | null> {
  const raw = await AsyncStorage.getItem(LEGACY_KEY);
  if (!raw) return null;

  const messages = JSON.parse(raw) as ChatMessage[];
  if (!Array.isArray(messages) || messages.length === 0) {
    await AsyncStorage.removeItem(LEGACY_KEY).catch(() => undefined);
    return null;
  }

  const session: ChatSession = { ...emptySession(), messages };
  session.title = titleFrom(messages);
  const body: Persisted = { sessions: [session], currentId: session.id };

  await AsyncStorage.setItem(KEY, JSON.stringify(body));
  await AsyncStorage.removeItem(LEGACY_KEY).catch(() => undefined);
  return body;
}

export const useChat = create<ChatStore>((set, get) => ({
  sessions: [],
  currentId: null,
  hydrated: false,
  messages: [],

  hydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(KEY);
      const body: Persisted | null = raw
        ? (JSON.parse(raw) as Persisted)
        : await migrateLegacy();

      if (body && Array.isArray(body.sessions)) {
        const sessions = body.sessions;
        const currentId =
          sessions.find((s) => s.id === body.currentId)?.id ?? sessions[0]?.id ?? null;
        set({
          sessions,
          currentId,
          messages: sessions.find((s) => s.id === currentId)?.messages ?? [],
        });
      }
    } catch {
      // A corrupt transcript must never stop the screen opening. Losing the
      // history is a nuisance; a tab that crashes on entry is a broken app.
    } finally {
      set({ hydrated: true });
    }
  },

  set: (next) => {
    const { sessions, currentId } = get();
    const messages = typeof next === 'function' ? next(get().messages) : next;

    // The first message of a brand-new chat creates the session it belongs to.
    // Creating it up front would litter the list with empty conversations every
    // time she opened the tab and typed nothing.
    const id = currentId ?? newId();
    const now = Date.now();
    const existing = sessions.find((s) => s.id === id);
    const base: ChatSession = existing ?? {
      id,
      title: '',
      createdAt: now,
      updatedAt: now,
      messages: [],
    };

    const updated: ChatSession = {
      ...base,
      messages,
      updatedAt: now,
      // Auto-title only while untitled, so a rename is never overwritten by a
      // later message.
      title: base.title || titleFrom(messages),
    };

    const nextSessions = existing
      ? sessions.map((s) => (s.id === id ? updated : s))
      : [updated, ...sessions];

    set({ sessions: nextSessions, currentId: id, messages });
    save(nextSessions, id);
  },

  /**
   * Start a fresh conversation.
   *
   * Nothing is written yet — `currentId: null` means "the next message opens a
   * session". The current one stays in the list untouched.
   */
  newSession: () => set({ currentId: null, messages: [] }),

  selectSession: (id) => {
    const session = get().sessions.find((s) => s.id === id);
    if (!session) return;
    set({ currentId: id, messages: session.messages });
    save(get().sessions, id);
  },

  renameSession: (id, title) => {
    const clean = title.trim().slice(0, TITLE_MAX);
    if (!clean) return;
    const sessions = get().sessions.map((s) => (s.id === id ? { ...s, title: clean } : s));
    set({ sessions });
    save(sessions, get().currentId);
  },

  deleteSession: (id) => {
    const sessions = get().sessions.filter((s) => s.id !== id);
    // Deleting the open conversation lands on the next most recent rather than
    // an empty screen — unless that was the last one.
    const currentId = get().currentId === id ? (sessions[0]?.id ?? null) : get().currentId;
    set({
      sessions,
      currentId,
      messages: sessions.find((s) => s.id === currentId)?.messages ?? [],
    });
    save(sessions, currentId);
  },

  deleteAll: () => {
    set({ sessions: [], currentId: null, messages: [] });
    void AsyncStorage.removeItem(KEY).catch(() => undefined);
  },
}));
