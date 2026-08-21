/**
 * Keyword retrieval over the student's own documents.
 *
 * WHY NOT EMBEDDINGS
 * ------------------
 * The server does dense retrieval over the NCERT corpus. Nothing like that can
 * run here: there is no embedding model in the app, and shipping one to score
 * a fifty-page PDF would cost more than the whole feature is worth.
 *
 * What is left is BM25-style keyword matching, which is a great deal better
 * than it sounds for this job. The question and the textbook use the same
 * vocabulary — she asks about "photosynthesis" and the page says
 * "photosynthesis" — and the alternative is not a better retriever, it is no
 * retrieval at all.
 *
 * Written script-aware, because the corpus is not English: tokens are runs of
 * letters or digits in ANY script, so Devanagari and Gujarati words are terms
 * exactly like Latin ones.
 */

import { WORD_CHARS } from '@/i18n/script';

export interface Chunk {
  /** 1-based page this text came from. */
  page: number;
  text: string;
}

export interface Scored<T> {
  item: T;
  score: number;
}

/**
 * A word: any run of the characters a word can be made of.
 *
 * `WORD_CHARS` INCLUDES THE COMBINING MARKS, which is the whole point.
 * Devanagari and Gujarati build a word from base letters plus matras, the
 * virama and nuktas. A class of letters alone breaks at every matra, so
 * "बाल विकास" tokenises to ब, ल, व, क, स — which matches nothing useful and
 * matches it in every document.
 */
const TOKEN = new RegExp(`[${WORD_CHARS}]+`, 'g');

/**
 * Words too common to discriminate, in the three registers she types in.
 *
 * Kept short on purpose. An over-long stop list starts removing exam
 * vocabulary — "development", "cell" and "value" have all been in someone's
 * stop list — and a term that appears in every chunk is already scored to
 * nothing by its IDF.
 */
const STOP = new Set([
  'the','a','an','and','or','of','in','on','to','is','are','was','were','be','been','for','with',
  'as','at','by','it','its','this','that','these','those','from','but','not','what','which','who',
  'how','why','when','where','do','does','did','can','could','should','would','me','my','you','your',
  'i','we','us','about','please','explain','tell',
  'kya','hai','hain','ka','ki','ke','ko','se','me','mein','aur','par','bhi','ye','yeh','wo','woh',
  'mujhe','samjhao','batao','karo','kaise','kyu','kyun',
  'chhe','che','ane','pan','shu','su','kem','mane','maru','aa',
  'का','की','के','है','हैं','में','और','से','को','यह','वह','क्या','कैसे','क्यों','हो','था','थी',
  'છે','અને','માં','થી','ને','આ','તે','શું','કેમ','હતું',
]);

export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const m of text.toLowerCase().matchAll(TOKEN)) {
    const w = m[0];
    // Single characters carry no signal in Latin; in Indic scripts one
    // character is often a whole word, so they are kept there.
    if (w.length < 2 && /[a-z0-9]/.test(w)) continue;
    if (STOP.has(w)) continue;
    out.push(w);
  }
  return out;
}

/**
 * Rank chunks against a query with BM25.
 *
 * k1 and b are the standard defaults. b=0.75 matters here: chunks are not all
 * the same length — the last chunk of a page is usually short — and without
 * length normalisation those short chunks win every time on term density
 * alone, which puts headings and page numbers at the top of the results.
 */
export function rankChunks<T extends Chunk>(query: string, chunks: T[], k = 4): Scored<T>[] {
  const terms = [...new Set(tokenize(query))];
  if (!terms.length || !chunks.length) return [];

  const K1 = 1.5;
  const B = 0.75;

  const tokenised = chunks.map((c) => tokenize(c.text));
  const lengths = tokenised.map((t) => t.length);
  const avgLen = lengths.reduce((a, b) => a + b, 0) / Math.max(1, lengths.length);

  const df = new Map<string, number>();
  for (const toks of tokenised) {
    const seen = new Set(toks);
    for (const t of terms) if (seen.has(t)) df.set(t, (df.get(t) ?? 0) + 1);
  }

  const scored = chunks.map((chunk, i) => {
    const counts = new Map<string, number>();
    for (const t of tokenised[i]) counts.set(t, (counts.get(t) ?? 0) + 1);

    let score = 0;
    for (const term of terms) {
      const f = counts.get(term) ?? 0;
      if (!f) continue;
      const n = df.get(term) ?? 0;
      const idf = Math.log(1 + (chunks.length - n + 0.5) / (n + 0.5));
      score += idf * ((f * (K1 + 1)) / (f + K1 * (1 - B + (B * lengths[i]) / Math.max(1, avgLen))));
    }
    return { item: chunk, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.item.page - b.item.page)
    .slice(0, k);
}

/**
 * Split a document's pages into retrievable chunks.
 *
 * Chunks break on blank lines rather than mid-sentence, and carry their page
 * number so a citation can say where to look. `target` is in characters and
 * sized so four chunks still fit comfortably in a prompt alongside the
 * conversation.
 */
export function chunkPages(pages: string[], target = 1200): Chunk[] {
  const out: Chunk[] = [];

  pages.forEach((page, i) => {
    const pageNo = i + 1;
    const paragraphs = page.split(/\n{2,}/).flatMap(splitLongParagraph);

    let buf = '';
    const flush = (): void => {
      const text = buf.trim();
      if (text.length >= 40) out.push({ page: pageNo, text });
      buf = '';
    };
    for (const para of paragraphs) {
      if (buf && buf.length + para.length > target) flush();
      buf += (buf ? '\n\n' : '') + para.trim();
    }
    flush();
  });

  return out;

  /** A page with no blank lines is one paragraph; split it on sentences. */
  function splitLongParagraph(para: string): string[] {
    if (para.length <= target * 1.5) return [para];
    // Matched rather than split on a lookbehind: same reason as WORD_CHARS —
    // regex syntax the engine on the phone may not have is not worth a line
    // saved. This keeps the terminator attached to the sentence it ends.
    const sentences = para.match(/[^.?!।॥]+[.?!।॥]*\s*/g) ?? [para];
    const parts: string[] = [];
    let buf = '';
    for (const s of sentences) {
      if (buf && buf.length + s.length > target) {
        parts.push(buf);
        buf = '';
      }
      buf += (buf ? ' ' : '') + s;
    }
    if (buf) parts.push(buf);
    return parts;
  }
}
