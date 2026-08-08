'use strict';
/**
 * Proves the production build actually works inside Electron.
 *
 * The browser preview can't test any of this: it uses IndexedDB for images, not the custom
 * `atheneum://` protocol, and it never loads the built `dist/index.html` under its real CSP.
 * This starts the actual app, in a hidden window, and checks the things that can only break
 * there — most importantly whether a stored cover renders.
 *
 *   npx electron scripts/smoke-electron.cjs
 */
const { app, BrowserWindow, ipcMain, protocol } = require('electron');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { SCHEME, saveImage, registerImageProtocol, resolveImageRequest } =
  require('../electron/images.cjs');

protocol.registerSchemesAsPrivileged([SCHEME]);

// A 2×2 red PNG.
const RED_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGP8z4AATAxQxhAVAgCRhAI' +
  'RQTaOWwAAAABJRU5ErkJggg==',
  'base64',
);

let passed = 0;
let failed = 0;

function check(name, ok, detail) {
  if (ok) {
    passed++;
    console.log(`  ok   ${name}`);
  } else {
    failed++;
    console.error(`  FAIL ${name}${detail ? `\n       ${detail}` : ''}`);
  }
}

async function main() {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'atheneum-smoke-'));
  const imagesDir = path.join(tmp, 'images');
  await fsp.mkdir(imagesDir, { recursive: true });

  console.log('\nimage paths — resolved without Electron');

  const stored = await saveImage(imagesDir, RED_PNG, 'png');
  check('an image is stored under its content hash', /^[0-9a-f]{2}\/[0-9a-f]{64}\.png$/.test(stored.file), stored.file);

  const good = resolveImageRequest(imagesDir, `atheneum://images/${stored.file}`);
  check('a normal request resolves', good.ok && good.type === 'image/png');

  // The property that actually matters is containment, not a particular status code.
  // URL parsing normalises `..` and `%2e%2e` away before we ever see the path, so these come
  // back as ordinary in-root lookups that then 404 — which is just as safe as a 403.
  const root = path.resolve(imagesDir);
  for (const nasty of [
    'atheneum://images/../../db.json',
    'atheneum://images/..%2f..%2fdb.json',
    'atheneum://images/%2e%2e/%2e%2e/secrets.txt',
    'atheneum://images/....//....//db.json',
  ]) {
    const r = resolveImageRequest(imagesDir, nasty);
    const contained = !r.ok || r.path === root || r.path.startsWith(root + path.sep);
    check(
      `never escapes the images folder — ${nasty.slice(19)}`,
      contained,
      JSON.stringify(r),
    );
  }

  const wrongHost = resolveImageRequest(imagesDir, 'atheneum://secrets/db.json');
  check('an unknown host is refused', !wrongHost.ok && wrongHost.status === 404);

  console.log('\nthe real window — production bundle, real CSP, real protocol');

  registerImageProtocol(protocol, imagesDir);

  // main.cjs owns the app lifecycle at module scope, so it can't be imported here. These
  // stand-ins exist only so the renderer can finish booting; the real handlers are exercised
  // whenever the app itself runs. What this test is actually for is the window, the CSP and
  // the image protocol.
  let storedDb = null;
  ipcMain.handle('db:load', () => storedDb);
  ipcMain.handle('db:save', (_e, db) => { storedDb = db; });
  ipcMain.handle('image:save', (_e, bytes, ext) => saveImage(imagesDir, bytes, ext));
  ipcMain.handle('app:dataDir', () => tmp);
  ipcMain.handle('app:chooseFolder', () => null);
  ipcMain.handle('sync:status', () => ({
    available: false, dir: null, detected: null, lastSync: null, lastError: null, devices: [],
  }));
  ipcMain.handle('sync:now', () => { throw new Error('not in the smoke test'); });

  const win = new BrowserWindow({
    show: false,
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, '..', 'electron', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const consoleErrors = [];
  win.webContents.on('console-message', (_e, level, message) => {
    // level 3 is "error"
    if (level >= 3) consoleErrors.push(message);
  });

  const indexHtml = path.join(__dirname, '..', 'dist', 'index.html');
  try {
    await win.loadFile(indexHtml);
  } catch (err) {
    check('the built app loads', false, err.message);
    finish(tmp);
    return;
  }
  check('the built app loads', true);

  // Give React a moment to mount.
  await new Promise((r) => setTimeout(r, 1500));

  const mounted = await win.webContents.executeJavaScript(`
    ({
      hasApp: !!document.querySelector('.app'),
      hasSidebar: !!document.querySelector('.sidebar'),
      categories: document.querySelectorAll('.nav-item').length,
      bridge: typeof window.atheneum === 'object',
      title: document.title,
    })
  `);
  check('the interface mounts', mounted.hasApp && mounted.hasSidebar, JSON.stringify(mounted));
  check('the preload bridge is present', mounted.bridge);
  check('categories render in the sidebar', mounted.categories >= 7, `found ${mounted.categories}`);

  // The question the browser preview could never answer.
  const imageResult = await win.webContents.executeJavaScript(`
    new Promise((resolve) => {
      const img = new Image();
      const timer = setTimeout(() => resolve({ ok: false, why: 'timed out' }), 4000);
      img.onload = () => { clearTimeout(timer); resolve({ ok: true, w: img.naturalWidth, h: img.naturalHeight }); };
      img.onerror = () => { clearTimeout(timer); resolve({ ok: false, why: 'onerror — blocked or not found' }); };
      img.src = 'atheneum://images/${stored.file}';
    })
  `);
  check(
    'a stored cover renders in the renderer under the app CSP',
    imageResult.ok && imageResult.w === 2,
    JSON.stringify(imageResult),
  );

  const fetched = await win.webContents.executeJavaScript(`
    fetch('atheneum://images/${stored.file}')
      .then(r => ({ status: r.status, type: r.headers.get('content-type') }))
      .catch(e => ({ error: String(e) }))
  `);
  check('fetch() over the protocol works', fetched.status === 200 && fetched.type === 'image/png', JSON.stringify(fetched));

  const missing = await win.webContents.executeJavaScript(`
    fetch('atheneum://images/ab/does-not-exist.png')
      .then(r => r.status).catch(e => String(e))
  `);
  check('a missing image 404s rather than hanging', missing === 404, String(missing));

  check('no console errors while loading', consoleErrors.length === 0, consoleErrors.join(' | '));

  finish(tmp);
}

async function finish(tmp) {
  await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
  console.log(`\n${passed} passed, ${failed} failed\n`);
  app.exit(failed ? 1 : 0);
}

app.whenReady().then(() =>
  main().catch((err) => {
    console.error('smoke test crashed:', err);
    app.exit(1);
  }),
);

app.on('window-all-closed', () => {});
