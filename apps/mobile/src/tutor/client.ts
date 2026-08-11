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
