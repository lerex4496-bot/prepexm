import Constants from 'expo-constants';

/**
 * Calling the model providers straight from the phone.
 *
 * WHY THIS EXISTS, AND WHAT IT COSTS
 * ----------------------------------
 * Normally the app talks to the StudyMate API, which holds the keys and does
 * retrieval. That needs a server reachable from the phone. For two students
 * with no server running, the tutor and the explanations were simply dead —
 * "no API address configured" — which is worse than any of the trade-offs
 * below.
 *
 * So the keys are bundled into the app and it calls the providers directly.
 *
 * THE KEYS IN THIS APP ARE EXTRACTABLE. That is not a wording softener, it is
 * the situation: an APK is a zip, and anyone who can install it can read every
 * string inside it. This was raised explicitly and chosen deliberately, on the
 * basis that the APK is shared privately with two people. If it ever spreads
 * further, the correct response is to rotate both keys, not to try to hide
 * them better — there is no hiding place in a client binary.
 *
 * WHAT THIS MODE DOES AND DOES NOT DO
 * -----------------------------------
 * EXPLANATIONS work fully and stay grounded. They are built from the question
 * stem, its options, and the OFFICIAL ANSWER KEY — all of which ship inside
 * the content bundle. The model explains a known answer; it never picks one.
 * That is the same guarantee as the server path.
 *
 * The TUTOR CHAT is the part that loses something, though less than it used
 * to. The NCERT corpus is server-only, so none of it is searchable here. What
 * IS searchable is the PDFs she has added herself, which are read and indexed
 * on the phone (src/docs/localDocs.ts) and passed to askDirect as extracts.
 *
 * So a chat answer is grounded when her own documents cover the question and
 * ungrounded when they do not, and `grounded` reports which happened. The UI
 * must keep showing that difference rather than let an answer from the model's
 * own recollection look like a cited one.
 */

type Extra = {
  sarvamKey?: string;
  sarvamModel?: string;
  nvidiaKey?: string;
  nvidiaReasonModel?: string;
};

function extra(): Extra {
  return (Constants.expoConfig?.extra ?? {}) as Extra;
}

export function directAvailable(): boolean {
  const e = extra();
  return Boolean(e.sarvamKey || e.nvidiaKey);
}

export class DirectError extends Error {}

interface Provider {
  name: string;
  baseUrl: string;
  key: string;
  model: string;
}

function sarvam(): Provider | null {
  const e = extra();
  if (!e.sarvamKey) return null;
  return {
    name: 'sarvam',
    baseUrl: 'https://api.sarvam.ai/v1',
    key: e.sarvamKey,
    model: e.sarvamModel ?? 'sarvam-105b-conversations',
  };
}

function nvidia(): Provider | null {
  const e = extra();
  if (!e.nvidiaKey) return null;
  return {
    name: 'nvidia',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    key: e.nvidiaKey,
    model: e.nvidiaReasonModel ?? 'nvidia/nemotron-3-super-120b-a12b',
  };
}

async function complete(
  p: Provider,
  system: string,
  user: string,
  opts: { maxTokens?: number; temperature?: number; timeoutMs?: number } = {}
): Promise<string> {
  const ctrl = new AbortController();
  // Reasoning models spend a long time before emitting anything. 90s is not
  // generous, it is the floor: nemotron routinely takes 35-60s on one question.
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 120000);
  try {
    const r = await fetch(`${p.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${p.key}` },
      body: JSON.stringify({
        model: p.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        max_tokens: opts.maxTokens ?? 900,
        temperature: opts.temperature ?? 0.2,
      }),
      signal: ctrl.signal,
    });
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      throw new DirectError(`${p.name} returned ${r.status}${body ? `: ${body.slice(0, 160)}` : ''}`);
    }
    const data = (await r.json()) as {
      choices?: { message?: { content?: string | null; refusal?: string }; finish_reason?: string }[];
    };
    const choice = data.choices?.[0];
    const text = choice?.message?.content;
    if (text && text.trim()) return text.trim();

    // A reasoning model that runs out of tokens mid-thought returns a null
    // content rather than an error, which otherwise surfaces as a blank bubble.
    if (choice?.finish_reason === 'length') {
      throw new DirectError(`${p.name} ran out of tokens before answering`);
    }
    if (choice?.message?.refusal) throw new DirectError(`${p.name} declined: ${choice.message.refusal}`);
    throw new DirectError(`${p.name} returned no text`);
  } catch (e) {
    if (e instanceof DirectError) throw e;
    throw new DirectError('could not reach the model provider');
  } finally {
    clearTimeout(timer);
  }
}

const LANG_NAME: Record<string, string> = { en: 'English', hi: 'Hindi', gu: 'Gujarati' };

const EXPLAIN_SYSTEM = `You explain answers to questions from Indian competitive exams.

You are given a question, its options, and THE OFFICIAL CORRECT ANSWER published
by the examining board. The official answer is a FACT you must accept. Never
contradict it, never argue another option is correct, and never say it looks
wrong — if it seems odd, give the reasoning that supports it.

Write for a candidate preparing for the exam:
1. One short paragraph on why the correct option is correct.
2. Then one line per incorrect option saying why THAT option is wrong. This
   distractor analysis is the most useful part — it teaches her to recognise
   plausible-but-wrong options under time pressure.

Be concise and concrete. No preamble, and do not restate the question.

The app renders Markdown, so use a little of it and no more: **bold** the key
term or the correct option, and put each distractor on its own "- " line. No
headings — this is a few lines under a question, not a document.

Write ONLY in {language}.`;

/**
 * Explain a question, grounded in its official answer key.
 *
 * Prefers the reasoning model and falls back to the Indic one. Both are given
 * the correct answer as a fact, so neither is choosing it — which is why this
 * stays trustworthy without any server or corpus.
 */
export async function explainDirect(params: {
  stem: string;
  options: { label: string; text: string }[];
  correctLabels: string[];
  lang: 'en' | 'hi' | 'gu';
  isBonus?: boolean;
}): Promise<{ text: string; provider: string }> {
  const language = LANG_NAME[params.lang] ?? 'English';
  const opts = params.options.map((o) => `(${o.label}) ${o.text}`).join('\n');
  const extraNote = params.isBonus
    ? '\nNOTE: the board accepted ALL options here, so every candidate who attempted it got the mark. Say so, and still explain what was being tested.\n'
    : '';

  const user =
    `Question: ${params.stem}\n\nOptions:\n${opts}\n\n` +
    `OFFICIAL CORRECT ANSWER (from the board's final key): ${params.correctLabels.join('/') || 'unknown'}\n` +
    `${extraNote}\nExplain in ${language}.`;

  // Indic output goes to Sarvam first — it is built for these scripts — and
  // English to the reasoning model. Each falls back to the other.
  const preferred = params.lang === 'en' ? [nvidia(), sarvam()] : [sarvam(), nvidia()];
  const chain = preferred.filter((p): p is Provider => p !== null);
  if (!chain.length) throw new DirectError('no model keys are bundled in this build');

  let lastError: Error | null = null;
  for (const p of chain) {
    try {
      const text = await complete(p, EXPLAIN_SYSTEM.replace(/\{language\}/g, language), user, {
        maxTokens: 1200,
        temperature: 0.2,
      });
      return { text, provider: `${p.name}/${p.model}` };
    } catch (e) {
      lastError = e as Error;
    }
  }
  throw lastError ?? new DirectError('every provider failed');
}

// "Be brief — a few sentences, not an essay" was unconditional, and it fought
// the request it was most needed for. Asked to "create notes for CTET
// pedagogy", it produced four sentences: true, useless to revise from, and not
// what she asked for. Length now follows the ASK — short for a question, full
// for notes — because a student who says "notes" or "6 pages" has told you
// exactly how much she wants.
const TUTOR_SYSTEM = `You are a study tutor for a student preparing for an Indian
competitive exam (CTET or NEET).

Answer clearly and concretely, at the level of the exam she is sitting. No
preamble, no throat-clearing.

MATCH THE LENGTH TO WHAT SHE ASKED FOR:
- A direct question ("what is X?", "why is this the answer?") — a few
  sentences. Do not pad it into an essay.
- Notes, a summary, "explain in detail", a chapter or topic, or a stated
  length ("6 pages", "one page") — write the full thing. Organise it so she
  can revise from it: short headed sections, numbered points, the definitions
  and examples an examiner rewards. This is the format she studies from, so
  giving her a four-sentence gist instead is a failure, not brevity.

Prefer the terms and examples her syllabus uses over general ones.

If you are not confident about something, say so plainly rather than guessing.
She is revising from your answer, so a confident wrong answer costs her marks.

FORMAT IT SO IT IS READABLE ON A PHONE. The app renders Markdown, so use it:
- ## for a section heading, ### for a sub-heading.
- **bold** for the term being defined, and for the words an examiner looks for.
- "- " for bullets and "1. " for numbered steps, one point per line.
- A blank line between paragraphs.
- > for a definition worth memorising word for word.
Do not write a wall of unbroken prose, and do not put a heading on a two-line
answer — structure follows the length, not the other way round.

{style}`;

/** One extract from the student's own documents, to answer from. */
export interface DirectSource {
  n: number;
  title: string;
  page: number;
  text: string;
}

// Appended only when there ARE extracts. The rule is the same one the server
// enforces: answer from the passages, and say so when they fall short — an
// answer that quietly drifts off her notes and into the model's own
// recollection is worse than no answer, because it still carries citations.
const GROUNDED_RULES = `
THE STUDENT'S OWN NOTES ARE BELOW. Answer from them first.

- Cite the extract you used as [1], [2] … inline, right where you use it.
- If the extracts only partly cover the question, answer that part from them,
  say plainly which part they do not cover, and only then add what you know.
- Never attribute something to her notes that is not in the extracts.`;

function sourceBlock(sources: DirectSource[]): string {
  return sources
    .map((s) => `[${s.n}] ${s.title}, page ${s.page}\n${s.text.slice(0, 1800)}`)
    .join('\n\n---\n\n');
}

/**
 * Answer a free question, optionally from extracts of her own documents.
 *
 * `grounded` is the honest report of which of those two happened. Without
 * sources this is the model's own knowledge — no NCERT corpus, no citations —
 * and the Ask screen shows that difference rather than letting an ungrounded
 * answer look like a cited one.
 */
export async function askDirect(params: {
  message: string;
  style: string;
  history?: { role: string; content: string }[];
  sources?: DirectSource[];
}): Promise<{ text: string; provider: string; grounded: boolean }> {
  const chain = [sarvam(), nvidia()].filter((p): p is Provider => p !== null);
  if (!chain.length) throw new DirectError('no model keys are bundled in this build');

  const sources = params.sources ?? [];
  const convo = (params.history ?? [])
    .slice(-6)
    .map((t) => `${t.role === 'user' ? 'Student' : 'You'}: ${t.content}`)
    .join('\n');

  const parts = [
    convo ? `Conversation so far:\n${convo}` : '',
    sources.length ? `Extracts from her documents:\n\n${sourceBlock(sources)}` : '',
    `Student: ${params.message}`,
  ].filter(Boolean);
  const user = parts.join('\n\n');

  const system =
    TUTOR_SYSTEM.replace('{style}', params.style) + (sources.length ? `\n${GROUNDED_RULES}` : '');

  let lastError: Error | null = null;
  for (const p of chain) {
    try {
      const text = await complete(p, system, user, {
        // 800 could not produce what she asked for even when the prompt let
        // it: it is roughly a page, and she asked for six. A short answer to
        // a short question costs nothing extra, since this is a ceiling and
        // not a target.
        maxTokens: 4000,
        temperature: 0.3,
      });
      return { text, provider: `${p.name}/${p.model}`, grounded: sources.length > 0 };
    } catch (e) {
      lastError = e as Error;
    }
  }
  throw lastError ?? new DirectError('every provider failed');
}
