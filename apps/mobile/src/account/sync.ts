/**
 * Optional account, and progress backup/restore.
 *
 * WHAT SURVIVES WHAT, PRECISELY
 * -----------------------------
 *   app UPDATE      always. Android keeps app data across an update, and
 *                   plugins/withBackupRules.js declares that rather than
 *                   relying on the default. No account needed, nothing to do.
 *
 *   REINSTALL       usually, via Android Auto Backup, if she is signed into a
 *                   Google account and a backup ran. Not guaranteed — which is
 *                   why the account below exists.
 *
 *   NEW PHONE       with an account, always. Without one, only if Android's
 *                   device-transfer ran.
 *
 * The account is genuinely optional. Nothing in the study loop asks for it, and
 * a student who ignores it forever loses nothing she has today.
 *
 * WHY THE WHOLE HISTORY GOES IN ONE PUSH
 * --------------------------------------
 * This is one student on one phone. There is no concurrent editing to merge, so
 * the sync is a snapshot: push replaces, pull restores. The failure mode that
 * remains is pushing an EMPTY history from a fresh install over a real backup,
 * and the server refuses that with a 409 unless it is forced — the moment she
 * signs in on a new phone is exactly when the phone has nothing and the server
 * has everything.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

import { useProfile } from '@/store/profile';
import { openLocalDb } from '@/db/local';

const KEY = 'studymate.account.v1';

export interface AccountState {
  username: string | null;
  token: string | null;
  lastSyncAt: number | null;
  hydrated: boolean;
}

export interface BackupInfo {
  attempts: number;
  responses: number;
  mistakes: number;
  device: string | null;
  savedAt: string | null;
}

export class SyncError extends Error {}

/** Raised when a push would shrink the stored backup. Carries both sides. */
export class WouldLoseHistory extends SyncError {
  constructor(
    message: string,
    readonly stored: { attempts: number; device: string | null; savedAt: string | null },
    readonly incoming: { attempts: number }
  ) {
    super(message);
  }
}

function baseUrl(): string {
  return useProfile.getState().profile.apiBaseUrl?.replace(/\/+$/, '') ?? '';
}

async function call<T>(
  path: string,
  init: RequestInit & { auth?: boolean } = {}
): Promise<T> {
  const base = baseUrl();
  if (!base) throw new SyncError('No server address set. Add it in Settings first.');

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...((init.headers as Record<string, string>) ?? {}),
  };
  if (init.auth) {
    const token = useAccount.getState().token;
    if (!token) throw new SyncError('You are signed out.');
    headers.authorization = `Bearer ${token}`;
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 45000);
  try {
    const r = await fetch(`${base}${path}`, { ...init, headers, signal: ctrl.signal });
    const text = await r.text();
    const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    if (!r.ok) {
      const detail = (body.detail ?? body) as Record<string, unknown>;
      if (r.status === 409 && detail.stored) {
        throw new WouldLoseHistory(
          String(detail.error ?? 'this device has less history than your backup'),
          detail.stored as WouldLoseHistory['stored'],
          detail.incoming as WouldLoseHistory['incoming']
        );
      }
      throw new SyncError(String(detail.error ?? `Server returned ${r.status}`));
    }
    return body as T;
  } catch (e) {
    if (e instanceof SyncError) throw e;
    throw new SyncError('Could not reach the server.');
  } finally {
    clearTimeout(timer);
  }
}

interface AccountStore extends AccountState {
  set: (patch: Partial<AccountState>) => void;
  hydrate: () => Promise<void>;
  signUp: (username: string, password: string) => Promise<void>;
  signIn: (username: string, password: string) => Promise<void>;
  signOut: () => void;
  backUpNow: (force?: boolean) => Promise<BackupInfo>;
  restoreNow: () => Promise<BackupInfo>;
  peek: () => Promise<BackupInfo | null>;
}

export const useAccount = create<AccountStore>((set, get) => ({
  username: null,
  token: null,
  lastSyncAt: null,
  hydrated: false,

  set: (patch) => {
    const next = { ...get(), ...patch };
    set(patch);
    void AsyncStorage.setItem(
      KEY,
      JSON.stringify({
        username: next.username,
        token: next.token,
        lastSyncAt: next.lastSyncAt,
      })
    );
  },

  hydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(KEY);
      if (raw) set(JSON.parse(raw) as AccountState);
    } catch {
      /* a corrupt account blob must never block the app starting */
    } finally {
      set({ hydrated: true });
    }
  },

  signUp: async (username, password) => {
    const r = await call<{ username: string; token: string }>('/api/account/register', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    get().set({ username: r.username, token: r.token });
  },

  signIn: async (username, password) => {
    const r = await call<{ username: string; token: string }>('/api/account/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    get().set({ username: r.username, token: r.token });
  },

  /**
   * Sign out WITHOUT touching local data.
   *
   * Deliberate: signing out is not "delete my progress", and a study app that
   * wipes eight months of history because someone tapped the wrong button has
   * done something unforgivable. The local database is left exactly as it is.
   */
  signOut: () => {
    get().set({ username: null, token: null, lastSyncAt: null });
  },

  peek: async () => {
    if (!get().token) return null;
    const r = await call<{ hasBackup: boolean; backup: BackupInfo | null }>('/api/account/me', {
      auth: true,
    });
    return r.hasBackup ? r.backup : null;
  },

  backUpNow: async (force = false) => {
    const payload = await collectLocal();
    const r = await call<BackupInfo & { saved: boolean }>('/api/sync/push', {
      method: 'POST',
      auth: true,
      body: JSON.stringify({ payload, device: deviceLabel(), force }),
    });
    get().set({ lastSyncAt: Date.now() });
    return r;
  },

  restoreNow: async () => {
    const r = await call<{ hasBackup: boolean; payload: LocalSnapshot | null } & BackupInfo>(
      '/api/sync/pull',
      { auth: true }
    );
    if (!r.hasBackup || !r.payload) throw new SyncError('There is no backup on this account yet.');
    await applyLocal(r.payload);
    get().set({ lastSyncAt: Date.now() });
    return r;
  },
}));

function deviceLabel(): string {
  // Kept vague on purpose. It exists so a second device can be named in a
  // warning, not to identify a person.
  return 'this phone';
}

// ---------------------------------------------------------------------------
// Reading and writing the local database
// ---------------------------------------------------------------------------

interface LocalSnapshot {
  version: number;
  attempts: Record<string, unknown>[];
  responses: Record<string, unknown>[];
  mistakes: Record<string, unknown>[];
}

/**
 * `SELECT *` on purpose.
 *
 * Naming columns would mean this file needs editing every time the local schema
 * gains one — and the failure mode of forgetting is silent: the backup succeeds
 * and quietly drops a column. `accumulated_ms` and `active_since` were added
 * for pause/resume after this shape was first imagined, and they round-trip
 * with no change here.
 */
async function collectLocal(): Promise<LocalSnapshot> {
  const db = await openLocalDb();
  const [attempts, responses, mistakes] = await Promise.all([
    db.getAllAsync<Record<string, unknown>>('SELECT * FROM attempts'),
    db.getAllAsync<Record<string, unknown>>('SELECT * FROM responses'),
    db.getAllAsync<Record<string, unknown>>('SELECT * FROM mistakes'),
  ]);
  return { version: 1, attempts, responses, mistakes };
}

/**
 * Replace local history with a restored snapshot, inside one transaction.
 *
 * All-or-nothing matters here: a restore that fails halfway would leave her with
 * neither the old history nor the new one. Unknown columns from a NEWER app
 * version are dropped rather than causing the insert to fail, so restoring onto
 * an older build degrades instead of breaking.
 */
async function applyLocal(snap: LocalSnapshot): Promise<void> {
  const db = await openLocalDb();

  const columnsOf = async (table: string): Promise<Set<string>> => {
    const cols = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
    return new Set(cols.map((c) => c.name));
  };

  const [attemptCols, responseCols, mistakeCols] = await Promise.all([
    columnsOf('attempts'),
    columnsOf('responses'),
    columnsOf('mistakes'),
  ]);

  const insert = async (table: string, rows: Record<string, unknown>[], known: Set<string>) => {
    for (const row of rows) {
      const keys = Object.keys(row).filter((k) => known.has(k));
      if (!keys.length) continue;
      const placeholders = keys.map(() => '?').join(',');
      await db.runAsync(
        `INSERT OR REPLACE INTO ${table} (${keys.join(',')}) VALUES (${placeholders})`,
        ...keys.map((k) => row[k] as string | number | null)
      );
    }
  };

  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM responses');
    await db.runAsync('DELETE FROM mistakes');
    await db.runAsync('DELETE FROM attempts');
    await insert('attempts', snap.attempts ?? [], attemptCols);
    await insert('responses', snap.responses ?? [], responseCols);
    await insert('mistakes', snap.mistakes ?? [], mistakeCols);
  });
}

/** Row counts, for showing what is actually at stake before a restore. */
export async function localCounts(): Promise<{ attempts: number; mistakes: number }> {
  const db = await openLocalDb();
  const a = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM attempts');
  const m = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM mistakes');
  return { attempts: a?.n ?? 0, mistakes: m?.n ?? 0 };
}
