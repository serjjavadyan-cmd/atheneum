'use strict';
/**
 * Atheneum — Electron main process.
 *
 * Plain CommonJS on purpose: the renderer goes through Vite, but the main process is small
 * enough that adding a second build step for it would cost more than it saves.
 *
 * Responsibilities: the window, the data directory, and the `atheneum://` protocol that serves
 * stored cover images to the renderer.
 */
const { app, BrowserWindow, dialog, ipcMain, protocol, shell } = require('electron');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { locateSyncDir, describeCandidates } = require('./sync/locate.cjs');
const { runSync } = require('./sync/run.cjs');
const { SCHEME, saveImage, registerImageProtocol } = require('./images.cjs');

const DEV_URL = 'http://localhost:5273';
const isDev = !app.isPackaged;

/** Reported back to Settings so the last result is visible without re-running a sync. */
let lastSync = { at: null, error: null, devices: [] };

/* ------------------------------------------------------------------ *
 * Paths
 * ------------------------------------------------------------------ */

const dataDir = () => path.join(app.getPath('userData'), 'library');
const dbFile = () => path.join(dataDir(), 'db.json');
const imagesDir = () => path.join(dataDir(), 'images');

async function ensureDirs() {
  await fsp.mkdir(imagesDir(), { recursive: true });
}

/* ------------------------------------------------------------------ *
 * Store — atomic writes, and a corrupt file is preserved, never destroyed.
 * Both behaviours carried over from Constellation's lib/store.js.
 * ------------------------------------------------------------------ */

async function loadDb() {
  try {
    const raw = await fsp.readFile(dbFile(), 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    // Unreadable but present: keep it aside so nothing is ever lost to a parse error.
    const kept = `${dbFile()}.corrupt-${Date.now()}`;
    try {
      await fsp.copyFile(dbFile(), kept);
      console.error(`db.json was unreadable — preserved at ${kept}`);
    } catch (copyErr) {
      console.error('db.json was unreadable and could not be preserved:', copyErr);
    }
    return null;
  }
}

/**
 * Writes are queued and each uses its own temp file.
 *
 * Both matter: a fixed `db.json.tmp` shared by two overlapping saves means the first rename
 * consumes the file and the second fails with ENOENT, and unordered writes could land an older
 * snapshot on top of a newer one.
 */
let writeQueue = Promise.resolve();

function saveDb(db) {
  const run = writeQueue.then(() => writeDbNow(db), () => writeDbNow(db));
  // The chain must survive a failed write, or one error wedges every save after it.
  writeQueue = run.catch(() => {});
  return run;
}

async function writeDbNow(db) {
  await ensureDirs();
  const tmp = `${dbFile()}.${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}.tmp`;
  try {
    await fsp.writeFile(tmp, JSON.stringify(db, null, 2), 'utf8');
    await fsp.rename(tmp, dbFile());
  } catch (err) {
    await fsp.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

/** Sweep temp files orphaned by a crash or a forced quit. */
async function cleanStaleTemps() {
  try {
    for (const name of await fsp.readdir(dataDir())) {
      if (name.startsWith('db.json.') && name.endsWith('.tmp')) {
        await fsp.rm(path.join(dataDir(), name), { force: true }).catch(() => {});
      }
    }
  } catch { /* nothing to sweep */ }
}

/* ------------------------------------------------------------------ *
 * IPC
 * ------------------------------------------------------------------ */

function registerIpc() {
  ipcMain.handle('db:load', () => loadDb());
  ipcMain.handle('db:save', (_e, db) => saveDb(db));
  ipcMain.handle('image:save', async (_e, bytes, ext) => {
    await ensureDirs();
    return saveImage(imagesDir(), bytes, ext);
  });
  ipcMain.handle('app:dataDir', () => dataDir());

  ipcMain.handle('app:chooseFolder', async () => {
    const win = BrowserWindow.getFocusedWindow();
    const result = await dialog.showOpenDialog(win, {
      title: 'Choose the folder both computers sync through',
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('sync:status', async (_e, configured) => {
    const dir = await locateSyncDir(configured);
    return {
      available: Boolean(dir),
      dir,
      detected: dir,
      lastSync: lastSync.at,
      lastError: dir
        ? lastSync.error
        : `No synced cloud folder found. Looked for: ${describeCandidates().join(', ')}.`,
      devices: lastSync.devices,
    };
  });

  ipcMain.handle('sync:now', async (_e, db) => {
    const dir = await locateSyncDir(db?.settings?.syncDir ?? '');
    if (!dir) {
      throw new Error(
        `No synced cloud folder found. Choose one in Settings — looked for: ${describeCandidates().join(', ')}.`,
      );
    }

    const result = await runSync(dir, db, imagesDir());
    // Persist immediately: if the app dies right now, the merge must not be lost.
    await saveDb(result.db);

    lastSync = {
      at: new Date().toISOString(),
      error: result.problems.length ? result.problems.join('; ') : null,
      devices: result.devices,
    };

    return {
      db: result.db,
      status: {
        available: true,
        dir,
        detected: dir,
        lastSync: lastSync.at,
        lastError: lastSync.error,
        devices: result.devices,
      },
      added: result.added,
      images: result.images,
    };
  });
}

/* ------------------------------------------------------------------ *
 * Window
 * ------------------------------------------------------------------ */

function createWindow() {
  const win = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#0b0b0e',
    // macOS gets the inset traffic lights over our own titlebar strip; Windows keeps its
    // native frame, and the renderer hides its strip when it sees a Windows platform.
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.once('ready-to-show', () => win.show());

  // Links to the outside world open in the real browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  if (isDev) {
    void win.loadURL(DEV_URL);
  } else {
    void win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  return win;
}

/* ------------------------------------------------------------------ *
 * atheneum:// — serves stored images to the renderer
 * ------------------------------------------------------------------ */

// Must happen before the app is ready, so it sits at module scope.
protocol.registerSchemesAsPrivileged([SCHEME]);

const registerProtocol = () => registerImageProtocol(protocol, imagesDir());

/* ------------------------------------------------------------------ *
 * Lifecycle
 * ------------------------------------------------------------------ */

if (!app.requestSingleInstanceLock()) {
  // A second copy writing the same db.json would be a good way to lose data.
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(async () => {
    await ensureDirs();
    await cleanStaleTemps();
    registerProtocol();
    registerIpc();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
