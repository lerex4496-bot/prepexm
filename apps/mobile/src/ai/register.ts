/**
 * Which language — and which REGISTER — a message was typed in.
 *
 * A port of the server's app/register.py, needed on-device because direct mode
 * has no server to ask. Deliberately the same algorithm rather than a looser
 * one, so a message classified as Hinglish on the server is Hinglish here too.
 *
 * WHY NOT ASK THE MODEL
 * ---------------------
 * It would cost a round trip per message, be non-deterministic, and answer the
 * wrong question anyway: "Hindi" and "Hinglish" are the same language to any
 * classifier, and telling them apart is the entire job.
 *
 *     "बाल विकास क्या है ?"        -> reply in Devanagari
 *     "bal vikas kya hai bhai"     -> reply in ROMAN Hindi, not Devanagari
 *     "What is child development?" -> reply in English
 *
 * Replying in formal Devanagari to someone typing romanised Hindi reads as a
 * correction. She typed it that way on purpose.
 *
 * Classified per MESSAGE, never per session: she may ask in Hinglish, paste an
 * English question out of a book, then follow up in Hindi.
 */

export interface Register {
  lang: 'en' | 'hi' | 'gu';
  register: 'en' | 'hi' | 'gu' | 'hinglish' | 'gujlish';
  confidence: number;
  evidence: string;
}

const DEVANAGARI = /[ऀ-ॿ]/g;
const GUJARATI = /[઀-૿]/g;
const LATIN = /[A-Za-z]/g;

// High-frequency Hindi function words as people actually type them. Function
// words are the right signal for romanised text: they are the commonest tokens
// in any sentence and survive transliteration essentially unchanged.
const HINGLISH = new Set([
  'hai','hain','he','tha','thi','the','hoga','hogi','hota','hoti',
  'kya','kyu','kyun','kyon','kaise','kaisa','kaisi','kab','kahan','kaun',
  'kitna','kitne','kitni','konsa','kaunsa',
  'nahi','nahin','nai','mat','mujhe','muje','mera','meri','mere',
  'tum','tumhe','aap','aapko','hum','hume','humein',
  'aur','lekin','par','phir','abhi','yeh','ye','woh','wo','vah',
  'batao','bata','samjhao','samjha','chahiye','karo','karna','karta',
  'karti','hona','raha','rahi','rahe','liye','wala','wali','sakta',
  'sakte','bohot','bahut','thoda','acha','accha','theek','thik',
  'kuch','sab','bhi','toh','to','se','ka','ki','ke','ko','me','mein',
  'bhai','yaar','matlab','samajh','padhai','sawal','jawab','prashn',
]);

// Gujarati equivalents. "chhe" (છે) is the copula and is as diagnostic as "hai".
const GUJLISH = new Set([
  'chhe','che','chho','chu','chhu','hatu','hati','hase','thay','thase',
  'shu','su','kem','kya','kyare','kon','ketlu','ketla','kevu','kevi',
  'nathi','nai','mane','maru','mari','mara','tame','tamne','ame','amne',
  'ane','pan','pachi','ave','aa','ae','tya','ahi',
  'kaho','samjavo','joie','karo','karvu','karta','hovu','rahyu',
  'badhu','thodu','saru','barabar','kai','badha',
  'bhai','matlab','samaj','abhyas','prashna','javab',
]);

// Words that are common English AND appear above. Counting them outright would
// classify "to me" or "the car" as Hinglish, so they only count once something
// unambiguous has already been seen.
const AMBIGUOUS = new Set(['to','me','he','the','par','se','aa','ae','pan','kya']);

function count(s: string, re: RegExp): number {
  return (s.match(re) ?? []).length;
}

/**
 * An explicit request for a language, e.g. "write all notes on Hindi".
 *
 * THE BUG THIS FIXES
 * ------------------
 * Everything below classifies the language a message was TYPED IN. That is the
 * right default and it is not the whole question, because a student can ask in
 * one language for an answer in another — and she did:
 *
 *     "No in 6 pages write all notes on Hindi"
 *
 * That sentence contains no Hindi, so it detected as English, the style became
 * "Write in English", and the model obeyed by REFUSING: "I cannot write a
 * 6-page document in Hindi, as I am restricted to English." An app built for a
 * Hindi-medium student told her it does not do Hindi. An asked-for language has
 * to outrank an inferred one.
 *
 * Matches the ways the request is actually phrased, in either script and in
 * romanised form, and requires a preposition or imperative so that a question
 * ABOUT a language ("who wrote the first Hindi novel") is not mistaken for a
 * request to answer in it.
 */
const ASKED_FOR: { re: RegExp; lang: 'en' | 'hi' | 'gu' }[] = [
  { re: /\b(?:in|into|to|on|me|mein|maa|ma)\s+hindi\b|hindi\s+(?:me|mein|m)\b|हिंदी\s*में|हिन्दी\s*में/i, lang: 'hi' },
  { re: /\b(?:in|into|to|on|me|mein|maa|ma)\s+gujarati\b|gujarati\s+(?:ma|maa|me)\b|ગુજરાતી\s*માં/i, lang: 'gu' },
  { re: /\b(?:in|into|to|on)\s+english\b|english\s+(?:me|mein|ma)\b|अंग्रेज़ी\s*में|અંગ્રેજી\s*માં/i, lang: 'en' },
  { re: /\btranslate\b.*\b(?:hindi)\b|\bhindi\b.*\btranslate\b/i, lang: 'hi' },
  { re: /\btranslate\b.*\b(?:gujarati)\b|\bgujarati\b.*\btranslate\b/i, lang: 'gu' },
];

export function requestedLanguage(text: string): 'en' | 'hi' | 'gu' | null {
  const raw = (text ?? '').trim();
  for (const { re, lang } of ASKED_FOR) {
    if (re.test(raw)) return lang;
  }
  return null;
}

export function detectRegister(text: string): Register {
  const raw = (text ?? '').trim();
  if (!raw) return { lang: 'en', register: 'en', confidence: 0, evidence: 'empty message' };

  // An explicit ask wins outright, and wins in FORMAL script: someone who
  // writes "in Hindi" is asking for Hindi she can revise from, not for
  // romanised chat.
  const asked = requestedLanguage(raw);
  if (asked) {
    return { lang: asked, register: asked, confidence: 1, evidence: `asked for ${asked}` };
  }

  const deva = count(raw, DEVANAGARI);
  const gujr = count(raw, GUJARATI);
  const latn = count(raw, LATIN);
  const total = deva + gujr + latn;
  if (total === 0) {
    return { lang: 'en', register: 'en', confidence: 0, evidence: 'no letters' };
  }

  if (deva || gujr) {
    const indic = deva >= gujr ? deva : gujr;
    const lang: 'hi' | 'gu' = deva >= gujr ? 'hi' : 'gu';
    const share = indic / total;
    // A little Latin inside Indic text is normal — a technical term, an option
    // label. That is still Hindi, not a mixed register.
    if (share >= 0.55) {
      return {
        lang,
        register: lang,
        confidence: Math.min(1, share + 0.2),
        evidence: `${indic} Indic vs ${latn} Latin letters`,
      };
    }
    return {
      lang,
      register: lang === 'hi' ? 'hinglish' : 'gujlish',
      confidence: 0.7,
      evidence: `mixed scripts: ${indic} Indic, ${latn} Latin`,
    };
  }

  const tokens = raw.toLowerCase().match(/[a-z]+/g) ?? [];
  if (!tokens.length) return { lang: 'en', register: 'en', confidence: 0.3, evidence: 'no word tokens' };

  let hi = tokens.filter((w) => HINGLISH.has(w) && !AMBIGUOUS.has(w)).length;
  let gu = tokens.filter((w) => GUJLISH.has(w) && !AMBIGUOUS.has(w)).length;
  if (hi) hi += tokens.filter((w) => AMBIGUOUS.has(w) && HINGLISH.has(w)).length;
  if (gu) gu += tokens.filter((w) => AMBIGUOUS.has(w) && GUJLISH.has(w)).length;

  const hits = Math.max(hi, gu);
  if (hits === 0) {
    return { lang: 'en', register: 'en', confidence: 0.9, evidence: 'no romanised Indic markers' };
  }

  const share = hits / tokens.length;
  // One marker in a long English sentence is a loanword, not a register.
  if (hits < 2 && share < 0.25) {
    return {
      lang: 'en',
      register: 'en',
      confidence: 0.6,
      evidence: `only ${hits} marker in ${tokens.length} words`,
    };
  }

  return gu > hi
    ? { lang: 'gu', register: 'gujlish', confidence: Math.min(1, 0.5 + share), evidence: `${gu} Gujarati markers` }
    : { lang: 'hi', register: 'hinglish', confidence: Math.min(1, 0.5 + share), evidence: `${hi} Hindi markers` };
}

/**
 * The register to actually answer in, given who she is.
 *
 * Falls back to the language of her EXAM CONTENT rather than to English. A
 * Hindi-medium CTET candidate who types an English sentence — because she
 * pasted a question out of a book, or because the app's own chrome is English —
 * is still revising in Hindi, and answering her in English hands her notes she
 * then has to translate herself the night before the paper.
 *
 * An explicit request and a message typed in her own language both already
 * decided the answer before this is consulted; this only replaces the "she
 * typed plain English and said nothing about language" default.
 */
export function effectiveRegister(text: string, contentLang: 'en' | 'hi' | 'gu'): Register {
  const reg = detectRegister(text);
  if (reg.register === 'en' && reg.evidence !== 'asked for en' && contentLang !== 'en') {
    return {
      lang: contentLang,
      register: contentLang,
      confidence: 0.8,
      evidence: `no language cue; using her ${contentLang} study medium`,
    };
  }
  return reg;
}

// Each of these is a preference about WHICH language to write in. None of them
// is permission to decline. Stated as a bare constraint, "Write in English."
// was read as a capability limit and produced "I cannot write in Hindi, as I am
// restricted to English" — so every style now says what to do if she asks for
// something else, and NEVER_REFUSE is appended to all of them.
const NEVER_REFUSE =
  ' This is a preference about which language to write in, not a restriction on your ability. ' +
  'If she asks for another language, or for a longer answer, simply give it to her — never reply ' +
  'that you are unable to write in a language.';

const STYLE: Record<Register['register'], string> = {
  en: 'Write in English.',
  hi: 'Write in Hindi, in Devanagari script.',
  gu: 'Write in Gujarati, in Gujarati script.',
  hinglish:
    'Write in Hinglish — conversational Hindi typed in the ROMAN alphabet, the way she wrote to you. ' +
    'Do NOT use Devanagari script. Keep technical and exam terms in English where that is what a ' +
    "student would say ('critical thinking', not a translated coinage).",
  // Gujarati answers use GUJARATI SCRIPT even when she typed in roman letters.
  //
  // This differs deliberately from Hinglish, which mirrors her roman input.
  // The asymmetry is the student's own call: Hinglish reads naturally in roman
  // because that is how people write Hindi casually, whereas she reads Gujarati
  // study material in Gujarati script and wants answers she can put beside her
  // textbook. Romanised Gujarati is fine to type and awkward to study from.
  gujlish:
    'Write in Gujarati, in GUJARATI SCRIPT — even though she typed in roman letters. ' +
    'Keep technical and exam terms in English where that is what a student would say ' +
    "('photosynthesis', not a translated coinage).",
};

export function styleFor(reg: Register): string {
  return (STYLE[reg.register] ?? STYLE.en) + NEVER_REFUSE;
}
