'use strict';
/**
 * Proves the one promise that matters: a sync only ever adds.
 *
 * Simulates two machines editing the same library independently, merges both directions, and
 * asserts nothing typed on either machine is missing afterwards. Run with:
 *
 *   node scripts/test-sync.cjs
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { mergeDatabases, mergeProse } = require('../electron/sync/merge.cjs');
const { runSync } = require('../electron/sync/run.cjs');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL ${name}`);
    console.error(`       ${err.message}`);
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL ${name}`);
    console.error(`       ${err.message}`);
  }
}

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

const T0 = '2026-08-01T10:00:00.000Z';
const T1 = '2026-08-02T10:00:00.000Z';
const T2 = '2026-08-03T10:00:00.000Z';

const entry = (over = {}) => ({
  id: 'e1',
  categoryId: 'books',
  title: 'Piranesi',
  sortTitle: 'piranesi',
  images: [],
  coverIndex: 0,
  values: {},
  rating: 0,
  status: 0,
  who: 'both',
  favorite: false,
  notes: '',
  tags: [],
  subItems: [],
  dateStarted: null,
  dateFinished: null,
  createdAt: T0,
  updatedAt: T0,
  origin: 'A',
  archived: false,
  ...over,
});

const database = (deviceId, over = {}) => ({
  schemaVersion: 1,
  deviceId,
  deviceName: deviceId,
  settings: { syncDir: `local-to-${deviceId}` },
  categories: [
    {
      id: 'books',
      name: 'Book',
      pluralName: 'Books',
      glyph: '❦',
      hue: 38,
      order: 0,
      builtin: true,
      hidden: false,
      statusLabels: ['To read', 'Reading', 'Read'],
      defaultLayout: 'grid',
      defaultSort: { key: 'title', direction: 'asc' },
      fields: [{ id: 'author', key: 'author', label: 'Author', type: 'people' }],
    },
  ],
  entries: [entry()],
  diary: [],
  savedViews: [],
  ...over,
});

/* ------------------------------------------------------------------ *
 * Merge rules
 * ------------------------------------------------------------------ */

console.log('\nmerge — nothing is ever lost');

test('an entry created only on the other machine arrives', () => {
  const a = database('A');
  const b = database('B', { entries: [entry(), entry({ id: 'e2', title: 'Pachinko' })] });
  const { db, added } = mergeDatabases(a, b);
  assert.equal(db.entries.length, 2);
  assert.equal(added.entries, 1);
  assert.ok(db.entries.find((e) => e.id === 'e2'));
});

test('tags added on both machines are unioned, not replaced', () => {
  const a = database('A', { entries: [entry({ tags: ['owned', 'reread'], updatedAt: T1 })] });
  const b = database('B', { entries: [entry({ tags: ['owned', 'gift'], updatedAt: T2 })] });
  const { db } = mergeDatabases(a, b);
  assert.deepEqual(db.entries[0].tags.sort(), ['gift', 'owned', 'reread']);
});

test('removing a tag on one machine does not remove it on the other', () => {
  // A removed 'gift'; B still has it. Union means it comes back rather than vanishing.
  const a = database('A', { entries: [entry({ tags: ['owned'], updatedAt: T2 })] });
  const b = database('B', { entries: [entry({ tags: ['owned', 'gift'], updatedAt: T1 })] });
  const { db } = mergeDatabases(a, b);
  assert.ok(db.entries[0].tags.includes('gift'));
});

test('people in a field are unioned by name', () => {
  const a = database('A', {
    entries: [entry({ values: { author: [{ id: '1', name: 'Susanna Clarke' }] }, updatedAt: T1 })],
  });
  const b = database('B', {
    entries: [entry({ values: { author: [{ id: '2', name: 'Translator X' }] }, updatedAt: T2 })],
  });
  const { db } = mergeDatabases(a, b);
  assert.deepEqual(db.entries[0].values.author.map((p) => p.name).sort(), ['Susanna Clarke', 'Translator X']);
});

test('a scalar field takes the newer value', () => {
  const a = database('A', { entries: [entry({ values: { year: 2020 }, updatedAt: T1 })] });
  const b = database('B', { entries: [entry({ values: { year: 2021 }, updatedAt: T2 })] });
  const { db } = mergeDatabases(a, b);
  assert.equal(db.entries[0].values.year, 2021);
});

test('a newer blank never overwrites an older written value', () => {
  const a = database('A', { entries: [entry({ values: { publisher: 'Bloomsbury' }, updatedAt: T1 })] });
  const b = database('B', { entries: [entry({ values: { publisher: '' }, updatedAt: T2 })] });
  const { db } = mergeDatabases(a, b);
  assert.equal(db.entries[0].values.publisher, 'Bloomsbury');
});

test('images are unioned by hash', () => {
  const img = (h) => ({ hash: h, file: `${h.slice(0, 2)}/${h}.jpg`, width: 1, height: 1, tint: '0 0% 50%' });
  const a = database('A', { entries: [entry({ images: [img('aaa')], updatedAt: T1 })] });
  const b = database('B', { entries: [entry({ images: [img('bbb')], updatedAt: T2 })] });
  const { db } = mergeDatabases(a, b);
  assert.deepEqual(db.entries[0].images.map((i) => i.hash).sort(), ['aaa', 'bbb']);
});

test('dates survive when only one machine recorded them', () => {
  const a = database('A', { entries: [entry({ dateFinished: '2026-07-01', updatedAt: T1 })] });
  const b = database('B', { entries: [entry({ dateFinished: null, updatedAt: T2 })] });
  const { db } = mergeDatabases(a, b);
  assert.equal(db.entries[0].dateFinished, '2026-07-01');
});

console.log('\nmerge — prose is never silently discarded');

test('divergent notes keep both halves', () => {
  const a = database('A', { entries: [entry({ notes: 'Loved the tides.', updatedAt: T1 })] });
  const b = database('B', { entries: [entry({ notes: 'The statues stayed with me.', updatedAt: T2 })] });
  const { db } = mergeDatabases(a, b);
  assert.ok(db.entries[0].notes.includes('Loved the tides.'));
  assert.ok(db.entries[0].notes.includes('The statues stayed with me.'));
});

test('an extended note does not duplicate its own prefix', () => {
  assert.equal(mergeProse('Half a thought', 'Half a thought, now finished'), 'Half a thought, now finished');
  assert.equal(mergeProse('Half a thought, now finished', 'Half a thought'), 'Half a thought, now finished');
});

test('identical notes stay identical', () => {
  assert.equal(mergeProse('Same', 'Same'), 'Same');
});

console.log('\nmerge — the diary');

const day = (over = {}) => ({
  id: 'd1',
  date: '2026-08-05',
  mood: null,
  body: '',
  linkedEntryIds: [],
  createdAt: T0,
  updatedAt: T0,
  origin: 'A',
  archived: false,
  ...over,
});

test('two machines writing the same date keep BOTH days', () => {
  const a = database('A', { diary: [day({ id: 'dA', body: 'Wrote at home.' })] });
  const b = database('B', { diary: [day({ id: 'dB', body: 'Wrote on the train.', origin: 'B' })] });
  const { db } = mergeDatabases(a, b);
  assert.equal(db.diary.length, 2, 'both same-date days must survive');
  const bodies = db.diary.map((d) => d.body);
  assert.ok(bodies.includes('Wrote at home.'));
  assert.ok(bodies.includes('Wrote on the train.'));
});

test('the same day edited on both machines keeps both texts', () => {
  const a = database('A', { diary: [day({ body: 'Morning thoughts.', updatedAt: T1 })] });
  const b = database('B', { diary: [day({ body: 'Evening thoughts.', updatedAt: T2 })] });
  const { db } = mergeDatabases(a, b);
  assert.equal(db.diary.length, 1);
  assert.ok(db.diary[0].body.includes('Morning thoughts.'));
  assert.ok(db.diary[0].body.includes('Evening thoughts.'));
});

test('diary links are unioned', () => {
  const a = database('A', { diary: [day({ linkedEntryIds: ['e1'], updatedAt: T1 })] });
  const b = database('B', { diary: [day({ linkedEntryIds: ['e2'], updatedAt: T2 })] });
  const { db } = mergeDatabases(a, b);
  assert.deepEqual(db.diary[0].linkedEntryIds.sort(), ['e1', 'e2']);
});

console.log('\nmerge — sub-items and who');

const sub = (over = {}) => ({
  id: 's1', number: '1', title: 'Innie', note: '', rating: 0, done: false,
  date: null, createdAt: T0, ...over,
});

test('a sub-item added on one machine arrives on the other', () => {
  const a = database('A', { entries: [entry({ subItems: [sub()], updatedAt: T1 })] });
  const b = database('B', { entries: [entry({ subItems: [sub({ id: 's2', number: '2' })], updatedAt: T2 })] });
  const { db } = mergeDatabases(a, b);
  assert.deepEqual(db.entries[0].subItems.map((s) => s.id).sort(), ['s1', 's2']);
});

test('ticking a sub-item done on either machine sticks', () => {
  const a = database('A', { entries: [entry({ subItems: [sub({ done: true })], updatedAt: T1 })] });
  const b = database('B', { entries: [entry({ subItems: [sub({ done: false })], updatedAt: T2 })] });
  const { db } = mergeDatabases(a, b);
  assert.equal(db.entries[0].subItems[0].done, true, 'a newer "not done" must not un-watch it');
});

test('two notes on the same sub-item both survive', () => {
  const a = database('A', { entries: [entry({ subItems: [sub({ note: 'The lift scene.' })], updatedAt: T1 })] });
  const b = database('B', { entries: [entry({ subItems: [sub({ note: 'That ending.' })], updatedAt: T2 })] });
  const { db } = mergeDatabases(a, b);
  const note = db.entries[0].subItems[0].note;
  assert.ok(note.includes('The lift scene.'));
  assert.ok(note.includes('That ending.'));
});

test('sub-item merging is idempotent', () => {
  const a = database('A', { entries: [entry({ subItems: [sub({ note: 'mine' })], updatedAt: T1 })] });
  const b = database('B', { entries: [entry({ subItems: [sub({ note: 'theirs' })], updatedAt: T2 })] });
  const once = mergeDatabases(a, b).db;
  const twice = mergeDatabases(once, b).db;
  assert.deepEqual(twice.entries[0].subItems, once.entries[0].subItems);
});

test('who takes the newer choice', () => {
  const a = database('A', { entries: [entry({ who: 'a', updatedAt: T1 })] });
  const b = database('B', { entries: [entry({ who: 'b', updatedAt: T2 })] });
  const { db } = mergeDatabases(a, b);
  assert.equal(db.entries[0].who, 'b');
});

console.log('\nmerge — categories and fields');

test('a field added on one machine appears on the other', () => {
  const a = database('A');
  const b = database('B');
  b.categories[0].fields.push({ id: 'isbn', key: 'isbn', label: 'ISBN', type: 'text' });
  const { db } = mergeDatabases(a, b);
  assert.ok(db.categories[0].fields.find((f) => f.key === 'isbn'));
});

test('a field removed on one machine stays while the other still wants it', () => {
  const a = database('A');
  a.categories[0].fields[0].hidden = true;
  const b = database('B');
  const { db } = mergeDatabases(a, b);
  assert.equal(db.categories[0].fields[0].hidden, false);
});

test('select options are unioned', () => {
  const a = database('A');
  a.categories[0].fields[0] = { id: 'g', key: 'g', label: 'Genre', type: 'select', options: ['Fantasy'] };
  const b = database('B');
  b.categories[0].fields[0] = { id: 'g', key: 'g', label: 'Genre', type: 'select', options: ['Horror'] };
  const { db } = mergeDatabases(a, b);
  assert.deepEqual(db.categories[0].fields[0].options.sort(), ['Fantasy', 'Horror']);
});

test('a new category arrives whole', () => {
  const a = database('A');
  const b = database('B');
  b.categories.push({ ...b.categories[0], id: 'vinyl', name: 'Record', pluralName: 'Vinyl', builtin: false });
  const { db } = mergeDatabases(a, b);
  assert.ok(db.categories.find((c) => c.id === 'vinyl'));
});

test('an extra status stage survives the merge', () => {
  const a = database('A');
  const b = database('B');
  b.categories[0].statusLabels = ['To read', 'Reading', 'Read', 'Abandoned'];
  const { db } = mergeDatabases(a, b);
  assert.deepEqual(db.categories[0].statusLabels, ['To read', 'Reading', 'Read', 'Abandoned']);
});

console.log('\nmerge — properties that must hold generally');

test('settings never travel between machines', () => {
  const a = database('A');
  const b = database('B');
  const { db } = mergeDatabases(a, b);
  assert.equal(db.settings.syncDir, 'local-to-A');
  assert.equal(db.deviceId, 'A');
});

test('merging is idempotent — running it twice changes nothing', () => {
  const a = database('A', { entries: [entry({ tags: ['x'], notes: 'mine', updatedAt: T1 })] });
  const b = database('B', { entries: [entry({ tags: ['y'], notes: 'theirs', updatedAt: T2 })] });
  const once = mergeDatabases(a, b).db;
  const twice = mergeDatabases(once, b).db;
  assert.deepEqual(twice, once, 'a repeated sync must not keep appending');
});

test('merging is symmetric in what survives, whichever side runs it', () => {
  const a = database('A', { entries: [entry({ tags: ['x'], updatedAt: T1 }), entry({ id: 'eA', title: 'Only A' })] });
  const b = database('B', { entries: [entry({ tags: ['y'], updatedAt: T2 }), entry({ id: 'eB', title: 'Only B' })] });
  const fromA = mergeDatabases(a, b).db;
  const fromB = mergeDatabases(b, a).db;
  assert.deepEqual(fromA.entries.map((e) => e.id).sort(), fromB.entries.map((e) => e.id).sort());
  assert.deepEqual(fromA.entries[0].tags.sort(), fromB.entries[0].tags.sort());
});

test('no hard delete: an entry archived on one machine is still present on both', () => {
  const a = database('A', { entries: [entry({ archived: true, updatedAt: T2 })] });
  const b = database('B', { entries: [entry({ archived: false, updatedAt: T1 })] });
  const { db } = mergeDatabases(a, b);
  assert.equal(db.entries.length, 1, 'the record itself is never dropped');
  assert.equal(db.entries[0].archived, true, 'the newer archive decision wins, but the data stays');
});

test('a corrupt remote cannot empty the local library', () => {
  const a = database('A');
  for (const junk of [null, undefined, 'nonsense', 42, {}]) {
    const { db } = mergeDatabases(a, junk);
    assert.equal(db.entries.length, 1, `junk input ${JSON.stringify(junk)} must be survivable`);
  }
});

/* ------------------------------------------------------------------ *
 * End-to-end: two machines, one folder
 * ------------------------------------------------------------------ */

(async () => {
  console.log('\nend to end — two machines through one folder');

  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'atheneum-sync-'));
  const shared = path.join(tmp, 'Atheneum');
  const imagesA = path.join(tmp, 'A-images');
  const imagesB = path.join(tmp, 'B-images');
  await fsp.mkdir(path.join(imagesA, 'ab'), { recursive: true });
  await fsp.mkdir(imagesB, { recursive: true });
  await fsp.writeFile(path.join(imagesA, 'ab', 'abc.jpg'), 'fake-image-bytes');

  const img = { hash: 'abc', file: 'ab/abc.jpg', width: 10, height: 10, tint: '200 40% 50%' };

  let dbA = database('A', {
    entries: [entry({ images: [img], tags: ['owned'], notes: 'Read on the balcony.', updatedAt: T1 })],
    diary: [day({ id: 'dA', body: 'Written on the laptop.' })],
  });
  let dbB = database('B', {
    entries: [entry({ tags: ['gift'], notes: 'Bought it twice.', updatedAt: T2 })],
    diary: [day({ id: 'dB', body: 'Written on the desktop.', origin: 'B' })],
  });

  await testAsync('first sync from A publishes its library', async () => {
    const r = await runSync(shared, dbA, imagesA);
    dbA = r.db;
    assert.ok(fs.existsSync(path.join(shared, 'library-A.json')));
    assert.equal(r.images.pushed, 1, 'A should push its cover into the shared folder');
  });

  await testAsync('B syncs and receives everything A had', async () => {
    const r = await runSync(shared, dbB, imagesB);
    dbB = r.db;
    assert.equal(dbB.entries.length, 1);
    assert.deepEqual(dbB.entries[0].tags.sort(), ['gift', 'owned']);
    assert.ok(dbB.entries[0].notes.includes('Read on the balcony.'));
    assert.ok(dbB.entries[0].notes.includes('Bought it twice.'));
    assert.equal(dbB.diary.length, 2, 'both machines\' diary days survive');
    assert.equal(r.images.pulled, 1, 'B should pull the cover down');
    assert.ok(fs.existsSync(path.join(imagesB, 'ab', 'abc.jpg')));
  });

  await testAsync('A syncs back and converges with B', async () => {
    const r = await runSync(shared, dbA, imagesA);
    dbA = r.db;
    assert.deepEqual(dbA.entries[0].tags.sort(), ['gift', 'owned']);
    assert.equal(dbA.diary.length, 2);
  });

  await testAsync('both machines now agree on the content', async () => {
    const idsA = dbA.entries.map((e) => e.id).sort();
    const idsB = dbB.entries.map((e) => e.id).sort();
    assert.deepEqual(idsA, idsB);
    assert.deepEqual(dbA.diary.map((d) => d.id).sort(), dbB.diary.map((d) => d.id).sort());
  });

  await testAsync('a repeated sync adds nothing and duplicates nothing', async () => {
    const before = JSON.stringify(dbA.entries) + JSON.stringify(dbA.diary);
    const r = await runSync(shared, dbA, imagesA);
    const after = JSON.stringify(r.db.entries) + JSON.stringify(r.db.diary);
    assert.equal(after, before, 'syncing twice must be a no-op');
  });

  await testAsync('snapshots are written before each merge', async () => {
    const snaps = await fsp.readdir(path.join(shared, 'snapshots'));
    assert.ok(snaps.length >= 4, `expected snapshots, found ${snaps.length}`);
  });

  await testAsync('a half-written remote file does not abort the sync', async () => {
    await fsp.writeFile(path.join(shared, 'library-C.json'), '{ "entries": [ truncated');
    const r = await runSync(shared, dbA, imagesA);
    assert.equal(r.problems.length, 1, 'the bad file should be reported');
    assert.equal(r.db.entries.length, dbA.entries.length, 'and everything else preserved');
  });

  await testAsync('a device that vanishes leaves its entries behind', async () => {
    // C never comes back, but anything it contributed must remain in the library.
    await fsp.writeFile(
      path.join(shared, 'library-C.json'),
      JSON.stringify(database('C', { entries: [entry({ id: 'eC', title: 'From the lost laptop' })] })),
    );
    let r = await runSync(shared, dbA, imagesA);
    assert.ok(r.db.entries.find((e) => e.id === 'eC'));
    await fsp.rm(path.join(shared, 'library-C.json'));
    r = await runSync(shared, r.db, imagesA);
    assert.ok(r.db.entries.find((e) => e.id === 'eC'), 'deleting the device file must not delete its data');
  });

  await fsp.rm(tmp, { recursive: true, force: true });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
})();
