/**
 * Slice 1 fixtures — REAL content, authored to the frozen contract.
 *
 * No lorem ipsum and no "Biology Chapter 1". Every topic below is a genuine
 * high-weightage area of its syllabus, and every Hindi/Gujarati string is a
 * real translation. The point is to stress the typography with the actual
 * strings the app will carry: long Devanagari compounds, Gujarati conjuncts,
 * and mixed Indic+Latin lines like "કોષિકા (Cell)".
 *
 * These are replaced by pipeline output in Slice 2. The SHAPE does not change.
 */

import type { TodaySnapshot } from './contract';

export const ctetToday: TodaySnapshot = {
  examCode: 'CTET',
  minutesAvailable: 47,
  streakDays: 12,
  overallMastery: 61,
  planItems: [
    {
      id: 'p1',
      kind: 'learn',
      minutes: 20,
      title: {
        en: 'Piaget — Concrete Operational Stage',
        hi: 'पियाजे — मूर्त संक्रियात्मक अवस्था',
      },
      detail: { en: '1 concept · 4 key points', hi: '1 अवधारणा · 4 मुख्य बिंदु' },
      topicId: 'ctet.cdp.piaget.concrete',
      rationale: { code: 'HIGH_WEIGHTAGE', params: { pct: 12 } },
      done: false,
    },
    {
      id: 'p2',
      kind: 'practice',
      minutes: 12,
      title: { en: 'Inclusive Education', hi: 'समावेशी शिक्षा' },
      detail: { en: '12 questions', hi: '12 प्रश्न' },
      topicId: 'ctet.cdp.inclusive',
      rationale: { code: 'MISSED_TWICE', params: { count: 2 } },
      done: false,
    },
    {
      id: 'p3',
      kind: 'recall',
      minutes: 10,
      title: { en: 'Language Pedagogy', hi: 'भाषा शिक्षाशास्त्र' },
      detail: { en: '8 flashcards', hi: '8 फ़्लैशकार्ड' },
      topicId: 'ctet.lang1.pedagogy',
      rationale: { code: 'DUE_TODAY', params: { days: 0 } },
      done: false,
    },
    {
      id: 'p4',
      kind: 'fix',
      minutes: 5,
      title: { en: 'Continuous and Comprehensive Evaluation', hi: 'सतत एवं व्यापक मूल्यांकन' },
      detail: { en: '3 mistakes', hi: '3 ग़लतियाँ' },
      topicId: 'ctet.cdp.assessment',
      rationale: { code: 'RECENT_MISTAKE', params: {} },
      done: false,
    },
  ],
  weakConcepts: [
    {
      topicId: 'ctet.cdp.inclusive',
      name: { en: 'Inclusive Education', hi: 'समावेशी शिक्षा' },
      term: 'Inclusive Education',
      mastery: 38,
      rationale: { code: 'MISSED_TWICE', params: { count: 2 } },
    },
    {
      topicId: 'ctet.cdp.vygotsky',
      name: { en: 'Vygotsky — Zone of Proximal Development', hi: 'वायगोत्स्की — निकटस्थ विकास का क्षेत्र' },
      term: 'Zone of Proximal Development',
      mastery: 45,
      rationale: { code: 'DECAYING', params: { retention: 52 } },
    },
    {
      topicId: 'ctet.evs.family',
      name: { en: 'EVS — Family and Friends', hi: 'पर्यावरण अध्ययन — परिवार और मित्र' },
      term: 'Family and Friends',
      mastery: 54,
      rationale: { code: 'NEVER_SEEN', params: {} },
    },
  ],
  continueTopic: {
    topicId: 'ctet.cdp.piaget',
    name: { en: 'Child Development and Pedagogy', hi: 'बाल विकास एवं शिक्षाशास्त्र' },
    term: 'Child Development and Pedagogy',
    progress: 64,
  },
  readiness: null,
};

export const neetToday: TodaySnapshot = {
  examCode: 'NEET',
  minutesAvailable: 90,
  streakDays: 26,
  overallMastery: 68,
  planItems: [
    {
      id: 'n1',
      kind: 'learn',
      minutes: 30,
      title: {
        en: 'Human Physiology — Nephron',
        hi: 'मानव शरीर क्रिया विज्ञान — वृक्काणु',
        gu: 'માનવ શરીરક્રિયાવિજ્ઞાન — નેફ્રોન',
      },
      detail: { en: '1 concept · diagram', hi: '1 अवधारणा · चित्र', gu: '1 ખ્યાલ · આકૃતિ' },
      topicId: 'neet.bio.physiology.nephron',
      rationale: { code: 'HIGH_WEIGHTAGE', params: { pct: 14 } },
      done: false,
    },
    {
      id: 'n2',
      kind: 'practice',
      minutes: 25,
      title: {
        en: 'Chemical Bonding',
        hi: 'रासायनिक आबंधन',
        gu: 'રાસાયણિક બંધન',
      },
      detail: { en: '20 questions', hi: '20 प्रश्न', gu: '20 પ્રશ્નો' },
      topicId: 'neet.chem.bonding',
      rationale: { code: 'MISSED_TWICE', params: { count: 3 } },
      done: false,
    },
    {
      id: 'n3',
      kind: 'recall',
      minutes: 20,
      title: {
        en: 'Genetics — Mendelian Inheritance',
        hi: 'आनुवंशिकी — मेंडेलीय वंशागति',
        gu: 'જનીનવિજ્ઞાન — મેન્ડેલીય વારસો',
      },
      detail: { en: '14 flashcards', hi: '14 फ़्लैशकार्ड', gu: '14 ફ્લેશકાર્ડ' },
      topicId: 'neet.bio.genetics.mendel',
      rationale: { code: 'DUE_TODAY', params: { days: 0 } },
      done: false,
    },
    {
      id: 'n4',
      kind: 'fix',
      minutes: 15,
      title: {
        en: 'Electrostatics — Potential vs Potential Energy',
        hi: 'स्थिरवैद्युतिकी — विभव बनाम स्थितिज ऊर्जा',
        gu: 'સ્થિરવિદ્યુત — વિભવ વિરુદ્ધ સ્થિતિઊર્જા',
      },
      detail: { en: '5 mistakes', hi: '5 ग़लतियाँ', gu: '5 ભૂલો' },
      topicId: 'neet.phy.electrostatics',
      rationale: { code: 'RECENT_MISTAKE', params: {} },
      done: false,
    },
  ],
  weakConcepts: [
    {
      topicId: 'neet.bio.physiology.nephron',
      name: {
        en: 'Counter-current Mechanism',
        hi: 'प्रतिधारा क्रियाविधि',
        gu: 'પ્રતિપ્રવાહ પ્રક્રિયા',
      },
      term: 'Counter-current Mechanism',
      mastery: 34,
      rationale: { code: 'MISSED_TWICE', params: { count: 3 } },
    },
    {
      topicId: 'neet.chem.organic.mechanism',
      name: {
        en: 'Reaction Mechanisms',
        hi: 'अभिक्रिया क्रियाविधि',
        gu: 'પ્રક્રિયા યાંત્રિકી',
      },
      term: 'Reaction Mechanisms',
      mastery: 41,
      rationale: { code: 'DECAYING', params: { retention: 48 } },
    },
    {
      topicId: 'neet.bio.cell',
      name: { en: 'Cell — The Unit of Life', hi: 'कोशिका — जीवन की इकाई', gu: 'કોષિકા — જીવનનું એકમ' },
      term: 'Cell',
      mastery: 57,
      rationale: { code: 'DUE_TODAY', params: { days: 0 } },
    },
  ],
  continueTopic: {
    topicId: 'neet.bio.physiology',
    name: { en: 'Human Physiology', hi: 'मानव शरीर क्रिया विज्ञान', gu: 'માનવ શરીરક્રિયાવિજ્ઞાન' },
    term: 'Human Physiology',
    progress: 72,
  },
  readiness: null,
};

export function todayFor(exam: 'CTET' | 'NEET'): TodaySnapshot {
  return exam === 'NEET' ? neetToday : ctetToday;
}

/** Exam sessions offered in onboarding step 4. Grounded in the real calendars. */
export const TARGETS: Record<'CTET' | 'NEET', { id: string; label: Record<string, string> }[]> = {
  CTET: [
    { id: 'CTET-2026-09', label: { en: 'September 2026', hi: 'सितंबर 2026', gu: 'સપ્ટેમ્બર 2026' } },
    { id: 'CTET-2027-02', label: { en: 'February 2027', hi: 'फ़रवरी 2027', gu: 'ફેબ્રુઆરી 2027' } },
    { id: 'CTET-2027-09', label: { en: 'Later than that', hi: 'उसके बाद', gu: 'તેના પછી' } },
  ],
  NEET: [
    { id: 'NEET-2027-05', label: { en: 'May 2027', hi: 'मई 2027', gu: 'મે 2027' } },
    { id: 'NEET-2028-05', label: { en: 'May 2028', hi: 'मई 2028', gu: 'મે 2028' } },
  ],
};
