'use strict';
/**
 * Ranking, merging and image sanity — the parts of lookup that decide what she sees.
 *
 * No network: the providers themselves are exercised by hand against the live services, but
 * the logic that orders and combines their answers is pure and belongs under test. Every case
 * here comes from a real search that behaved badly at some point.
 *
 *   node scripts/test-lookup.cjs
 */
const assert = require('node:assert/strict');
const {
  mergeResults, rankResults, imageDimensions, appleArtwork, humanise, MIN_COVER_WIDTH,
} = require('../electron/lookup.cjs');

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

const hit = (over = {}) => ({
  id: 'x', source: 'Apple Books', title: 'The Iliad', year: 1990,
  coverUrl: 'https://example/c.jpg', url: null, fields: {}, ...over,
});

const titles = (list) => list.map((r) => r.title);

console.log('\nranking — what the query actually asked for');

test('a typo still finds the right book', () => {
  // "Illiad" once returned a 2026 omnibus and a copy of the Odyssey above the Iliad.
  const ranked = rankResults(mergeResults([
    hit({ id: '1', title: 'HOMER: The Iliad & the Odyssey', year: 2026 }),
    hit({ id: '2', title: 'The Odyssey', year: 2017 }),
    hit({ id: '3', title: 'The Iliad', year: 1990 }),
  ]), 'Illiad');
  assert.equal(ranked[0].title, 'The Iliad');
});

test('an exact match beats a longer title containing it', () => {
  const ranked = rankResults(mergeResults([
    hit({ id: '1', title: 'Plato: The Complete Works (31 Books)' }),
    hit({ id: '2', title: 'Meno' }),
  ]), 'Meno');
  assert.equal(ranked[0].title, 'Meno');
});

test('a leading article does not count against a match', () => {
  const ranked = rankResults(mergeResults([
    hit({ id: '1', title: 'Odyssey of the Mind' }),
    hit({ id: '2', title: 'The Odyssey' }),
  ]), 'Odyssey');
  assert.equal(ranked[0].title, 'The Odyssey');
});

test('a result with a cover outranks an otherwise equal one without', () => {
  const ranked = rankResults(mergeResults([
    hit({ id: '1', title: 'The Iliad', source: 'Open Library', coverUrl: null }),
    hit({ id: '2', title: 'The Iliad', source: 'Apple Books' }),
  ]), 'The Iliad');
  assert.ok(ranked[0].coverUrl);
});

test('a sequel does not displace the thing itself', () => {
  const ranked = rankResults(mergeResults([
    hit({ id: '1', title: 'Frieren: Beyond Journey’s End Season 2', source: 'AniList' }),
    hit({ id: '2', title: 'Frieren: Beyond Journey’s End', source: 'AniList' }),
  ]), 'Frieren');
  assert.equal(ranked[0].title, 'Frieren: Beyond Journey’s End');
});

console.log('\nmerging — one card per work, best parts of each');

test('two services describing the same book become one candidate', () => {
  const merged = mergeResults([
    hit({ id: 'a', source: 'Apple Books', fields: { author: ['Homer'], description: 'Epic.' } }),
    hit({ id: 'b', source: 'Open Library', fields: { pages: 704, publisher: 'Penguin' } }),
  ]);
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0].sources.sort(), ['Apple Books', 'Open Library']);
  assert.deepEqual(merged[0].fields.author, ['Homer']);
  assert.equal(merged[0].fields.pages, 704, 'the second source fills the gaps');
});

test('two editions from the SAME service stay separate', () => {
  // Fagles and Fitzgerald are a real choice; collapsing them would hide it.
  const merged = mergeResults([
    hit({ id: 'a', title: 'The Iliad', year: 1990, fields: { author: ['Homer', 'Robert Fagles'] } }),
    hit({ id: 'b', title: 'The Iliad', year: 2004, fields: { author: ['Homer', 'Robert Fitzgerald'] } }),
  ]);
  assert.equal(merged.length, 2);
});

test('the better source supplies the cover even when it answered second', () => {
  const merged = mergeResults([
    hit({ id: 'a', source: 'Open Library', coverUrl: 'https://ol/small.jpg' }),
    hit({ id: 'b', source: 'Apple Books', coverUrl: 'https://apple/big.jpg' }),
  ]);
  assert.equal(merged[0].coverUrl, 'https://apple/big.jpg');
});

test('a source with no cover never replaces one that has it', () => {
  const merged = mergeResults([
    hit({ id: 'a', source: 'Apple Books', coverUrl: 'https://apple/big.jpg' }),
    hit({ id: 'b', source: 'Open Library', coverUrl: null }),
  ]);
  assert.equal(merged[0].coverUrl, 'https://apple/big.jpg');
});

test('a filled value is not clobbered by a later source', () => {
  const merged = mergeResults([
    hit({ id: 'a', source: 'Apple Books', fields: { year: 1990 } }),
    hit({ id: 'b', source: 'Open Library', fields: { year: 1946 } }),
  ]);
  assert.equal(merged[0].fields.year, 1990);
});

console.log('\nimages — a download is not the same as a usable cover');

// A real 1x1 GIF, which is what Open Library serves for a cover it does not have.
const ONE_PIXEL_GIF = Buffer.from('R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==', 'base64');
const RED_PNG_2x2 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGP8z4AATAxQxhAVAgCRhAI' +
  'RQTaOWwAAAABJRU5ErkJggg==', 'base64');

test('a 1x1 placeholder is recognised as too small', () => {
  const d = imageDimensions(ONE_PIXEL_GIF);
  assert.deepEqual(d, { width: 1, height: 1 });
  assert.ok(d.width < MIN_COVER_WIDTH, 'and would be refused');
});

test('PNG dimensions are read correctly', () => {
  assert.deepEqual(imageDimensions(RED_PNG_2x2), { width: 2, height: 2 });
});

test('a JPEG header is walked to the frame marker', () => {
  // Minimal JPEG: SOI, a dummy APP0 segment, then SOF0 declaring 600x900.
  const jpeg = Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    Buffer.from([0xff, 0xe0, 0x00, 0x04, 0x00, 0x00]),
    Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, 0x03, 0x84, 0x02, 0x58]),
  ]);
  assert.deepEqual(imageDimensions(jpeg), { width: 600, height: 900 });
});

test('garbage is reported as unknown rather than guessed at', () => {
  assert.equal(imageDimensions(Buffer.from('not an image at all, truly')), null);
});

console.log('\nodds and ends');

test('Apple artwork is upscaled from the thumbnail URL', () => {
  const url = 'https://is1-ssl.mzstatic.com/image/thumb/x/y/z.jpg/100x100bb.jpg';
  assert.ok(appleArtwork(url).includes('/1200x1200bb.'));
  assert.ok(appleArtwork(url, 600).includes('/600x600bb.'));
});

test('known outages are explained, not shown as status codes', () => {
  assert.match(humanise('bgg', 401, ''), /requires an account/i);
  assert.match(humanise('jikan-anime', 504, ''), /MyAnimeList is not responding/i);
  assert.match(humanise('Apple Books', 429, ''), /rate-limiting/i);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
