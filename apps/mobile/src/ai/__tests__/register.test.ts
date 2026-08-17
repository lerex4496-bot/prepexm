import { detectRegister, effectiveRegister, requestedLanguage, styleFor } from '../register';

/**
 * The case that sent this file into existence is the first one below.
 *
 * She typed, in English, "No in 6 pages write all notes on Hindi" — and got
 * back "I cannot write a 6-page document in Hindi, as I am restricted to
 * English." Two separate defects lined up to produce it: the classifier only
 * ever asked what language the message was TYPED in, and the style string it
 * chose read as a capability limit rather than a preference. Both are covered
 * here, because both would regress quietly — the app would still answer, just
 * in the wrong language, and nothing would look broken.
 */
describe('an explicitly requested language', () => {
  it('is honoured when the request itself is in English', () => {
    const reg = detectRegister('No in 6 pages write all notes on Hindi');
    expect(reg.lang).toBe('hi');
    // Formal script, not Hinglish: someone asking "in Hindi" wants Hindi she
    // can revise from, not romanised chat.
    expect(reg.register).toBe('hi');
  });

  it.each([
    ['write this in Gujarati please', 'gu'],
    ['translate to hindi', 'hi'],
    ['hindi me samjhao', 'hi'],
    ['explain in English', 'en'],
    ['answer in gujarati', 'gu'],
  ])('%s -> %s', (message, lang) => {
    expect(requestedLanguage(message)).toBe(lang);
  });

  it('does not mistake a question ABOUT a language for a request to use it', () => {
    expect(requestedLanguage('who wrote the first Hindi novel')).toBeNull();
    expect(requestedLanguage('what is the Gujarati alphabet called')).toBeNull();
  });
});

describe('falling back to her study medium', () => {
  it('answers a Hindi-medium student in Hindi when she types plain English', () => {
    // The commonest real case: she pastes a question out of an English book,
    // or types in English because the app chrome is English. Answering in
    // English hands a Hindi-medium candidate notes she has to translate.
    const reg = effectiveRegister('What is inclusive education?', 'hi');
    expect(reg.lang).toBe('hi');
  });

  it('answers a Gujarati-medium student in Gujarati', () => {
    expect(effectiveRegister('Explain photosynthesis', 'gu').lang).toBe('gu');
  });

  it('still lets her override the fallback by asking', () => {
    expect(effectiveRegister('explain in English', 'hi').lang).toBe('en');
  });

  it('leaves a message typed in her own register alone', () => {
    // Hinglish must stay romanised. Replying in formal Devanagari to someone
    // typing roman Hindi reads as a correction.
    expect(effectiveRegister('mujhe photosynthesis samjhao', 'hi').register).toBe('hinglish');
  });

  it('does not push English on an English-medium student', () => {
    expect(effectiveRegister('What is inclusive education?', 'en').lang).toBe('en');
  });
});

describe('style instructions', () => {
  it.each(['en', 'hi', 'gu', 'hinglish', 'gujlish'] as const)(
    '%s never licenses a refusal',
    (register) => {
      const style = styleFor({ lang: 'hi', register, confidence: 1, evidence: 'test' });
      expect(style).toMatch(/never reply/i);
      expect(style).toMatch(/not a restriction on your ability/i);
    }
  );
});
