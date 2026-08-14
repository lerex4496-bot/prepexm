/**
 * Save her progress to a file she keeps, and restore it back.
 *
 * WHY A FILE AND NOT (ONLY) AN ACCOUNT
 * ------------------------------------
 * Everything she has done lives in one SQLite file on one phone. An app update
 * keeps it; an uninstall or a lost phone does not. The account sync in sync.ts
 * fixes that properly — but it needs a server her phone can reach, and today
 * that server runs on a laptop on one wifi network. A file needs nothing: she
 * taps save, picks Drive or WhatsApp, and the copy exists.
 *
 * Three weeks before an exam, "works tonight with no infrastructure" beats
 * "works everywhere next week".
 *
 * WHY NO NEW DEPENDENCY
 * ---------------------
 * `expo-sharing` is the obvious way to hand a file to Drive, and adding it
 * would require `expo prebuild`, which DELETES the android/ directory — taking
 * local.properties, the release signing config and the updates.ENABLED=false
 * fix with it. That directory has already cost this project a lost keystore
 * once. Android's Storage Access Framework ships inside expo-file-system, needs
 * no native rebuild, and has the better behaviour anyway: she chooses where the
 * file goes, rather than us guessing.
 *
 * THE RESTORE IS THE DANGEROUS HALF
 * ---------------------------------
 * Restoring REPLACES local history — that is what makes it a restore rather
 * than a merge, and it is the right model for one student on one phone. But it
 * means a stale backup can wipe real work. So a restore that would reduce her
 * attempt count refuses until it is explicitly confirmed, and the caller is
 * told exactly what it is about to cost.
 */

import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';

import { applyLocal, collectLocal, localCounts, type LocalSnapshot } from './sync';

/** What a backup file contains beyond the rows themselves. */
export interface BackupEnvelope extends LocalSnapshot {
  /** Format version of the FILE, separate from the snapshot's own version. */
  backupVersion: number;
  /** ISO timestamp, so she can tell two backups apart in a folder. */
  savedAt: string;
  app: string;
  counts: { attempts: number; mistakes: number };
}

export const BACKUP_VERSION = 1;

export class BackupError extends Error {}

/**
 * Refusing to restore because it would cost her work.
 *
 * Carries both sides so the screen can say "this file has 3 attempts, your
 * phone has 27" instead of a generic warning she will click through.
 */
export class WouldLoseProgress extends BackupError {
  constructor(
    readonly onPhone: { attempts: number; mistakes: number },
    readonly inFile: { attempts: number; mistakes: number }
  ) {
    super('Restoring this file would remove progress that is on the phone.');
  }
}

function fileName(): string {
  // Date only: a second backup on the same day should replace the first rather
  // than leaving her to guess which of five files is current.
  return `studymate-backup-${new Date().toISOString().slice(0, 10)}.json`;
}

async function envelope(): Promise<string> {
  const snap = await collectLocal();
  const counts = await localCounts();
  const payload: BackupEnvelope = {
    ...snap,
    backupVersion: BACKUP_VERSION,
    savedAt: new Date().toISOString(),
    app: 'StudyMate',
    counts,
  };
  return JSON.stringify(payload);
}

/**
 * Write a backup wherever she chooses.
 *
 * Returns the counts saved so the screen can confirm what actually went in —
 * "saved 27 attempts" is reassurance; "saved" alone is not.
 */
export async function saveBackup(): Promise<{ attempts: number; mistakes: number; name: string }> {
  const counts = await localCounts();
  if (counts.attempts === 0 && counts.mistakes === 0) {
    throw new BackupError('There is nothing to back up yet — sit a paper first.');
  }

  const body = await envelope();
  const name = fileName();

  if (Platform.OS === 'android') {
    const perm = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
    if (!perm.granted) {
      throw new BackupError('No folder was chosen, so nothing was saved.');
    }
    const uri = await FileSystem.StorageAccessFramework.createFileAsync(
      perm.directoryUri,
      name,
      'application/json'
    );
    await FileSystem.writeAsStringAsync(uri, body);
    return { ...counts, name };
  }

  // Anywhere else: the app's own documents folder. Not reachable from a file
  // manager on iOS, but this app ships on Android.
  const uri = `${FileSystem.documentDirectory}${name}`;
  await FileSystem.writeAsStringAsync(uri, body);
  return { ...counts, name };
}

/** Read and validate a backup file without applying it. */
export async function readBackup(): Promise<BackupEnvelope | null> {
  const picked = await DocumentPicker.getDocumentAsync({
    type: 'application/json',
    copyToCacheDirectory: true,
  });
  if (picked.canceled || !picked.assets?.[0]?.uri) return null;

  let raw: string;
  try {
    raw = await FileSystem.readAsStringAsync(picked.assets[0].uri);
  } catch {
    throw new BackupError('That file could not be read.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new BackupError('That file is not a StudyMate backup.');
  }

  const env = parsed as Partial<BackupEnvelope>;
  // Validated before anything is deleted. A restore is destructive, so a file
  // that is merely JSON-shaped must not get as far as the transaction.
  if (
    typeof env !== 'object' ||
    env === null ||
    env.app !== 'StudyMate' ||
    !Array.isArray(env.attempts) ||
    !Array.isArray(env.responses) ||
    !Array.isArray(env.mistakes)
  ) {
    throw new BackupError('That file is not a StudyMate backup.');
  }
  if ((env.backupVersion ?? 0) > BACKUP_VERSION) {
    throw new BackupError(
      'That backup was made by a newer version of the app. Update StudyMate first.'
    );
  }
  return env as BackupEnvelope;
}

/**
 * Apply a backup, refusing by default if it would shrink her history.
 *
 * `force` exists for the case where she genuinely wants an older state back —
 * but it has to be asked for, after being told the cost.
 */
export async function restoreBackup(
  env: BackupEnvelope,
  force = false
): Promise<{ attempts: number; mistakes: number }> {
  const onPhone = await localCounts();
  const inFile = {
    attempts: env.attempts.length,
    mistakes: env.mistakes.length,
  };

  if (!force && (inFile.attempts < onPhone.attempts || inFile.mistakes < onPhone.mistakes)) {
    throw new WouldLoseProgress(onPhone, inFile);
  }

  await applyLocal({
    version: env.version ?? 1,
    attempts: env.attempts,
    responses: env.responses,
    mistakes: env.mistakes,
  });
  return inFile;
}
