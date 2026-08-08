'use strict';
/**
 * The auto-fill promise: fill what's empty, never touch what she typed.
 *
 * `src/lib/applyLookup.ts` is pure, so it can be bundled with esbuild (already present via
 * Vite) and tested in plain Node — no browser, no Electron, no test framework.
 *
 *   node scripts/test-fill.cjs
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const esbuild = require('esbuild');

const bundled = esbuild.buildSync({
  entryPoints: [path.join(__dirname, '..', 'src', 'lib', 'applyLookup.ts')],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  write: false,
  logLevel: 'silent',
});

const module_ = { exports: {} };
// eslint-disable-next-line no-new-func
new Function('module', 'exports', 'require', bundled.outputFiles[0].text)(
  module_, module_.exports, require,
);
const { planFill, hintsFrom, coerce, hasValue } = module_.exports;

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

const field = (key, label, type, extra = {}) => ({ id: key, key, label, type, ...extra });

const BOOKS = {
  id: 'books', name: 'Book', pluralName: 'Books', glyph: '❦', hue: 38, order: 0,
  builtin: true, hidden: false, statusLabels: ['To read', 'Reading', 'Read'],
  subItemLabel: 'Chapters', tracksWho: true, defaultLayout: 'grid',
  defaultSort: { key: 'title', direction: 'asc' },
  fields: [
    field('author', 'Author', 'people'),
    field('genre', 'Genre', 'multiselect', { options: ['Classic', 'Poetry'] }),
    field('year', 'Year published', 'number'),
    field('pages', 'Pages', 'number'),
    field('publisher', 'Publisher', 'text'),
    field('language', 'Language', 'text'),
    field('description', 'Description', 'longtext'),
    field('gone', 'Removed field', 'text', { hidden: true }),
  ],
};

const entry = (values = {}) => ({
  id: 'e', categoryId: 'books', title: 'The Iliad', sortTitle: 'iliad',
  images: [], coverIndex: 0, rating: 0, status: 0, who: 'both', favorite: false,
  notes: '', tags: [], subItems: [], dateStarted: null, dateFinished: null,
  createdAt: '', updatedAt: '', origin: 'A', archived: false, values,
});

const RESULT = {
  id: 'r', source: 'Open Library', title: 'The Iliad', year: 2023, coverUrl: null, url: null,
  fields: {
    author: ['Emily Wilson'],
    genre: ['Classic', 'Poetry'],
    year: 2023,
    pages: 848,
    publisher: 'W. W. Norton',
    language: 'eng',
    description: 'An epic poem about the rage of Achilles.',
    gone: 'should be ignored, the field is removed',
    strangerKey: 'no home for this',
  },
};

console.log('\nauto-fill — fills the gaps, leaves your writing alone');

test("the Iliad case: author stays Homer, everything else fills", () => {
  const e = entry({ author: [{ id: 'p', name: 'Homer' }] });
  const plan = planFill(e, BOOKS, RESULT);

  assert.ok(!plan.fills.some((f) => f.field.key === 'author'), 'author must never be overwritten');
  assert.deepEqual(
    plan.fills.map((f) => f.field.key).sort(),
    ['description', 'genre', 'language', 'pages', 'publisher', 'year'],
  );
  assert.deepEqual(plan.locked.map((l) => l.field.key), ['author']);
  assert.equal(plan.locked[0].current, 'Homer');
});

test('an entry with nothing filled takes everything on offer', () => {
  const plan = planFill(entry(), BOOKS, RESULT);
  assert.ok(plan.fills.length >= 6);
  assert.equal(plan.locked.length, 0);
});

test('an entry already complete is left entirely alone', () => {
  const e = entry({
    author: [{ id: 'p', name: 'Homer' }], genre: ['Classic'], year: 1900, pages: 500,
    publisher: 'Mine', language: 'en', description: 'My own words.',
  });
  const plan = planFill(e, BOOKS, RESULT);
  assert.equal(plan.fills.length, 0, 'nothing should be proposed');
  assert.equal(plan.locked.length, 7);
});

test('a removed field is never filled, even when data exists for it', () => {
  const plan = planFill(entry(), BOOKS, RESULT);
  assert.ok(!plan.fills.some((f) => f.field.key === 'gone'));
});

test('data with no matching field is reported, not silently dropped', () => {
  const plan = planFill(entry(), BOOKS, RESULT);
  assert.ok(plan.unused.includes('strangerKey'));
});

test('a zero rating and an empty list count as empty, not as filled', () => {
  const e = entry({ genre: [], pages: null, publisher: '' });
  const plan = planFill(e, BOOKS, RESULT);
  const keys = plan.fills.map((f) => f.field.key);
  assert.ok(keys.includes('genre') && keys.includes('pages') && keys.includes('publisher'));
});

test('a filled value of 0 is respected as a real answer', () => {
  // Someone recording a 0-page ebook still typed something; do not overwrite it.
  assert.equal(hasValue(0), true);
  const plan = planFill(entry({ pages: 0 }), BOOKS, RESULT);
  assert.ok(!plan.fills.some((f) => f.field.key === 'pages'));
});

console.log('\nauto-fill — values arrive in the right shape');

test('people arrive as person records with ids', () => {
  const v = coerce(['Homer', 'Emily Wilson'], field('a', 'A', 'people'));
  assert.equal(v.length, 2);
  assert.equal(v[0].name, 'Homer');
  assert.ok(v[0].id, 'each person needs an id');
});

test('cast keeps the role as a note', () => {
  const v = coerce([{ name: 'Amy Adams', note: 'Louise' }], field('c', 'C', 'people'));
  assert.equal(v[0].note, 'Louise');
});

test('durations parse from words and from minutes', () => {
  assert.equal(coerce('2h 14m', field('r', 'R', 'duration')), 134);
  assert.equal(coerce(116, field('r', 'R', 'duration')), 116);
});

test('numbers survive being wrapped in text', () => {
  assert.equal(coerce('848 pages', field('p', 'P', 'number')), 848);
});

test('a choice matches an existing option regardless of case', () => {
  const f = field('s', 'S', 'select', { options: ['Ongoing', 'Completed'] });
  assert.equal(coerce('completed', f), 'Completed');
});

test('a choice with no matching option is kept rather than discarded', () => {
  const f = field('s', 'S', 'select', { options: ['Ongoing'] });
  assert.equal(coerce('Hiatus', f), 'Hiatus');
});

test('dates normalise to ISO', () => {
  assert.equal(coerce('2023-05-04', field('d', 'D', 'date')), '2023-05-04');
  assert.equal(coerce('4 May 2023', field('d', 'D', 'date')), '2023-05-04');
});

test('a list collapses sensibly into a text field', () => {
  assert.equal(coerce(['A24', 'Focus'], field('t', 'T', 'text')), 'A24, Focus');
});

console.log('\nauto-fill — what gets used to narrow the search');

test('a filled author becomes a search hint', () => {
  const h = hintsFrom(entry({ author: [{ id: 'p', name: 'Homer' }] }), BOOKS);
  assert.equal(h.author, 'Homer');
});

test('a filled year becomes a search hint', () => {
  const h = hintsFrom(entry({ year: 2023 }), BOOKS);
  assert.equal(h.year, 2023);
});

test('an empty entry offers no hints', () => {
  assert.deepEqual(hintsFrom(entry(), BOOKS), {});
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
