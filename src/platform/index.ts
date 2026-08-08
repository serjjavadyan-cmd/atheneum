import type { Database } from '../types';

/**
 * The only surface the UI is allowed to touch for persistence.
 *
 * Two implementations exist:
 *  - `electronPlatform`  — real files on disk, via the preload bridge. What ships.
 *  - `browserPlatform`   — localStorage + IndexedDB. Lets the entire UI be built and
 *                          verified in a plain browser tab, with no Electron in the loop.
 *
 * Anything that can only work in Electron (choosing a folder, syncing) degrades to a
 * clearly-reported no-op in the browser rather than throwing.
 */
export interface SyncStatus {
  available: boolean;
  dir: string | null;
  detected: string | null;
  lastSync: string | null;
  lastError: string | null;
  devices: string[];
}

export interface SavedImage {
  hash: string;
  file: string;
}

export interface Platform {
  readonly kind: 'electron' | 'browser';
  loadDb(): Promise<Database | null>;
  saveDb(db: Database): Promise<void>;
  /** Persist raw image bytes content-addressed. Returns the hash and relative path. */
  saveImage(bytes: ArrayBuffer, ext: string): Promise<SavedImage>;
  /** A URL the renderer can put in an <img src>. */
  imageUrl(file: string): string;
  /** Ask the OS for a folder. Returns null in the browser or if cancelled. */
  chooseFolder(): Promise<string | null>;
  /** @param configured the user's `settings.syncDir`: '' to auto-detect, 'off', or a path. */
  syncStatus(configured: string): Promise<SyncStatus>;
  /** Run a merge now. Returns the merged database. */
  syncNow(db: Database): Promise<{ db: Database; status: SyncStatus }>;
  /** Where the data lives, for display in Settings. */
  dataDir(): Promise<string>;
}

/* ------------------------------------------------------------------ *
 * Electron bridge (see electron/preload.cjs)
 * ------------------------------------------------------------------ */

interface AtheneumBridge {
  loadDb(): Promise<Database | null>;
  saveDb(db: Database): Promise<void>;
  saveImage(bytes: ArrayBuffer, ext: string): Promise<SavedImage>;
  chooseFolder(): Promise<string | null>;
  syncStatus(configured: string): Promise<SyncStatus>;
  syncNow(db: Database): Promise<{ db: Database; status: SyncStatus }>;
  dataDir(): Promise<string>;
}

declare global {
  interface Window {
    atheneum?: AtheneumBridge;
  }
}

function makeElectronPlatform(bridge: AtheneumBridge): Platform {
  return {
    kind: 'electron',
    loadDb: () => bridge.loadDb(),
    saveDb: (db) => bridge.saveDb(db),
    saveImage: (bytes, ext) => bridge.saveImage(bytes, ext),
    imageUrl: (file) => `atheneum://images/${file}`,
    chooseFolder: () => bridge.chooseFolder(),
    syncStatus: (configured) => bridge.syncStatus(configured),
    syncNow: (db) => bridge.syncNow(db),
    dataDir: () => bridge.dataDir(),
  };
}

/* ------------------------------------------------------------------ *
 * Browser fallback — development and visual verification only
 * ------------------------------------------------------------------ */

const DB_KEY = 'atheneum.db';
const IDB_NAME = 'atheneum-images';
const IDB_STORE = 'images';

function openImageDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(IDB_STORE)) {
        req.result.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const objectUrlCache = new Map<string, string>();

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

const browserPlatform: Platform = {
  kind: 'browser',

  async loadDb() {
    const raw = localStorage.getItem(DB_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as Database;
    } catch {
      // Mirror the Electron store's behaviour: preserve, never destroy.
      localStorage.setItem(`${DB_KEY}.corrupt.${Date.now()}`, raw);
      console.error('Local database was unreadable — preserved under a .corrupt key.');
      return null;
    }
  },

  async saveDb(db) {
    localStorage.setItem(DB_KEY, JSON.stringify(db));
  },

  async saveImage(bytes, ext) {
    const hash = await sha256Hex(bytes);
    const file = `${hash.slice(0, 2)}/${hash}.${ext}`;
    const idb = await openImageDb();
    await new Promise<void>((resolve, reject) => {
      const tx = idb.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(bytes, file);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    return { hash, file };
  },

  imageUrl(file) {
    const cached = objectUrlCache.get(file);
    if (cached) return cached;
    // Placeholder returned synchronously; resolved into the cache on the next tick.
    const blank = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
    objectUrlCache.set(file, blank);
    void (async () => {
      try {
        const idb = await openImageDb();
        const bytes = await new Promise<ArrayBuffer | undefined>((resolve, reject) => {
          const tx = idb.transaction(IDB_STORE, 'readonly');
          const req = tx.objectStore(IDB_STORE).get(file);
          req.onsuccess = () => resolve(req.result as ArrayBuffer | undefined);
          req.onerror = () => reject(req.error);
        });
        if (!bytes) return;
        const url = URL.createObjectURL(new Blob([bytes]));
        objectUrlCache.set(file, url);
        // Nudge any <img> already pointing at the placeholder.
        window.dispatchEvent(new CustomEvent('atheneum:image-ready', { detail: file }));
      } catch (e) {
        console.warn('image load failed', file, e);
      }
    })();
    return blank;
  },

  async chooseFolder() {
    return null;
  },

  async syncStatus() {
    return {
      available: false,
      dir: null,
      detected: null,
      lastSync: null,
      lastError: 'Sync needs the desktop app.',
      devices: [],
    };
  },

  async syncNow(db) {
    return { db, status: await browserPlatform.syncStatus('') };
  },

  async dataDir() {
    return 'browser storage (development)';
  },
};

export const platform: Platform = window.atheneum
  ? makeElectronPlatform(window.atheneum)
  : browserPlatform;
