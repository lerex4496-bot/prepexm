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

export function detectRegister(text: string): Register {
  const raw = (text ?? '').trim();
  if (!raw) return { lang: 'en', register: 'en', confidence: 0, evidence: 'empty message' };

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
  return STYLE[reg.register] ?? STYLE.en;
}
