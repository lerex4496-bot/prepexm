/**
 * The Markdown a language model actually writes, parsed into blocks and runs.
 *
 * WHY THIS EXISTS
 * ---------------
 * The tutor's answers were rendered as plain text, so a well-structured reply
 * arrived on screen as literal syntax:
 *
 *     **Quick Revision Tip for CTET:** When asked about a specific soil,
 *     always link it to **(a) Parent Material**, **(b) Colour/Texture** …
 *     60. **Ter**: The zone south of Bhabar …
 *
 * She is revising from that. Asterisks and hashes in the middle of a sentence
 * are not a cosmetic problem — they break the one thing the formatting was for,
 * which is being able to see at a glance what the term is and where a section
 * starts.
 *
 * NOT A FULL MARKDOWN IMPLEMENTATION, ON PURPOSE
 * ----------------------------------------------
 * This handles what these models emit — headings, bold, italics, inline code,
 * fenced code, bullet and numbered lists, block quotes, rules, pipe tables and
 * the `[1]` citation markers the grounded prompt asks for. It does not do
 * reference links, HTML, footnotes or setext headings, because nothing here
 * produces them and every extra rule is another way to mangle a sentence that
 * merely contained an asterisk.
 */

import { WORD_CHARS } from '@/i18n/script';

export type Block =
  | { kind: 'heading'; level: 1 | 2 | 3; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'quote'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'rule' }
  | { kind: 'list'; ordered: boolean; items: ListItem[] }
  | { kind: 'table'; header: string[]; rows: string[][] };

export interface ListItem {
  /** Nesting depth, 0 for a top-level bullet. */
  depth: number;
  /** The marker to draw: "•" or "3." — resolved here, not at render time. */
  marker: string;
  text: string;
}

export type Run =
  | { text: string; bold?: boolean; italic?: boolean; code?: boolean; strike?: boolean }
  | { text: string; cite: number };

// The trailing lookahead is what keeps snake_case identifiers intact. Built
// from WORD_CHARS rather than a `\p{L}` escape, for the reason given there.
const ITALIC = new RegExp(
  `^(\\*(?=\\S)([^*\\n]*?\\S)\\*|_(?=\\S)([^_\\n]*?\\S)_(?![${WORD_CHARS}]))`
);

const BULLET = /^(\s*)[-*+•]\s+(.*)$/;
const ORDERED = /^(\s*)(\d{1,3})[.)]\s+(.*)$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const RULE = /^\s{0,3}([-*_])\s*(\1\s*){2,}$/;
const FENCE = /^\s*(```|~~~)(.*)$/;
const TABLE_ROW = /^\s*\|(.+)\|\s*$/;
const TABLE_DIVIDER = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/;

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;

  /** Text lines accumulated so far, flushed as one paragraph. */
  let para: string[] = [];
  const flushPara = (): void => {
    const text = para.join(' ').trim();
    if (text) blocks.push({ kind: 'paragraph', text });
    para = [];
  };

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code first: everything inside it is literal, including what would
    // otherwise look like a heading or a list.
    const fence = line.match(FENCE);
    if (fence) {
      flushPara();
      const close = fence[1];
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith(close)) body.push(lines[i++]);
      i++; // the closing fence, or the end of input
      blocks.push({ kind: 'code', text: body.join('\n').replace(/\s+$/, '') });
      continue;
    }

    if (!line.trim()) {
      flushPara();
      i++;
      continue;
    }

    if (RULE.test(line)) {
      flushPara();
      blocks.push({ kind: 'rule' });
      i++;
      continue;
    }

    const heading = line.match(HEADING);
    if (heading) {
      flushPara();
      // Six heading levels into three: a phone has room for a section, a
      // sub-section and an emphasised line, and no more. `##` and `###` are
      // what these models reach for, so they must stay distinguishable.
      const level = Math.min(3, heading[1].length) as 1 | 2 | 3;
      blocks.push({ kind: 'heading', level, text: heading[2].replace(/\s*#+\s*$/, '').trim() });
      i++;
      continue;
    }

    // A pipe table needs its divider row to be a table at all — otherwise a
    // sentence containing a vertical bar becomes a one-cell table.
    if (TABLE_ROW.test(line) && i + 1 < lines.length && TABLE_DIVIDER.test(lines[i + 1])) {
      flushPara();
      const header = splitRow(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && TABLE_ROW.test(lines[i])) rows.push(splitRow(lines[i++]));
      blocks.push({ kind: 'table', header, rows });
      continue;
    }

    const quote = line.match(QUOTE);
    if (quote) {
      flushPara();
      const body: string[] = [quote[1]];
      i++;
      while (i < lines.length && QUOTE.test(lines[i])) body.push(lines[i++].match(QUOTE)![1]);
      blocks.push({ kind: 'quote', text: body.join(' ').trim() });
      continue;
    }

    if (BULLET.test(line) || ORDERED.test(line)) {
      flushPara();
      const items: ListItem[] = [];
      // A list is ordered if it STARTS ordered. Models mix the two inside one
      // list; the marker per item is what actually gets drawn, so the flag
      // only decides the block's identity.
      const ordered = ORDERED.test(line);

      while (i < lines.length) {
        const b = lines[i].match(BULLET);
        const o = lines[i].match(ORDERED);
        if (b) {
          items.push({ depth: depthOf(b[1]), marker: '•', text: b[2].trim() });
          i++;
        } else if (o) {
          items.push({ depth: depthOf(o[1]), marker: `${o[2]}.`, text: o[3].trim() });
          i++;
        } else if (lines[i].trim() && /^\s{2,}/.test(lines[i]) && items.length) {
          // A wrapped continuation line belongs to the item above it.
          items[items.length - 1].text += ` ${lines[i].trim()}`;
          i++;
        } else break;
      }
      blocks.push({ kind: 'list', ordered, items });
      continue;
    }

    para.push(line.trim());
    i++;
  }

  flushPara();
  return blocks;
}

/** Two spaces or one tab per level, capped so a stray indent cannot run away. */
function depthOf(indent: string): number {
  return Math.min(3, Math.floor(indent.replace(/\t/g, '  ').length / 2));
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => c.trim());
}

// ---------------------------------------------------------------------------
// Inline runs
// ---------------------------------------------------------------------------

/**
 * Split one line into styled runs.
 *
 * Ordered longest-marker-first so `**bold**` is never read as an italic `*`
 * wrapping `*bold*`. Every pattern requires a non-space character next to the
 * marker, which is what keeps "2 * 3 = 6" and a bare asterisk from swallowing
 * the rest of the sentence — the failure mode that makes a naive renderer
 * worse than showing the raw text.
 */
export function parseInline(text: string): Run[] {
  const runs: Run[] = [];
  let plain = '';

  const push = (run: Run): void => {
    if (plain) {
      runs.push({ text: plain });
      plain = '';
    }
    runs.push(run);
  };

  let i = 0;
  while (i < text.length) {
    const rest = text.slice(i);

    const code = /^`([^`\n]+)`/.exec(rest);
    if (code) {
      push({ text: code[1], code: true });
      i += code[0].length;
      continue;
    }

    // `***both***` is matched before `**bold**`, or the lazy bold rule closes
    // on the first two of the three stars and leaves a stray one behind.
    const both = /^(\*\*\*|___)(?=\S)([\s\S]*?\S)\1/.exec(rest);
    if (both) {
      push({ text: both[2], bold: true, italic: true });
      i += both[0].length;
      continue;
    }

    const bold = /^(\*\*|__)(?=\S)([\s\S]*?\S)\1/.exec(rest);
    if (bold) {
      // Bold can contain italics, and models nest them constantly.
      for (const inner of parseInline(bold[2])) push({ ...inner, bold: true } as Run);
      i += bold[0].length;
      continue;
    }

    const strike = /^~~(?=\S)([\s\S]*?\S)~~/.exec(rest);
    if (strike) {
      push({ text: strike[1], strike: true });
      i += strike[0].length;
      continue;
    }

    // `_` only counts at a word boundary: snake_case_names are common in
    // answers about code and must not turn into italics.
    const italic = ITALIC.exec(rest);
    if (italic) {
      push({ text: italic[2] ?? italic[3], italic: true });
      i += italic[0].length;
      continue;
    }

    const cite = /^\[(\d{1,2})\]/.exec(rest);
    if (cite) {
      push({ text: `[${cite[1]}]`, cite: parseInt(cite[1], 10) });
      i += cite[0].length;
      continue;
    }

    // A markdown link: keep the label, drop the target. There is nowhere to
    // navigate to from a chat bubble, and the bare URL is noise.
    const link = /^\[([^\]\n]+)\]\((?:[^)\s]+)(?:\s+"[^"]*")?\)/.exec(rest);
    if (link) {
      for (const inner of parseInline(link[1])) push(inner);
      i += link[0].length;
      continue;
    }

    plain += text[i];
    i++;
  }

  if (plain) runs.push({ text: plain });
  return runs.filter((r) => r.text !== '');
}

/**
 * Does this text use enough Markdown to be worth rendering as Markdown?
 *
 * Used to decide whether a message is formatted output or just a sentence. A
 * plain reply goes down the plain-text path, so nothing can be mangled by a
 * renderer it never needed.
 */
export function looksLikeMarkdown(text: string): boolean {
  return (
    /^#{1,6}\s/m.test(text) ||
    /\*\*\S/.test(text) ||
    /^\s*[-*+•]\s+\S/m.test(text) ||
    /^\s*\d{1,3}[.)]\s+\S/m.test(text) ||
    /^\s*>\s/m.test(text) ||
    /```/.test(text) ||
    /^\s*\|.+\|\s*$/m.test(text)
  );
}
