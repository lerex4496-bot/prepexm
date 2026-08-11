/**
 * Content database — the READ path.
 *
 * `studymate.db` ships inside the APK as an asset and holds only APPROVED
 * content (the export query filters on review_status='approved'). It is opened
 * read-only and never written to, so the provenance chain
 *
 *     SOURCE -> EXTRACT -> VALIDATE -> HUMAN REVIEW -> APPROVED -> APP
 *
 * still holds on device: nothing the student sees can have entered any other
 * way.
 *
 * Attempts and mistakes live in a SEPARATE writable database (see local.ts),
 * because the content bundle is replaced wholesale on every update and her
 * work must survive that.
 */

import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system/legacy';
import * as SQLite from 'expo-sqlite';

import { useProfile } from '@/store/profile';

const DB_NAME = 'studymate.db';

let db: SQLite.SQLiteDatabase | null = null;

/**
 * expo-sqlite can only open databases inside its own directory, so the bundled
 * asset is copied there once. The copy is keyed on the asset hash so a new
 * content bundle replaces the old one instead of being silently ignored.
 */
export async function openContentDb(): Promise<SQLite.SQLiteDatabase> {
  if (db) return db;

  const dir = `${FileSystem.documentDirectory}SQLite`;
  const dest = `${dir}/${DB_NAME}`;

  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) await FileSystem.makeDirectoryAsync(dir, { intermediates: true });

  const asset = Asset.fromModule(require('../../assets/content/studymate.db'));
  await asset.downloadAsync();

  const stampPath = `${dir}/${DB_NAME}.stamp`;
  const stamp = asset.hash ?? asset.uri;
  const existing = await FileSystem.getInfoAsync(dest);
  const prevStamp = (await FileSystem.getInfoAsync(stampPath)).exists
    ? await FileSystem.readAsStringAsync(stampPath)
    : null;

  if (!existing.exists || prevStamp !== stamp) {
    if (existing.exists) await FileSystem.deleteAsync(dest, { idempotent: true });
    await FileSystem.copyAsync({ from: asset.localUri ?? asset.uri, to: dest });
    await FileSystem.writeAsStringAsync(stampPath, stamp);
  }

  db = await SQLite.openDatabaseAsync(DB_NAME);
  return db;
}

export interface PaperRow {
  id: string;
  exam_code: string;
  paper_type: string;
  session_label: string;
  held_on: string;
  set_code: string | null;
  source_type: string;
  total_questions: number;
  duration_min: number;
  total_marks: number;
}

export interface QuestionRow {
  id: string;
  paper_id: string;
  number: number;
  part: string | null;
  subject: string | null;
  stem_en: string;
  stem_hi: string | null;
  /**
   * Reading material shared by a comprehension block. Repeated on every
   * question in the block, because a question that asks about a text is
   * unanswerable without it.
   */
  passage_en: string | null;
  passage_hi: string | null;
  extraction_en: string | null;
  extraction_hi: string | null;
  topic_id: string | null;
  explanation_en: string | null;
  explanation_hi: string | null;
  /** Null across the CTET corpus; populated for NEET. See content/localise.ts. */
  explanation_gu: string | null;
  /** 'ok' | 'bonus' — bonus means the official key accepted every option. */
  status: string;
  multi_key: number;
  key_raw: string | null;
}

export interface OptionRow {
  question_id: string;
  label: string;
  text_en: string;
  text_hi: string | null;
  is_correct: number;
}

export interface LoadedQuestion extends QuestionRow {
  options: OptionRow[];
}

export async function getMeta(): Promise<Record<string, string>> {
  const d = await openContentDb();
  const rows = await d.getAllAsync<{ key: string; value: string }>('SELECT key, value FROM meta');
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

/**
 * The exam this student is preparing for.
 *
 * EVERY content query is scoped through this. The first version of this file
 * declared `exam_code` as a type and then used it in exactly zero queries, so a
 * NEET student was served CTET papers — the bundle simply returned everything
 * it had. Reading the exam here rather than accepting it as a parameter makes
 * that class of bug impossible: a caller cannot forget to pass what it never
 * passes.
 */
export function currentExam(): string {
  return useProfile.getState().profile.exam ?? 'CTET';
}

export async function listPapers(examCode: string = currentExam()): Promise<PaperRow[]> {
  const d = await openContentDb();
  return d.getAllAsync<PaperRow>(
    `SELECT * FROM papers WHERE exam_code = ? ORDER BY held_on DESC, paper_type ASC`,
    examCode
  );
}

export async function getPaper(
  paperId: string,
  examCode: string = currentExam()
): Promise<PaperRow | null> {
  const d = await openContentDb();
  return d.getFirstAsync<PaperRow>(
    `SELECT * FROM papers WHERE id = ? AND exam_code = ?`,
    paperId,
    examCode
  );
}

/**
 * Load an entire paper in ONE pass, before the timer starts.
 *
 * The exam player's performance budget forbids any database read once the test
 * is running — a query mid-test can stall a frame, and a stall while she is
 * reading a question under time pressure is the worst possible moment for it.
 */
export async function loadPaperQuestions(
  paperId: string,
  examCode: string = currentExam()
): Promise<LoadedQuestion[]> {
  const d = await openContentDb();
  // Joined to papers so the exam scope holds even if a paper id from another
  // exam is passed in — the filter cannot be bypassed by a stale route param.
  const questions = await d.getAllAsync<QuestionRow>(
    `SELECT q.* FROM questions q
       JOIN papers p ON p.id = q.paper_id
      WHERE q.paper_id = ? AND p.exam_code = ?
      ORDER BY q.number ASC`,
    paperId,
    examCode
  );
  const options = await d.getAllAsync<OptionRow>(
    `SELECT o.* FROM options o
       JOIN questions q ON q.id = o.question_id
       JOIN papers p ON p.id = q.paper_id
      WHERE q.paper_id = ? AND p.exam_code = ?
      ORDER BY o.question_id, o.label`,
    paperId,
    examCode
  );

  const byQuestion = new Map<string, OptionRow[]>();
  for (const o of options) {
    const list = byQuestion.get(o.question_id);
    if (list) list.push(o);
    else byQuestion.set(o.question_id, [o]);
  }

  return questions.map((q) => ({ ...q, options: byQuestion.get(q.id) ?? [] }));
}
