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
import { buildMock, isMockId, mockPaper, parseMockId } from '@/exam/mockBuilder';
import { wrongQuestionIds } from './mistakes';

const DB_NAME = 'studymate.db';

/**
 * A floor for "the copy actually landed", not an exact size.
 *
 * The bundle is currently ~660 KB and grows as questions are approved, so an
 * exact match would need updating on every content release and would fail
 * closed the one time someone forgot. 400 KB is comfortably below any real
 * bundle and comfortably above a truncated write.
 */
const MIN_DB_BYTES = 400_000;

/**
 * The content bundle could not be made available. Thrown rather than returning
 * a broken handle, so callers show a real message instead of an empty screen —
 * a silently empty Today tab is indistinguishable from "you have nothing to do".
 */
export class ContentUnavailable extends Error {}

let db: SQLite.SQLiteDatabase | null = null;

/**
 * The open that is currently in flight, so concurrent callers share one.
 *
 * THE BUG THIS FIXES
 * ------------------
 * `db` alone is not enough of a guard. It is only assigned at the very END of
 * openContentDb, after the unpack and both verification queries — so every
 * caller that arrives before then sees null and starts its own unpack.
 *
 * On a fresh launch that is exactly what happens: Today, Learn and Practice
 * mount together and each call in. The unpack path deletes the destination
 * file and closes handles, so one caller pulls the file out from under
 * another, and the next statement gets a null native handle. On the phone that
 * surfaced as:
 *
 *     Could not load your plan
 *     Call to function 'NativeDatabase.prepareAsync' has been rejected.
 *     -> Caused by: java.lang.NullPointerException
 *
 * with Practice showing "No papers yet" and Learn blank — all three symptoms
 * of one race, and none of them of missing content. The bank was intact the
 * whole time.
 *
 * It hid for a long time because the window is only as wide as the copy: the
 * database grew from 3.0 MB to 3.3 MB when the Hindi was backfilled, and a
 * cleared install meant the copy ran fresh rather than being skipped.
 */
let opening: Promise<SQLite.SQLiteDatabase> | null = null;

/** Bytes currently on disk, or 0 if the path does not exist. */
async function sizeOf(path: string): Promise<number> {
  const info = await FileSystem.getInfoAsync(path);
  return info.exists ? ((info as { size?: number }).size ?? 0) : 0;
}

/**
 * Copy the bundled asset over whatever is at `dest`, and refuse to stamp it
 * unless the copy actually landed.
 *
 * copyAsync does not reliably throw when the filesystem runs out of room
 * mid-write — it can leave a truncated file behind. Stamping that as a good
 * copy is what turned a transient out-of-storage condition into a permanently
 * broken install: every launch afterwards saw a matching stamp, skipped the
 * copy, and opened a corrupt database.
 *
 * Not hypothetical. The app was first installed on a phone sitting at 100%
 * storage (590 MB free of 107 GB), which is exactly that condition.
 */
async function unpack(dest: string, stampPath: string, asset: Asset, stamp: string): Promise<void> {
  await FileSystem.deleteAsync(dest, { idempotent: true });
  await FileSystem.deleteAsync(stampPath, { idempotent: true });
  await FileSystem.copyAsync({ from: asset.localUri ?? asset.uri, to: dest });

  const copied = await sizeOf(dest);
  if (copied < MIN_DB_BYTES) {
    // Leave nothing behind to inherit.
    await FileSystem.deleteAsync(dest, { idempotent: true });
    throw new ContentUnavailable(
      `The question bank could not be unpacked — only ${copied} bytes were written. ` +
        `This usually means the phone is out of storage. Free up some space and reopen the app.`
    );
  }
  await FileSystem.writeAsStringAsync(stampPath, stamp);
}

/**
 * expo-sqlite can only open databases inside its own directory, so the bundled
 * asset is copied there once. The copy is keyed on the asset hash so a new
 * content bundle replaces the old one instead of being silently ignored.
 *
 * HEALING A BAD COPY
 * ------------------
 * Both integrity checks below run on the ORDINARY launch path, not only after
 * a copy. An earlier version checked the size solely inside the copy branch,
 * which made it useless for the phone it was written for: a truncated file
 * already stamped by an older build had `exists === true` and a matching stamp,
 * so the branch was skipped and the corrupt database opened forever. A check
 * that only runs on installs that were never broken protects nothing.
 *
 * When either check fails the file is re-unpacked and reopened IN PLACE, so the
 * repair happens on the launch that noticed the damage rather than asking her
 * to close and reopen an app that just told her it was broken.
 */
/**
 * Guarantee that `files/SQLite` is a DIRECTORY before anything opens a database.
 *
 * THE FAILURE THIS REPAIRS
 * ------------------------
 * On a real phone this path ended up existing as a FILE. Every database open
 * then died with:
 *
 *     Could not open database .../files/SQLite/studymate-local.db
 *     Couldn't create directory '.../files/SQLite'
 *     Path already points to a non-normal file.
 *
 * That takes out BOTH databases — the content bundle and the writable
 * attempts/mistakes store — because expo-sqlite keeps them in the same folder.
 * So Today, Practice, Learn and Progress were all empty while Ask kept working,
 * since chat lives in AsyncStorage. The app looked like it had shipped with no
 * content, and I spent two builds blaming the content queries.
 *
 * Once the path is a file nothing recovers on its own: expo-sqlite calls
 * mkdirs(), mkdirs() refuses because something is already there, and it fails
 * identically on every launch forever.
 *
 * Exported and called by BOTH open paths, because whichever database opens
 * first has to find the folder sane.
 */
export async function ensureSQLiteDir(): Promise<void> {
  const dir = `${FileSystem.documentDirectory}SQLite`;
  const info = await FileSystem.getInfoAsync(dir);

  if (info.exists && !info.isDirectory) {
    // A regular file squatting on the directory name. It cannot be anything we
    // want to keep — the databases live INSIDE this path — so remove it.
    await FileSystem.deleteAsync(dir, { idempotent: true });
  }

  const after = await FileSystem.getInfoAsync(dir);
  if (!after.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }
}

export async function openContentDb(): Promise<SQLite.SQLiteDatabase> {
  if (db) return db;
  // Everyone who arrives mid-unpack waits on the same work rather than
  // starting a competing one. See `opening` above for what that race did.
  if (opening) return opening;

  opening = (async () => openContentDbUncached())();
  try {
    db = await opening;
    return db;
  } finally {
    // Cleared either way: on success `db` short-circuits every later call, and
    // on failure the next call must be free to try again rather than being
    // handed a rejected promise for the life of the process.
    opening = null;
  }
}

async function openContentDbUncached(): Promise<SQLite.SQLiteDatabase> {
  const dir = `${FileSystem.documentDirectory}SQLite`;
  const dest = `${dir}/${DB_NAME}`;

  await ensureSQLiteDir();

  const asset = Asset.fromModule(require('../../assets/content/studymate.db'));
  await asset.downloadAsync();

  const stampPath = `${dir}/${DB_NAME}.stamp`;
  const stamp = asset.hash ?? asset.uri;
  const prevStamp = (await FileSystem.getInfoAsync(stampPath)).exists
    ? await FileSystem.readAsStringAsync(stampPath)
    : null;

  // Check 1 — size, every launch. Catches the truncated write.
  let unpacked = false;
  const before = await sizeOf(dest);
  if (prevStamp !== stamp || before < MIN_DB_BYTES) {
    await unpack(dest, stampPath, asset, stamp);
    unpacked = true;
  }

  // Check 2 — a real query, every launch. A file can be the right SIZE and
  // still not be a database: a short write that happened to land past the
  // threshold, or a truncation that severed the page table while leaving the
  // header intact. Size is a cheap proxy; reading a row is the only thing that
  // proves the file opens. `count(*)` over three rows costs microseconds, and
  // runs once per process because the handle is memoised at the end.
  let opened = await SQLite.openDatabaseAsync(DB_NAME);
  try {
    await opened.getFirstAsync<{ n: number }>('SELECT count(*) AS n FROM papers');
  } catch (first) {
    // Already unpacked this launch means a fresh copy is what just failed —
    // recopying would only produce the same file, so stop rather than loop.
    if (unpacked) {
      await opened.closeAsync().catch(() => undefined);
      await FileSystem.deleteAsync(dest, { idempotent: true });
      await FileSystem.deleteAsync(stampPath, { idempotent: true });
      throw new ContentUnavailable(
        `The question bank could not be opened even after unpacking a fresh copy. ` +
          `(${first instanceof Error ? first.message : String(first)})`
      );
    }

    // Otherwise this is the damaged file from a previous install. Close the
    // handle before deleting — an open handle on a deleted path leaves SQLite
    // writing into a file nothing can reach — then unpack and try once more.
    await opened.closeAsync().catch(() => undefined);
    await unpack(dest, stampPath, asset, stamp);

    opened = await SQLite.openDatabaseAsync(DB_NAME);
    try {
      await opened.getFirstAsync<{ n: number }>('SELECT count(*) AS n FROM papers');
    } catch (second) {
      await opened.closeAsync().catch(() => undefined);
      await FileSystem.deleteAsync(dest, { idempotent: true });
      await FileSystem.deleteAsync(stampPath, { idempotent: true });
      throw new ContentUnavailable(
        `The question bank on this phone is damaged and could not be replaced. ` +
          `Free up some storage and reopen the app. ` +
          `(${second instanceof Error ? second.message : String(second)})`
      );
    }
  }

  const check = await opened.getFirstAsync<{ p: number; q: number }>(
    `SELECT (SELECT COUNT(*) FROM papers) AS p, (SELECT COUNT(*) FROM questions) AS q`
  );

  // Memoised by the caller, not here — this function is now the uncached body
  // and openContentDb owns both `db` and the in-flight promise.
  return opened;
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

/**
 * What the app can actually SEE, counted through the same filters the screens
 * use — not what the bundle is supposed to contain.
 *
 * Exists because "Practice is empty" had two indistinguishable causes: content
 * missing from the bundle, or a query returning nothing. Diagnosing that meant
 * a full rebuild-and-install cycle each time. Surfacing the counts in Settings
 * separates the two in one glance: a bundle holding 20 papers while this
 * reports 0 for her is a filter problem, not a content problem.
 */
export async function contentCounts(): Promise<{
  papers: number;
  questions: number;
  visiblePapers: number;
  visibleQuestions: number;
}> {
  const d = await openContentDb();
  const all = await d.getFirstAsync<{ p: number; q: number }>(
    `SELECT (SELECT COUNT(*) FROM papers) AS p, (SELECT COUNT(*) FROM questions) AS q`
  );
  const visible = await listPapers();
  const ids = visible.map((p) => p.id);
  let visibleQuestions = 0;
  if (ids.length) {
    const row = await d.getFirstAsync<{ n: number }>(
      `SELECT COUNT(*) AS n FROM questions WHERE paper_id IN (${ids.map(() => '?').join(',')})`,
      ...ids
    );
    visibleQuestions = row?.n ?? 0;
  }
  return {
    papers: all?.p ?? 0,
    questions: all?.q ?? 0,
    visiblePapers: visible.length,
    visibleQuestions,
  };
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

/**
 * The paper she is sitting, or null for "all of them".
 *
 * Read here for the same reason as `currentExam()`: a filter a caller has to
 * remember to pass is a filter that will eventually be forgotten. Null is
 * meaningful rather than a missing value — NEET has no such split, and a
 * profile created before this field existed has not chosen one.
 */
export function currentPaperType(): string | null {
  return useProfile.getState().profile.paperType ?? null;
}

export async function listPapers(
  examCode: string = currentExam(),
  paperType: string | null = currentPaperType()
): Promise<PaperRow[]> {
  const d = await openContentDb();
  // NO NULLABLE BINDS.
  //
  // This was written as one statement with `(? IS NULL OR paper_type = ?)` and
  // a null bound twice, which is correct SQL — plain sqlite3 returns all 20
  // papers for it. But it depends on the driver marshalling JS `null` to SQL
  // NULL, and if that instead arrives as the string "null" the guard is false,
  // `paper_type = 'null'` matches nothing, and the query returns zero rows.
  //
  // Zero rows is indistinguishable from "no content": Practice, Today and
  // Learn all render their empty state and the app looks like it shipped with
  // nothing in it, while Ask keeps working because it reads AsyncStorage
  // rather than this database. That is precisely the failure that was
  // reported.
  //
  // Branching in JS binds only values that exist, so there is nothing for a
  // driver to mis-marshal.
  if (!paperType) {
    return d.getAllAsync<PaperRow>(
      `SELECT * FROM papers WHERE exam_code = ? ORDER BY held_on DESC, paper_type ASC`,
      examCode
    );
  }
  return d.getAllAsync<PaperRow>(
    `SELECT * FROM papers
      WHERE exam_code = ? AND paper_type = ?
      ORDER BY held_on DESC, paper_type ASC`,
    examCode,
    paperType
  );
}

/**
 * Every approved question for one paper type — the pool a mock draws from.
 *
 * Deliberately NOT scoped to a single paper: a mock mixes questions from every
 * sitting we hold, which is the whole point of it.
 */
export async function questionPool(paperType: string): Promise<LoadedQuestion[]> {
  const d = await openContentDb();
  const questions = await d.getAllAsync<QuestionRow>(
    `SELECT q.* FROM questions q
       JOIN papers p ON p.id = q.paper_id
      WHERE p.exam_code = ? AND p.paper_type = ?
      ORDER BY q.id`,
    currentExam(),
    paperType
  );
  const options = await d.getAllAsync<OptionRow>(
    `SELECT o.* FROM options o
       JOIN questions q ON q.id = o.question_id
       JOIN papers p ON p.id = q.paper_id
      WHERE p.exam_code = ? AND p.paper_type = ?
      ORDER BY o.question_id, o.label`,
    currentExam(),
    paperType
  );
  const byQuestion = new Map<string, OptionRow[]>();
  for (const o of options) {
    const list = byQuestion.get(o.question_id);
    if (list) list.push(o);
    else byQuestion.set(o.question_id, [o]);
  }
  return questions.map((q) => ({ ...q, options: byQuestion.get(q.id) ?? [] }));
}

/**
 * Syllabus topics present in her paper, with how many questions each has.
 *
 * Ordered by the measured revision priority (see src/exam/topicPriority.ts),
 * not alphabetically — the point of the list is to answer "what should I revise
 * first?", and alphabetical order answers a question nobody asked.
 */
export async function listTopics(): Promise<{ topicId: string; questions: number }[]> {
  const d = await openContentDb();
  const paperType = currentPaperType();
  const base = `SELECT q.topic_id AS topicId, COUNT(*) AS questions
       FROM questions q JOIN papers p ON p.id = q.paper_id
      WHERE p.exam_code = ? AND q.topic_id IS NOT NULL`;
  const tail = ` GROUP BY q.topic_id`;
  const rows = paperType
    ? await d.getAllAsync<{ topicId: string; questions: number }>(
        `${base} AND p.paper_type = ?${tail}`,
        currentExam(),
        paperType
      )
    : await d.getAllAsync<{ topicId: string; questions: number }>(`${base}${tail}`, currentExam());
  return rows;
}

/** What to call this practice set on screen. */
function mockLabel(spec: { mode: string; param: string }): string {
  if (spec.mode === 'section') return 'Section practice';
  if (spec.mode === 'topic') return 'Topic practice';
  if (spec.mode === 'priority') return 'Most-asked topics';
  if (spec.mode === 'weak') return 'Your weak areas';
  return 'Mock test';
}

/** The paper type a mock is built for — hers if chosen, else the only sensible default. */
function mockPaperType(): string {
  return currentPaperType() ?? 'CTET_P2_SOCSCI';
}

export async function getPaper(
  paperId: string,
  examCode: string = currentExam()
): Promise<PaperRow | null> {
  // A mock has no row in the bundle — it is assembled from its seed. Handling
  // it here means the exam player, timer, palette, scoring, results and
  // mistake review all work on it unchanged: they only ever see a PaperRow.
  if (isMockId(paperId)) {
    const type = mockPaperType();
    const spec = parseMockId(paperId);
    const { questions } = buildMock(
      spec,
      type,
      await questionPool(type),
      spec.mode === 'weak' ? await wrongQuestionIds() : []
    );
    return mockPaper(spec, type, questions.length, mockLabel(spec));
  }

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
  // Rebuilt from the seed rather than stored, so resuming a mock mid-attempt
  // returns the same questions in the same order.
  if (isMockId(paperId)) {
    const type = mockPaperType();
    const spec = parseMockId(paperId);
    return buildMock(
      spec,
      type,
      await questionPool(type),
      spec.mode === 'weak' ? await wrongQuestionIds() : []
    ).questions;
  }

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
