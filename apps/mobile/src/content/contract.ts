/**
 * THE CONTENT CONTRACT — frozen in Slice 0, before any screen is built.
 *
 * This is the single most important file for avoiding rework. The Slice 1
 * prototype renders hand-authored fixtures; Slice 2 renders rows produced by
 * the parse/tag/review pipeline. If those two shapes drift, every screen built
 * against fixtures has to be rewritten. So both sides conform to THIS file and
 * neither may change it unilaterally.
 *
 * Design rules encoded here:
 *
 *  - `LocalisedText` is a record keyed by language, not a flat string. A
 *    question that exists in Gujarati, Hindi and English is ONE question with
 *    three renderings, not three questions. That is what lets her switch
 *    language mid-question without losing her answer or her analytics.
 *
 *  - `sourceType` and `reviewStatus` are on every content row. The mobile app
 *    only ever ships `approved` content, and the Papers section only ever
 *    queries `PYQ`. Provenance is a data property, never a UI convention.
 *
 *  - `Rationale` is a discriminated union of {code, params} — never a
 *    pre-rendered sentence. An English string from an LLM cannot be shown to a
 *    Gujarati-medium student, and "why am I being shown this" is precisely the
 *    thing that makes the app feel like it knows her.
 */

import type { Lang } from '@/store/profile';

/** Text that exists in one or more languages. `en` is always present. */
export type LocalisedText = { en: string } & Partial<Record<Lang, string>>;

/** Read a localised value with a sensible fallback chain. */
export function pick(text: LocalisedText, lang: Lang): string {
  return text[lang] ?? text.en;
}

export type ExamCode = 'CTET' | 'NEET';

/**
 * Where a piece of content came from. AI_GENERATED content is never
 * presented as official, anywhere, under any filter.
 */
export type SourceType =
  | 'OFFICIAL_SYLLABUS'
  | 'PYQ'
  | 'ANSWER_KEY'
  | 'TEXTBOOK'
  | 'TEACHER_NOTE'
  | 'AI_GENERATED';

/** The human review gate. Only `approved` rows are exported into the app. */
export type ReviewStatus = 'pending' | 'approved' | 'rejected';

/** A node in the official syllabus tree. Everything else hangs off these. */
export interface SyllabusNode {
  id: string;
  examCode: ExamCode;
  parentId: string | null;
  level: 'subject' | 'chapter' | 'topic' | 'concept';
  name: LocalisedText;
  /** Canonical English term, always shown alongside the localised name. */
  term: string;
  /** Share of the paper this node historically accounts for, 0-100. */
  weightage?: number;
}

export interface QuestionOption {
  label: 'A' | 'B' | 'C' | 'D';
  text: LocalisedText;
  isCorrect: boolean;
}

export interface Question {
  id: string;
  /** Groups the same question across languages and booklet codes. */
  groupId: string;
  paperId: string | null;
  number: number;
  stem: LocalisedText;
  options: QuestionOption[];
  topicId: string;
  difficulty: 'easy' | 'medium' | 'hard';
  sourceType: SourceType;
  reviewStatus: ReviewStatus;
  figureUri?: string;
  /** Official boards void questions; scoring must honour this. */
  status: 'ok' | 'dropped' | 'bonus';
  explanation?: LocalisedText;
  /** Why each wrong option is wrong, keyed by option label. */
  distractors?: Partial<Record<'A' | 'B' | 'C' | 'D', LocalisedText>>;
}

export interface Paper {
  id: string;
  examCode: ExamCode;
  /** 'CTET_P1' | 'CTET_P2' | 'NEET' */
  paperType: string;
  sessionLabel: LocalisedText;
  heldOn: string;
  languages: Lang[];
  sourceType: SourceType;
  reviewStatus: ReviewStatus;
  totalQuestions: number;
  totalMarks: number;
  durationMin: number;
  /** Set when a sitting was cancelled (e.g. NEET 3 May 2026). Still practisable, excluded from trends. */
  cancelled?: boolean;
}

/**
 * Why the planner chose an item. Structured, never prose — see the file
 * header. Rendered through `why.<CODE>` keys in the string dictionaries.
 */
export type Rationale =
  | { code: 'DUE_TODAY'; params: { days: number } }
  | { code: 'MISSED_TWICE'; params: { count: number } }
  | { code: 'HIGH_WEIGHTAGE'; params: { pct: number } }
  | { code: 'DECAYING'; params: { retention: number } }
  | { code: 'NEVER_SEEN'; params: Record<string, never> }
  | { code: 'RECENT_MISTAKE'; params: Record<string, never> };

export type PlanKind = 'learn' | 'practice' | 'recall' | 'fix';

export interface PlanItem {
  id: string;
  kind: PlanKind;
  minutes: number;
  title: LocalisedText;
  /** e.g. "12 questions", "8 flashcards" — the concrete unit of work. */
  detail: LocalisedText;
  topicId: string;
  rationale: Rationale;
  done: boolean;
}

export interface WeakConcept {
  topicId: string;
  name: LocalisedText;
  term: string;
  /** 0-100. */
  mastery: number;
  rationale: Rationale;
}

/** Everything the Today screen needs. Assembled locally, never fetched. */
export interface TodaySnapshot {
  examCode: ExamCode;
  minutesAvailable: number;
  streakDays: number;
  overallMastery: number;
  planItems: PlanItem[];
  weakConcepts: WeakConcept[];
  continueTopic: { topicId: string; name: LocalisedText; term: string; progress: number } | null;
  /**
   * Null until she has sat >= 2 full mocks AND covered >= 25% of the syllabus.
   * A confident readiness number that turns out wrong destroys trust
   * permanently, so it stays locked until it can be justified.
   */
  readiness: { lowPct: number; highPct: number; basis: LocalisedText } | null;
}
