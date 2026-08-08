'use strict';
/**
 * Opening an older library must never lose anything, and must not strand a feature that
 * didn't exist when the file was written.
 *
 * `normalise()` lives in the renderer, so it's bundled with esbuild and given the handful of
 * browser globals the module graph touches at import time. Run with:
 *
 *   node scripts/test-migrate.cjs
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');

/* The store pulls in the platform module, which inspects the browser at import. */
globalThis.window = { atheneum: undefined, addEventListener() {}, removeEventListener() {}, dispatchEvent() {} };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.indexedDB = { open: () => ({}) };
// `navigator` already exists in Node 18+ and is read-only, so it is deliberately left alone.

const built = esbuild.buildSync({
  entryPoints: [path.join(__dirname, '..', 'src', 'store.ts')],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  write: false,
  logLevel: 'silent',
  external: ['zustand', 'react'],
});

const module_ = { exports: {} };
// eslint-disable-next-line no-new-func
new Function('module', 'exports', 'require', built.outputFiles[0].text)(
  module_, module_.exports, require,
);
const { normalise } = module_.exports;

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL ${name}\n       ${err.message}`);
  }
}

/** A library as version 1 wrote them: no who, no subItems, no anime, lookup off. */
const v1Library = () => ({
  schemaVersion: 1,
  deviceId: 'old-device',
  deviceName: 'Windows PC',
  settings: { syncDir: '', syncEnabled: true, syncIntervalMin: 5, onlineLookup: false, tmdbKey: '', accentHue: 42, reduceMotion: false },
  categories: [
    {
      id: 'books', name: 'Book', pluralName: 'Books', glyph: '❦', hue: 38, order: 0,
      builtin: true, hidden: false, statusLabels: ['To read', 'Reading', 'Read'],
      defaultLayout: 'grid', defaultSort: { key: 'title', direction: 'asc' },
      fields: [{ id: 'author', key: 'author', label: 'Author', type: 'people' }],
    },
  ],
  entries: [{
    id: 'e1', categoryId: 'books', title: 'Piranesi', sortTitle: 'piranesi',
    images: [], coverIndex: 0, values: { author: [{ id: 'p', name: 'Susanna Clarke' }] },
    rating: 9, status: 2, favorite: true, notes: 'Kept me company.', tags: ['owned'],
    dateStarted: null, dateFinished: '2026-07-01',
    createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-01T00:00:00.000Z',
    origin: 'old-device', archived: false,
  }],
  diary: [{
    id: 'd1', date: '2026-07-01', mood: 'Quiet', body: 'Finished it on the balcony.',
    linkedEntryIds: ['e1'], createdAt: '', updatedAt: '', origin: 'old-device', archived: false,
  }],
  savedViews: [],
});

console.log('\nmigration — opening a version 1 library');

const migrated = normalise(v1Library());

test('the schema version moves forward', () => {
  assert.equal(migrated.schemaVersion, 2);
});

test('online lookup is switched on, because v1 could not have chosen otherwise', () => {
  assert.equal(migrated.settings.onlineLookup, true);
});

test('a deliberate later choice to switch it off is respected', () => {
  const off = normalise({ ...migrated, settings: { ...migrated.settings, onlineLookup: false } });
  assert.equal(off.settings.onlineLookup, false, 'a v2 file means she really did turn it off');
});

test('a brand-new library is not treated as a migration', () => {
  const fresh = normalise(null);
  assert.equal(fresh.schemaVersion, 2);
  assert.equal(fresh.entries.length, 0);
});

test('nothing she wrote is lost', () => {
  assert.equal(migrated.entries.length, 1);
  const e = migrated.entries[0];
  assert.equal(e.title, 'Piranesi');
  assert.equal(e.notes, 'Kept me company.');
  assert.equal(e.rating, 9);
  assert.deepEqual(e.tags, ['owned']);
  assert.equal(e.values.author[0].name, 'Susanna Clarke');
  assert.equal(migrated.diary[0].body, 'Finished it on the balcony.');
  assert.deepEqual(migrated.diary[0].linkedEntryIds, ['e1']);
});

test('the device keeps its identity, so sync does not see a new machine', () => {
  assert.equal(migrated.deviceId, 'old-device');
});

test('new per-entry fields get safe defaults', () => {
  const e = migrated.entries[0];
  assert.equal(e.who, 'both');
  assert.deepEqual(e.subItems, []);
});

test('categories added by a later version appear', () => {
  assert.ok(migrated.categories.find((c) => c.id === 'anime'), 'Anime should arrive');
  assert.ok(migrated.categories.find((c) => c.id === 'cities'), 'Cities should arrive');
});

test('fields added by a later version reach a category already on disk', () => {
  const books = migrated.categories.find((c) => c.id === 'books');
  // v1 stored Books with a single Author field; the rest must be merged in by key.
  for (const key of ['genre', 'year', 'pages', 'publisher', 'description']) {
    assert.ok(books.fields.some((f) => f.key === key), `Books should gain ${key}`);
  }
  const movies = migrated.categories.find((c) => c.id === 'movies');
  assert.ok(movies.fields.some((f) => f.key === 'imdb'), 'Movies should gain the IMDb link');
  assert.ok(movies.fields.some((f) => f.key === 'imdbRating'), 'Movies should gain the IMDb rating');
});

test('a field the user removed is not resurrected', () => {
  const src = v1Library();
  src.categories[0].fields.push({ id: 'series', key: 'series', label: 'Series', type: 'text', hidden: true });
  const out = normalise(src);
  const series = out.categories.find((c) => c.id === 'books').fields.filter((f) => f.key === 'series');
  assert.equal(series.length, 1, 'no duplicate');
  assert.equal(series[0].hidden, true, 'it should stay removed');
});

test('new category properties get sensible defaults', () => {
  const books = migrated.categories.find((c) => c.id === 'books');
  assert.equal(books.tracksWho, true);
  // v1 had no notion of sub-items; a category that predates them simply has none.
  assert.equal(books.subItemLabel, null);
});

test('migrating twice changes nothing further', () => {
  const twice = normalise(JSON.parse(JSON.stringify(migrated)));
  assert.deepEqual(twice, migrated);
});

console.log('\nmigration — the real library on this machine');

const realPath = path.join(process.env.APPDATA ?? '', 'atheneum', 'library', 'db.json');
if (fs.existsSync(realPath)) {
  const real = JSON.parse(fs.readFileSync(realPath, 'utf8'));
  const out = normalise(real);
  test('it survives being opened by this build', () => {
    assert.equal(out.entries.length, real.entries.length);
    assert.equal(out.diary.length, real.diary.length);
    assert.equal(out.deviceId, real.deviceId);
  });
  test('its lookup buttons will be visible', () => {
    assert.equal(out.settings.onlineLookup, true);
  });
} else {
  console.log('  --   no library on this machine, skipped');
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
