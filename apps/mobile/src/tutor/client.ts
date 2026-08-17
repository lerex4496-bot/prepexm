/**
 * Tutor client.
 *
 * The tutor is the ONE part of this app that needs the network — everything
 * else (papers, exam, scoring, mistakes, plan) works offline by design. So
 * every call here is written to fail softly: a timeout or an unreachable
 * server must degrade to "tutor unavailable", never break the screen she is
 * reading.
 *
 * The server returns CITATIONS even when generation is unconfigured, so the
 * useful failure mode is preserved on the client too: show her the exact
 * NCERT book, chapter and page rather than an error.
 */

import { useProfile } from '@/store/profile';
import { DirectError, askDirect, directAvailable } from '@/ai/direct';
import { styleFor } from '@/ai/register';

export interface Citation {
  n: number;
  subject: string;
  class: number;
  book: string;
  chapter: string | null;
  pages: [number, number];
  excerpt: string;
}

export interface TutorAnswer {
  answer: string | null;
  citations: Citation[];
  grounded: boolean;
  reason?: string;
  provider?: string;
  model?: string;
}

export class TutorUnavailable extends Error {}

function baseUrl(): string {
  // Configurable in Settings: in development this is the laptop running the
  // API; in a real deployment it is the hosted service. Stored on the profile
  // so it survives restarts and can be changed without a rebuild.
  return useProfile.getState().profile.apiBaseUrl?.replace(/\/+$/, '') ?? '';
}

async function post<T>(path: string, body: unknown, timeoutMs = 45000): Promise<T> {
  const base = baseUrl();
  if (!base) throw new TutorUnavailable('no API address configured');

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!r.ok) throw new TutorUnavailable(`server returned ${r.status}`);
    return (await r.json()) as T;
  } catch (e) {
    if (e instanceof TutorUnavailable) throw e;
    // AbortError, DNS failure, offline — all the same to the student.
    throw new TutorUnavailable('could not reach the tutor');
  } finally {
    clearTimeout(timer);
  }
}

export async function askTutor(params: {
  question: string;
  lang: 'en' | 'hi' | 'gu';
  subject?: string | null;
}): Promise<TutorAnswer> {
  // No server configured: call the providers straight from the phone.
  //
  // This is a genuine downgrade and is reported as one. The server answers from
  // retrieved NCERT passages and cites them; direct mode has no corpus, so the
  // reply is the model's own knowledge with `grounded: false` and no citations.
  // The UI shows that difference — an uncited answer must not look like a cited
  // one, because the whole point of the citations is that she can check them.
  if (!baseUrl() && directAvailable()) {
    // Via styleFor rather than a second copy of the ladder, so this path also
    // carries the "a language preference is not a refusal" clause. The two
    // copies had already drifted: the Ask screen was fixed and this one, which
    // is what she taps from inside a question, would still have declined.
    const style = styleFor({
      lang: params.lang,
      register: params.lang,
      confidence: 1,
      evidence: 'caller specified',
    });
    try {
      const r = await askDirect({ message: params.question, style });
      return {
        answer: r.text,
        citations: [],
        grounded: false,
        reason: 'answered without your textbooks — no sources to show',
        provider: r.provider,
      };
    } catch (e) {
      throw new TutorUnavailable(
        e instanceof DirectError ? e.message : 'could not reach the tutor'
      );
    }
  }

  return post<TutorAnswer>('/api/tutor/ask', {
    question: params.question,
    lang: params.lang,
    subject: params.subject ?? null,
    exam: 'CTET',
    top_k: 4,
  });
}

/** Cheap reachability check so Settings can show a real status, not a guess. */
export async function pingApi(): Promise<{ ok: boolean; detail: string }> {
  const base = baseUrl();
  if (!base) return { ok: false, detail: 'no address set' };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(`${base}/api/corpus/stats`, { signal: ctrl.signal });
    if (!r.ok) return { ok: false, detail: `HTTP ${r.status}` };
    const d = (await r.json()) as { chunks?: number };
    return { ok: true, detail: `${d.chunks ?? 0} passages` };
  } catch {
    return { ok: false, detail: 'unreachable' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The contextual prompts. Deliberately a small fixed set rather than a free
 * chat box: the brief was explicit that the tutor must not dominate the
 * product, and a blank input invites her to treat this as ChatGPT instead of
 * as a study aid grounded in her own textbooks.
 */
export const TUTOR_ACTIONS = [
  { key: 'simple', build: (t: string) => `Explain in simple words: ${t}` },
  { key: 'example', build: (t: string) => `Give a classroom example of: ${t}` },
  { key: 'why', build: (t: string) => `Why is this the answer? ${t}` },
  { key: 'related', build: (t: string) => `What related concepts should I know for: ${t}` },
] as const;

export type TutorActionKey = (typeof TUTOR_ACTIONS)[number]['key'];
