/**
 * Chat client.
 *
 * A DELIBERATE REVERSAL of an earlier decision, recorded here so it does not
 * look like drift. The original brief said the tutor must not dominate the
 * product, so `askTutor` offered four fixed prompts and no free text box — the
 * reasoning being that a blank input invites her to treat this as ChatGPT
 * rather than as a study aid grounded in her own textbooks.
 *
 * That constraint was lifted explicitly: a real chat surface, in her own mixed
 * register, with photo, document and link input. The grounding constraint was
 * NOT lifted, and that is the part that actually mattered. The server answers
 * only from retrieved NCERT extracts, cites them inline, and refuses when they
 * do not cover the question. A free text box on top of a grounded backend is a
 * different thing from a general chatbot.
 *
 * `askTutor` and its fixed prompts stay for the in-question tutor sheet, where
 * a one-tap action is still the right interaction.
 */

import { useProfile } from '@/store/profile';
import { TutorUnavailable, type Citation } from './client';
import { askDirect, directAvailable } from '@/ai/direct';
import { effectiveRegister, styleFor } from '@/ai/register';

export type ChatRole = 'user' | 'assistant';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  /** Present on assistant turns that reached the corpus. */
  citations?: Citation[];
  /** Set when the server declined to answer, with its reason. */
  refusal?: string;
  /** How the server read her message — shown so a misread is visible, not silent. */
  register?: string;
  /** True for web answers — rendered with a visible not-verified badge. */
  unverified?: boolean;
  /** True when answered with no textbook retrieval behind it. */
  ungrounded?: boolean;
  pending?: boolean;
  failed?: boolean;
  /**
   * An action the message offers, rendered as a link beneath it.
   *
   * Only 'settings' so far: a blocked camera permission cannot be fixed from
   * inside the app, so the message that reports it has to carry the one route
   * that still works.
   */
  action?: 'settings';
}

export interface ChatResponse {
  reply: string | null;
  grounded: boolean;
  reason: string | null;
  citations: Citation[];
  register: { lang: string; register: string; confidence: number; evidence: string };
  retrieval: { query: string; method: string };
  provider: string | null;
  isFallback: boolean;
  ms: number;
}

function baseUrl(): string {
  return useProfile.getState().profile.apiBaseUrl?.replace(/\/+$/, '') ?? '';
}

export async function sendChat(params: {
  message: string;
  history: { role: ChatRole; content: string }[];
  exam?: string;
  subject?: string | null;
}): Promise<ChatResponse> {
  const base = baseUrl();

  // No server: answer directly, and say plainly that it is ungrounded.
  //
  // Register detection still runs on-device, so she is still answered in the
  // language she wrote in. What is missing is retrieval: no NCERT extracts, so
  // no citations and no "your books don't cover this" refusal. `grounded:false`
  // carries that to the UI rather than letting it pass unnoticed.
  if (!base && directAvailable()) {
    // Her study medium is the fallback, NOT English — see effectiveRegister.
    const reg = effectiveRegister(params.message, useProfile.getState().profile.contentLang ?? 'en');
    const r = await askDirect({
      message: params.message,
      style: styleFor(reg),
      history: params.history,
    });
    return {
      reply: r.text,
      grounded: false,
      reason: 'answered without your textbooks — no sources to show',
      citations: [],
      register: { lang: reg.lang, register: reg.register, confidence: reg.confidence, evidence: reg.evidence },
      retrieval: { query: '', method: 'none (no server, so no textbook search)' },
      provider: r.provider,
      isFallback: false,
      ms: 0,
    };
  }

  if (!base) throw new TutorUnavailable('no API address configured');

  const ctrl = new AbortController();
  // Longer than the other calls: a chat turn can involve a translation pass
  // and a generation pass, and giving up early would show an error for a
  // request that was about to succeed.
  const timer = setTimeout(() => ctrl.abort(), 90000);
  try {
    const r = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        message: params.message,
        // Only the last few turns: the server caps this anyway, and sending a
        // long transcript over a phone connection costs more than it adds.
        history: params.history.slice(-6),
        exam: params.exam ?? useProfile.getState().profile.exam ?? 'CTET',
        subject: params.subject ?? null,
        top_k: 4,
      }),
      signal: ctrl.signal,
    });
    if (!r.ok) throw new TutorUnavailable(`server returned ${r.status}`);
    return (await r.json()) as ChatResponse;
  } catch (e) {
    if (e instanceof TutorUnavailable) throw e;
    throw new TutorUnavailable('could not reach the tutor');
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Openers shown on the empty screen.
 *
 * Written in the registers she actually types in, not just English, because
 * the single most useful thing this screen can teach in its first five seconds
 * is that Hinglish and Gujarati are allowed. A row of English prompts would
 * imply the opposite.
 */
export const CHAT_STARTERS: { text: string; hint: string }[] = [
  { text: 'mujhe photosynthesis samjhao', hint: 'Hinglish' },
  { text: 'बाल विकास क्या है ?', hint: 'हिंदी' },
  { text: 'What is inclusive education?', hint: 'English' },
  { text: 'કોષ વિશે સમજાવો', hint: 'ગુજરાતી' },
];

// ---------------------------------------------------------------------------
// Photo, documents, links
// ---------------------------------------------------------------------------

/** Matches a pasted link anywhere in a message. */
const URL_RE = /\bhttps?:\/\/[^\s]+/i;

export function findUrl(text: string): string | null {
  return text.match(URL_RE)?.[0] ?? null;
}

export interface PhotoAnswer {
  transcript: string;
  provider: string;
  ms: number;
  reply: string | null;
  citations: Citation[];
  grounded: boolean;
  reason?: string;
}

export interface WebAnswer {
  reply: string;
  citations: Citation[];
  unverified: boolean;
  warning: string;
  provider: string;
}

async function postForm<T>(path: string, form: FormData, timeoutMs = 120000): Promise<T> {
  const base = baseUrl();
  if (!base) throw new TutorUnavailable('no API address configured');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    // NOTE: no Content-Type header. Setting it by hand drops the multipart
    // boundary React Native generates, and the server rejects the body.
    const r = await fetch(`${base}${path}`, { method: 'POST', body: form, signal: ctrl.signal });
    if (!r.ok) {
      const detail = await r.text().catch(() => '');
      throw new TutorUnavailable(readServerError(detail) ?? `server returned ${r.status}`);
    }
    return (await r.json()) as T;
  } catch (e) {
    if (e instanceof TutorUnavailable) throw e;
    throw new TutorUnavailable('could not reach the tutor');
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Pull the server's own message out of a FastAPI error body.
 *
 * These messages are written to be read by the student — "only 0% of pages have
 * selectable text, this looks like a scan" tells her what to do next, where
 * "server returned 422" tells her nothing.
 */
function readServerError(body: string): string | null {
  try {
    const d = JSON.parse(body) as { detail?: unknown };
    const detail = d.detail as { error?: string } | string | undefined;
    if (typeof detail === 'string') return detail;
    if (detail && typeof detail === 'object' && typeof detail.error === 'string') return detail.error;
  } catch {
    /* not JSON */
  }
  return null;
}

export async function askPhoto(uri: string, exam?: string): Promise<PhotoAnswer> {
  const form = new FormData();
  const name = uri.split('/').pop() || 'question.jpg';
  const ext = name.split('.').pop()?.toLowerCase();
  form.append('file', {
    uri,
    name,
    type: ext === 'png' ? 'image/png' : 'image/jpeg',
  } as unknown as Blob);
  form.append('ask', 'true');
  form.append('exam', exam ?? useProfile.getState().profile.exam ?? 'CTET');
  return postForm<PhotoAnswer>('/api/chat/photo', form);
}

export async function askWeb(url: string, message?: string): Promise<WebAnswer> {
  const base = baseUrl();
  if (!base) throw new TutorUnavailable('no API address configured');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 90000);
  try {
    const r = await fetch(`${base}/api/chat/web`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url, message: message ?? null }),
      signal: ctrl.signal,
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => '');
      throw new TutorUnavailable(readServerError(detail) ?? `server returned ${r.status}`);
    }
    return (await r.json()) as WebAnswer;
  } catch (e) {
    if (e instanceof TutorUnavailable) throw e;
    throw new TutorUnavailable('could not reach the tutor');
  } finally {
    clearTimeout(timer);
  }
}

export interface UserDoc {
  id: number;
  title: string;
  filename: string;
  pages: number;
  chars: number;
  extractability: number;
  chunks: number;
  uploadedAt: string | null;
}

export async function uploadDoc(uri: string, name: string, title?: string): Promise<UserDoc> {
  const form = new FormData();
  form.append('file', { uri, name, type: 'application/pdf' } as unknown as Blob);
  if (title) form.append('title', title);
  return postForm<UserDoc>('/api/docs', form, 180000);
}

export async function listDocs(): Promise<UserDoc[]> {
  const base = baseUrl();
  if (!base) return [];
  try {
    const r = await fetch(`${base}/api/docs`);
    if (!r.ok) return [];
    return ((await r.json()) as { documents: UserDoc[] }).documents;
  } catch {
    return [];
  }
}

export async function deleteDoc(id: number): Promise<void> {
  const base = baseUrl();
  if (!base) return;
  await fetch(`${base}/api/docs/${id}`, { method: 'DELETE' }).catch(() => undefined);
}
