/**
 * Local database — the WRITE path. Attempts, responses and mistakes.
 *
 * Deliberately separate from the content bundle: `studymate.db` is replaced
 * wholesale whenever new approved content ships, and her work must survive
 * that. Nothing here is ever overwritten by a content update.
 *
 * Responses are written on EVERY interaction, not at submit. If the process is
 * killed mid-test — a call, low memory, an accidental swipe — the attempt
 * resumes from the last write with nothing lost. The submit screen is proof of
 * a local write, never of a network call; there is no network in this path at
 * all.
 */

import * as SQLite from 'expo-sqlite';

import { ensureSQLiteDir } from './content';

const DB_NAME = 'studymate-local.db';

let db: SQLite.SQLiteDatabase | null = null;

/**
 * The open in flight, so concurrent callers share one — and, more importantly,
 * so nobody is handed a handle before its schema exists.
 *
 * THE BUG THIS FIXES, WHICH WAS THE WORSE OF THE TWO
 * --------------------------------------------------
 * This function used to assign `db` on the line that OPENED the database:
 *
 *     db = await SQLite.openDatabaseAsync(DB_NAME);
 *     await db.execAsync(SCHEMA);      // tables created here
 *     await migrate(db);               // and altered here
 *
 * So for the whole duration of the schema and migration work, `db` was already
 * non-null. Any other caller arriving in that window hit `if (db) return db`
 * and went straight to querying a database whose tables did not exist yet, and
 * whose migrations were still running on the same connection underneath it.
 *
 * Today, Learn and Practice all mount together and all read this database, so
 * that window is hit on essentially every cold start. It is the same race that
 * was fixed in content.ts, and fixing only that one left this half live — which
 * is why the phone still showed
 *
 *     Could not load your plan
 *     NativeDatabase.prepareAsync ... java.lang.NullPointerException
 *
 * after a language toggle re-ran the queries.
 *
 * `db` is now assigned only after the schema and migrations have completed, so
 * a handle is never visible until it is actually usable.
 */
let opening: Promise<SQLite.SQLiteDatabase> | null = null;

const SCHEMA = `
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS attempts (
  id            TEXT PRIMARY KEY,
  paper_id      TEXT NOT NULL,
  started_at    INTEGER NOT NULL,
  submitted_at  INTEGER,
  duration_s    INTEGER,
  score         REAL,
  max_score     REAL,
  correct       INTEGER,
  incorrect     INTEGER,
  unattempted   INTEGER,
  bonus_awarded INTEGER DEFAULT 0,
  synced        INTEGER NOT NULL DEFAULT 0,
  -- Elapsed time is the SUM OF ACTIVE SPANS, not wall-clock since started_at.
  --
  -- It used to be (now - started_at). Pausing an exam on Monday and resuming on
  -- Tuesday therefore showed the timer long expired and auto-submitted a blank
  -- paper. accumulated_ms holds the closed spans; active_since is when the
  -- current span opened, and is NULL exactly when the attempt is paused.
  accumulated_ms INTEGER NOT NULL DEFAULT 0,
  active_since   INTEGER,
  -- Kept only so history can say "paused 2 days ago". Not used in arithmetic.
  paused_at      INTEGER
);

CREATE TABLE IF NOT EXISTS responses (
  attempt_id   TEXT NOT NULL,
  question_id  TEXT NOT NULL,
  chosen       TEXT,
  marked       INTEGER NOT NULL DEFAULT 0,
  visited      INTEGER NOT NULL DEFAULT 0,
  time_ms      INTEGER NOT NULL DEFAULT 0,
  is_correct   INTEGER,
  PRIMARY KEY (attempt_id, question_id)
);

CREATE TABLE IF NOT EXISTS mistakes (
  id           TEXT PRIMARY KEY,
  attempt_id   TEXT NOT NULL,
  question_id  TEXT NOT NULL,
  paper_id     TEXT NOT NULL,
  topic_id     TEXT,
  chosen       TEXT,
  correct      TEXT,
  -- Self-classified by the student, one tap, after the review screen.
  -- Prefilled from a time signal but ALWAYS overridable: an automatic guess at
  -- "silly" vs "conceptual" is wrong often enough that being told the wrong
  -- reason you failed is worse than being told nothing.
  mistake_type TEXT,
  created_at   INTEGER NOT NULL,
  resolved_at  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_mistakes_topic ON mistakes(topic_id, resolved_at);
`;

/**
 * Columns added after the first release. `CREATE TABLE IF NOT EXISTS` is a
 * no-op on an existing table, so a phone that already has this database would
 * never gain them — the pause columns have to be added explicitly.
 */
const ADDED_COLUMNS: { table: string; column: string; ddl: string }[] = [
  { table: 'attempts', column: 'accumulated_ms', ddl: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'attempts', column: 'active_since', ddl: 'INTEGER' },
  { table: 'attempts', column: 'paused_at', ddl: 'INTEGER' },
];

async function migrate(d: SQLite.SQLiteDatabase): Promise<void> {
  for (const { table, column, ddl } of ADDED_COLUMNS) {
    const cols = await d.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
    if (cols.some((c) => c.name === column)) continue;
    await d.execAsync(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  }
  // An attempt from before the split has no span data. Seed it from the old
  // wall-clock meaning so an in-flight exam is not reset to zero: that was the
  // truth as far as the old code was concerned.
  await d.runAsync(
    `UPDATE attempts
        SET active_since = started_at
      WHERE submitted_at IS NULL AND active_since IS NULL AND accumulated_ms = 0`
  );
}

export async function openLocalDb(): Promise<SQLite.SQLiteDatabase> {
  if (db) return db;
  if (opening) return opening;

  opening = (async () => {
    // Both databases share files/SQLite, and that path was found existing as a
    // FILE on a real device — which made every open here fail permanently with
    // "Path already points to a non-normal file". Whichever database opens first
    // has to repair the folder, so this runs on both paths.
    await ensureSQLiteDir();
    const opened = await SQLite.openDatabaseAsync(DB_NAME);
    await opened.execAsync(SCHEMA);
    await migrate(opened);
    // Returned — and only then memoised by the caller. See below for why the
    // order matters.
    return opened;
  })();

  try {
    db = await opening;
    return db;
  } finally {
    opening = null;
  }
}

export type MistakeType =
  | 'conceptual'
  | 'calculation'
  | 'misread'
  | 'silly'
  | 'confused'
  | 'memory'
  | 'time_pressure';

export interface AttemptRow {
  id: string;
  paper_id: string;
  started_at: number;
  submitted_at: number | null;
  duration_s: number | null;
  score: number | null;
  max_score: number | null;
  correct: number | null;
  incorrect: number | null;
  unattempted: number | null;
  bonus_awarded: number;
  synced: number;
  accumulated_ms: number;
  active_since: number | null;
  paused_at: number | null;
}

export interface ResponseRow {
  attempt_id: string;
  question_id: string;
  chosen: string | null;
  marked: number;
  visited: number;
  time_ms: number;
  is_correct: number | null;
}

export async function createAttempt(paperId: string): Promise<string> {
  const d = await openLocalDb();
  const id = `att_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const now = Date.now();
  await d.runAsync(
    'INSERT INTO attempts (id, paper_id, started_at, accumulated_ms, active_since) VALUES (?, ?, ?, 0, ?)',
    id,
    paperId,
    now,
    now
  );
  return id;
}

/**
 * Every unsubmitted attempt, newest first, keyed by paper.
 *
 * WHY THIS EXISTS
 * ---------------
 * Practice needs "is there something to resume?" for each paper in its list,
 * and did it by calling findResumable() in a loop — one awaited round trip per
 * paper, run SEQUENTIALLY, before the screen was allowed to render anything.
 *
 * With seventeen papers that is seventeen serial queries standing between her
 * and the practice list. The visible result was not a slow list: it was an
 * EMPTY one, because the list is gated on the load finishing, so the Papers
 * tab showed nothing at all while it ran, and the Mocks tab lost every
 * section card — those are gated on the paper count, which was still zero.
 * "The PYQ papers aren't there and there are only two mock tests" was this,
 * not missing content.
 *
 * One query returns the lot.
 */
export async function listResumable(): Promise<Record<string, AttemptRow>> {
  const d = await openLocalDb();
  const rows = await d.getAllAsync<AttemptRow>(
    'SELECT * FROM attempts WHERE submitted_at IS NULL ORDER BY started_at DESC'
  );
  const out: Record<string, AttemptRow> = {};
  // Newest first, so the first row seen for a paper is the one to resume.
  for (const r of rows) if (!(r.paper_id in out)) out[r.paper_id] = r;
  return out;
}

/** Any attempt for this paper that was started but never submitted. */
export async function findResumable(paperId: string): Promise<AttemptRow | null> {
  const d = await openLocalDb();
  return d.getFirstAsync<AttemptRow>(
    'SELECT * FROM attempts WHERE paper_id = ? AND submitted_at IS NULL ORDER BY started_at DESC',
    paperId
  );
}

/**
 * Elapsed active time for an attempt, in milliseconds.
 *
 * Closed spans plus the open one, if any. Pure function of the row so the
 * caller can compute it without another query, and so it is trivially testable.
 */
export function elapsedMs(a: AttemptRow, now: number = Date.now()): number {
  const open = a.active_since ? Math.max(0, now - a.active_since) : 0;
  return (a.accumulated_ms ?? 0) + open;
}

export function isPaused(a: AttemptRow): boolean {
  return a.submitted_at === null && a.active_since === null;
}

/**
 * Close the open span and stop the clock.
 *
 * Idempotent: pausing an already-paused attempt is a no-op rather than an error
 * or a double-count. That matters because this is called both from the pause
 * button AND from the app going to the background, and those can race.
 */
export async function pauseAttempt(attemptId: string): Promise<void> {
  const d = await openLocalDb();
  const now = Date.now();
  await d.runAsync(
    `UPDATE attempts
        SET accumulated_ms = accumulated_ms + (? - active_since),
            active_since   = NULL,
            paused_at      = ?
      WHERE id = ? AND submitted_at IS NULL AND active_since IS NOT NULL`,
    now,
    now,
    attemptId
  );
}

/** Open a new span. Also idempotent — resuming a running attempt changes nothing. */
export async function resumeAttempt(attemptId: string): Promise<void> {
  const d = await openLocalDb();
  await d.runAsync(
    `UPDATE attempts SET active_since = ?, paused_at = NULL
      WHERE id = ? AND submitted_at IS NULL AND active_since IS NULL`,
    Date.now(),
    attemptId
  );
}

/**
 * Fold the open span into `accumulated_ms` without closing it.
 *
 * Called on a timer while the exam runs. A hard kill cannot write anything, so
 * without this the whole open span would be recovered from `active_since` —
 * which is right for a crash, but wrong if the OS killed the app hours after it
 * was backgrounded. Checkpointing bounds the damage to one interval.
 */
export async function checkpointAttempt(attemptId: string): Promise<void> {
  const d = await openLocalDb();
  const now = Date.now();
  await d.runAsync(
    `UPDATE attempts
        SET accumulated_ms = accumulated_ms + (? - active_since),
            active_since   = ?
      WHERE id = ? AND submitted_at IS NULL AND active_since IS NOT NULL`,
    now,
    now,
    attemptId
  );
}

/** Every paused attempt, most recently paused first — the Resume list. */
export async function listPausedAttempts(paperId?: string): Promise<AttemptRow[]> {
  const d = await openLocalDb();
  return paperId
    ? d.getAllAsync<AttemptRow>(
        `SELECT * FROM attempts WHERE submitted_at IS NULL AND paper_id = ?
          ORDER BY COALESCE(paused_at, started_at) DESC`,
        paperId
      )
    : d.getAllAsync<AttemptRow>(
        `SELECT * FROM attempts WHERE submitted_at IS NULL
          ORDER BY COALESCE(paused_at, started_at) DESC`
      );
}

export async function loadResponses(attemptId: string): Promise<ResponseRow[]> {
  const d = await openLocalDb();
  return d.getAllAsync<ResponseRow>('SELECT * FROM responses WHERE attempt_id = ?', attemptId);
}

/** Called on every interaction. Cheap upsert; keeps the attempt crash-safe. */
export async function saveResponse(
  attemptId: string,
  questionId: string,
  patch: { chosen?: string | null; marked?: boolean; visited?: boolean; addMs?: number }
): Promise<void> {
  const d = await openLocalDb();
  await d.runAsync(
    `INSERT INTO responses (attempt_id, question_id, chosen, marked, visited, time_ms)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(attempt_id, question_id) DO UPDATE SET
       chosen  = COALESCE(excluded.chosen, responses.chosen),
       marked  = CASE WHEN ? THEN excluded.marked ELSE responses.marked END,
       visited = MAX(responses.visited, excluded.visited),
       time_ms = responses.time_ms + excluded.time_ms`,
    attemptId,
    questionId,
    patch.chosen === undefined ? null : patch.chosen,
    patch.marked ? 1 : 0,
    patch.visited ? 1 : 0,
    patch.addMs ?? 0,
    patch.marked === undefined ? 0 : 1
  );
  // `chosen: null` means "clear response", which COALESCE would ignore.
  if (patch.chosen === null) {
    await d.runAsync(
      'UPDATE responses SET chosen = NULL WHERE attempt_id = ? AND question_id = ?',
      attemptId,
      questionId
    );
  }
}

export async function listAttempts(paperId?: string): Promise<AttemptRow[]> {
  const d = await openLocalDb();
  return paperId
    ? d.getAllAsync<AttemptRow>(
        'SELECT * FROM attempts WHERE paper_id = ? AND submitted_at IS NOT NULL ORDER BY submitted_at DESC',
        paperId
      )
    : d.getAllAsync<AttemptRow>(
        'SELECT * FROM attempts WHERE submitted_at IS NOT NULL ORDER BY submitted_at DESC'
      );
}

export async function getAttempt(attemptId: string): Promise<AttemptRow | null> {
  const d = await openLocalDb();
  return d.getFirstAsync<AttemptRow>('SELECT * FROM attempts WHERE id = ?', attemptId);
}

export async function setMistakeType(mistakeId: string, type: MistakeType): Promise<void> {
  const d = await openLocalDb();
  await d.runAsync('UPDATE mistakes SET mistake_type = ? WHERE id = ?', type, mistakeId);
}

export async function listMistakes(): Promise<any[]> {
  const d = await openLocalDb();
  return d.getAllAsync('SELECT * FROM mistakes WHERE resolved_at IS NULL ORDER BY created_at DESC');
}
