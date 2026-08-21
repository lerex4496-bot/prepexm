/**
 * The student's own PDFs, held on the phone.
 *
 * THE BUG THIS FIXES
 * ------------------
 * Attaching a PDF POSTed it to the StudyMate API. With no server configured —
 * which is the normal state of the shared APK, and the reason direct mode
 * exists at all — the button answered "no API address configured". She had
 * asked to add her NEET syllabus and got a sentence about our infrastructure.
 *
 * So the whole path now runs on device: read the file, pull out its text
 * layer, chunk it, keep it in the app's own storage, and retrieve from it when
 * she asks a question. Nothing leaves the phone except the few extracts that
 * go into the prompt.
 *
 * WHAT IS STORED WHERE
 * --------------------
 * The INDEX (titles, page counts, sizes) is small and lives in AsyncStorage,
 * so listing documents costs one read. The TEXT is not small — a sixty-page
 * paper is ~160 KB — and lives in one file per document under the app's
 * document directory, loaded only when something actually searches it.
 * Putting the text in AsyncStorage would push a single SQLite row past the
 * size where Android starts refusing writes.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';

import { MAX_PDF_BYTES, PdfTooLarge, extractPdfText, tidy } from './pdfText';
import { base64ToBytes } from './base64';
import { chunkPages, rankChunks, type Chunk } from './search';

const INDEX_KEY = 'studymate.docs.v1';
const DIR = `${FileSystem.documentDirectory ?? ''}studymate-docs/`;

/** Keeps her library — and the app's storage footprint — to something sane. */
const MAX_DOCS = 20;

export interface LocalDoc {
  id: string;
  title: string;
  filename: string;
  pages: number;
  chars: number;
  /** Share of pages with a readable text layer. Low means it is a scan. */
  extractability: number;
  chunks: number;
  uploadedAt: number;
}

/** A retrieved passage, with enough provenance to cite it. */
export interface DocHit {
  docId: string;
  title: string;
  page: number;
  text: string;
}

/**
 * The PDF has no text layer worth reading — it is a photograph of a page.
 *
 * Its message is written for her, not for us: the useful thing to say is not
 * "extraction failed", it is that photographing the page DOES work, because
 * that path runs OCR.
 */
export class NoTextLayer extends Error {}

// ---------------------------------------------------------------------------
// Index
// ---------------------------------------------------------------------------

export async function listLocalDocs(): Promise<LocalDoc[]> {
  try {
    const raw = await AsyncStorage.getItem(INDEX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as LocalDoc[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeIndex(docs: LocalDoc[]): Promise<void> {
  await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(docs));
}

export async function deleteLocalDoc(id: string): Promise<void> {
  const docs = await listLocalDocs();
  await writeIndex(docs.filter((d) => d.id !== id));
  await FileSystem.deleteAsync(`${DIR}${id}.json`, { idempotent: true }).catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Adding a document
// ---------------------------------------------------------------------------

/**
 * Read a PDF, extract its text, and keep it for later questions.
 *
 * Throws `NoTextLayer` for a scan and `PdfTooLarge` for something the phone
 * should not try to hold in memory. Both carry wording meant for her.
 */
export async function addLocalDoc(
  uri: string,
  filename: string,
  title?: string,
  onProgress?: (done: number, total: number) => void
): Promise<LocalDoc> {
  const bytes = await readFileBytes(uri);
  if (bytes.length > MAX_PDF_BYTES) {
    throw new PdfTooLarge(
      `This PDF is ${(bytes.length / 1024 / 1024).toFixed(1)} MB, which is more than the phone can read at once. Try adding one chapter at a time.`
    );
  }

  const extracted = await extractPdfText(bytes, onProgress);

  // The threshold is low deliberately. A paper whose questions are images but
  // whose instructions are text still has something worth searching, and half
  // a document beats refusing it. Below this it really is a scan.
  if (extracted.extractability < 0.25) {
    throw new NoTextLayer(
      extracted.pageCount === 0
        ? 'That file could not be opened as a PDF.'
        : 'This PDF is a scan — the pages are pictures, so there is no text in it to search. Photograph the page with the camera button instead; that reads the words off the image.'
    );
  }

  const pages = extracted.pages.map(tidy);
  const chunks = chunkPages(pages);
  const id = `d${Date.now().toString(36)}`;

  await FileSystem.makeDirectoryAsync(DIR, { intermediates: true }).catch(() => undefined);
  await FileSystem.writeAsStringAsync(`${DIR}${id}.json`, JSON.stringify(chunks));

  const doc: LocalDoc = {
    id,
    title: (title || filename.replace(/\.pdf$/i, '')).slice(0, 80),
    filename,
    pages: extracted.pageCount,
    chars: pages.reduce((n, p) => n + p.length, 0),
    extractability: extracted.extractability,
    chunks: chunks.length,
    uploadedAt: Date.now(),
  };

  const existing = await listLocalDocs();
  const kept = [doc, ...existing].slice(0, MAX_DOCS);
  // Anything pushed off the end loses its text file too, or the directory
  // grows forever with documents nothing can reach.
  for (const dropped of existing.filter((d) => !kept.some((k) => k.id === d.id))) {
    await FileSystem.deleteAsync(`${DIR}${dropped.id}.json`, { idempotent: true }).catch(
      () => undefined
    );
  }
  await writeIndex(kept);
  return doc;
}

/**
 * Read a file into bytes. Base64 is the only binary encoding the file system
 * module offers; see src/docs/base64.ts for why the decode is hand-rolled.
 */
async function readFileBytes(uri: string): Promise<Uint8Array> {
  const b64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return base64ToBytes(b64);
}

// ---------------------------------------------------------------------------
// Retrieval
// ---------------------------------------------------------------------------

/** Loaded chunk lists, keyed by document id. Cleared when a doc is removed. */
const cache = new Map<string, Chunk[]>();

async function chunksFor(id: string): Promise<Chunk[]> {
  const hit = cache.get(id);
  if (hit) return hit;
  try {
    const raw = await FileSystem.readAsStringAsync(`${DIR}${id}.json`);
    const parsed = JSON.parse(raw) as Chunk[];
    const chunks = Array.isArray(parsed) ? parsed : [];
    cache.set(id, chunks);
    return chunks;
  } catch {
    return [];
  }
}

/**
 * The passages from her documents most likely to answer this question.
 *
 * Searches every document rather than asking her to pick one: she attached
 * four chapters, and being made to choose the right one before asking is the
 * job retrieval is supposed to do.
 */
export async function searchLocalDocs(query: string, k = 4): Promise<DocHit[]> {
  const docs = await listLocalDocs();
  if (!docs.length) return [];

  const all: (Chunk & { docId: string; title: string })[] = [];
  for (const doc of docs) {
    for (const chunk of await chunksFor(doc.id)) {
      all.push({ ...chunk, docId: doc.id, title: doc.title });
    }
  }

  return rankChunks(query, all, k).map((s) => ({
    docId: s.item.docId,
    title: s.item.title,
    page: s.item.page,
    text: s.item.text,
  }));
}

/** Forget cached text — used after a delete so storage and memory agree. */
export function clearDocCache(): void {
  cache.clear();
}
