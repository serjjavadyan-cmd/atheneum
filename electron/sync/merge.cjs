'use strict';
/**
 * The additive merge.
 *
 * Nane's hard requirement: a sync may only ever add. The rules below are chosen so that no
 * sequence of edits on two machines can lose anything she typed.
 *
 *   - Records are unioned by id. A record present on either side survives.
 *   - For a record on both sides, scalar fields take the newer `updatedAt`.
 *   - List fields are UNIONED, never intersected or replaced. Removing a tag on one machine
 *     does not remove it on the other — the cost of that is an occasional tag to delete twice,
 *     which is strictly better than silently losing one.
 *   - Diary days are never merged into each other. Two days with the same date stay as two
 *     records, and the UI shows both. Prose is the one thing that must never be overwritten.
 *   - Categories union, and so do their fields. A field hidden on one machine stays hidden only
 *     if the other machine has not touched it more recently.
 *   - Nothing is ever removed by this function.
 *
 * Kept dependency-free and pure so it can be unit-tested without Electron.
 */

/** Union arrays of primitives, first occurrence wins. */
function unionScalars(a, b) {
  const out = [];
  const seen = new Set();
  for (const v of [...(a ?? []), ...(b ?? [])]) {
    const k = typeof v === 'object' ? JSON.stringify(v) : String(v);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}

/** Union arrays of objects by a key, preferring the version from the newer record. */
function unionByKey(a, b, keyOf, preferB) {
  const out = [];
  const index = new Map();
  for (const item of [...(a ?? []), ...(b ?? [])]) {
    const k = keyOf(item);
    if (k == null) continue;
    if (index.has(k)) {
      // Same identity on both sides — keep the one from whichever record is newer.
      if (preferB) out[index.get(k)] = item;
      continue;
    }
    index.set(k, out.length);
    out.push(item);
  }
  return out;
}

const isPersonList = (v) =>
  Array.isArray(v) && v.length > 0 && typeof v[0] === 'object' && v[0] !== null && 'name' in v[0];

/** Merge one entry's custom-field bag. Lists union; everything else follows the newer record. */
function mergeValues(mine, theirs, preferTheirs) {
  const out = { ...mine };
  for (const [key, theirValue] of Object.entries(theirs ?? {})) {
    const myValue = out[key];

    if (myValue === undefined) {
      out[key] = theirValue;
      continue;
    }
    if (isPersonList(myValue) || isPersonList(theirValue)) {
      out[key] = unionByKey(
        Array.isArray(myValue) ? myValue : [],
        Array.isArray(theirValue) ? theirValue : [],
        (p) => p && p.name,
        preferTheirs,
      );
      continue;
    }
    if (Array.isArray(myValue) || Array.isArray(theirValue)) {
      out[key] = unionScalars(
        Array.isArray(myValue) ? myValue : [],
        Array.isArray(theirValue) ? theirValue : [],
      );
      continue;
    }
    // A scalar: the newer record wins, but never let a blank overwrite something written.
    if (preferTheirs && theirValue !== null && theirValue !== '') out[key] = theirValue;
    else if (myValue === null || myValue === '') out[key] = theirValue;
  }
  return out;
}

function newer(a, b) {
  return String(b.updatedAt ?? '') > String(a.updatedAt ?? '');
}

function mergeEntry(mine, theirs) {
  const preferTheirs = newer(mine, theirs);
  const base = preferTheirs ? { ...mine, ...theirs } : { ...theirs, ...mine };

  return {
    ...base,
    images: unionByKey(mine.images, theirs.images, (i) => i && i.hash, preferTheirs),
    tags: unionScalars(mine.tags, theirs.tags),
    values: mergeValues(mine.values, theirs.values, preferTheirs),
    // Dates: if only one side recorded it, keep it rather than letting a null win.
    dateStarted: mine.dateStarted ?? theirs.dateStarted ?? null,
    dateFinished: mine.dateFinished ?? theirs.dateFinished ?? null,
    // Notes are prose. If the two differ and both are non-empty, keep both rather than choose.
    notes: mergeProse(mine.notes, theirs.notes),
    createdAt: [mine.createdAt, theirs.createdAt].filter(Boolean).sort()[0] ?? mine.createdAt,
    updatedAt: preferTheirs ? theirs.updatedAt : mine.updatedAt,
    coverIndex: preferTheirs ? theirs.coverIndex : mine.coverIndex,
    archived: preferTheirs ? theirs.archived : mine.archived,
  };
}

const PROSE_SEPARATOR = '\n\n— — —\n';
const PROSE_SPLIT = /\n*— — —\n*/;

const proseSegments = (s) =>
  String(s ?? '').split(PROSE_SPLIT).map((x) => x.trim()).filter(Boolean);

/**
 * Two versions of the same written passage.
 *
 * Deciding which half of someone's writing to throw away is not a decision this function gets
 * to make, so genuinely divergent text is kept side by side behind a separator.
 *
 * The work is done on *segments* rather than whole strings, and that matters: a naive
 * "append theirs to mine" is not idempotent, and since every sync re-merges every device's
 * file, notes would grow by a copy of themselves on each run. Splitting on the separator and
 * unioning means re-merging the same pair is a no-op.
 */
function mergeProse(mine, theirs) {
  const a = String(mine ?? '');
  const b = String(theirs ?? '');
  if (a.trim() === b.trim()) return a;
  if (!a.trim()) return b;
  if (!b.trim()) return a;

  const out = proseSegments(a);
  for (const segment of proseSegments(b)) {
    if (out.includes(segment)) continue;
    // Carrying on writing where you left off should replace, not duplicate.
    const extended = out.findIndex((s) => segment.startsWith(s));
    if (extended >= 0) {
      out[extended] = segment;
      continue;
    }
    // The other side is a shorter prefix of something we already hold — nothing new in it.
    if (out.some((s) => s.startsWith(segment))) continue;
    out.push(segment);
  }
  return out.join(PROSE_SEPARATOR);
}

function mergeField(mine, theirs) {
  // Options union so a choice added on one machine appears on the other.
  return {
    ...mine,
    ...theirs,
    key: mine.key,
    options:
      mine.options || theirs.options
        ? unionScalars(mine.options ?? [], theirs.options ?? [])
        : undefined,
    // A field is only hidden if neither machine still wants it visible.
    hidden: Boolean(mine.hidden) && Boolean(theirs.hidden),
  };
}

function mergeCategory(mine, theirs) {
  return {
    ...mine,
    ...theirs,
    fields: unionByKey(
      mine.fields.map((f) => {
        const match = (theirs.fields ?? []).find((g) => g.key === f.key);
        return match ? mergeField(f, match) : f;
      }),
      theirs.fields ?? [],
      (f) => f && f.key,
      false,
    ),
    statusLabels:
      // Longer wins: a machine that added a stage should not lose it to one that did not.
      (theirs.statusLabels ?? []).length > (mine.statusLabels ?? []).length
        ? theirs.statusLabels
        : mine.statusLabels,
    hidden: Boolean(mine.hidden) && Boolean(theirs.hidden),
  };
}

/**
 * Fold one remote database into a local one.
 * @returns {{db: object, added: {entries: number, diary: number, categories: number}}}
 */
function mergeDatabases(local, remote) {
  if (!remote || typeof remote !== 'object') return { db: local, added: { entries: 0, diary: 0, categories: 0 } };

  const added = { entries: 0, diary: 0, categories: 0 };

  /* --- categories --- */
  const categories = [...(local.categories ?? [])];
  const catIndex = new Map(categories.map((c, i) => [c.id, i]));
  for (const theirs of remote.categories ?? []) {
    const at = catIndex.get(theirs.id);
    if (at === undefined) {
      categories.push(theirs);
      catIndex.set(theirs.id, categories.length - 1);
      added.categories++;
    } else {
      categories[at] = mergeCategory(categories[at], theirs);
    }
  }

  /* --- entries --- */
  const entries = [...(local.entries ?? [])];
  const entryIndex = new Map(entries.map((e, i) => [e.id, i]));
  for (const theirs of remote.entries ?? []) {
    const at = entryIndex.get(theirs.id);
    if (at === undefined) {
      entries.push(theirs);
      entryIndex.set(theirs.id, entries.length - 1);
      added.entries++;
    } else {
      entries[at] = mergeEntry(entries[at], theirs);
    }
  }

  /* --- diary: union by id only. Same-date days from two machines both survive. --- */
  const diary = [...(local.diary ?? [])];
  const diaryIndex = new Map(diary.map((d, i) => [d.id, i]));
  for (const theirs of remote.diary ?? []) {
    const at = diaryIndex.get(theirs.id);
    if (at === undefined) {
      diary.push(theirs);
      diaryIndex.set(theirs.id, diary.length - 1);
      added.diary++;
    } else {
      const mine = diary[at];
      const preferTheirs = newer(mine, theirs);
      diary[at] = {
        ...(preferTheirs ? { ...mine, ...theirs } : { ...theirs, ...mine }),
        body: mergeProse(mine.body, theirs.body),
        linkedEntryIds: unionScalars(mine.linkedEntryIds, theirs.linkedEntryIds),
        mood: (preferTheirs ? theirs.mood : mine.mood) ?? mine.mood ?? theirs.mood ?? null,
        archived: Boolean(mine.archived) && Boolean(theirs.archived),
        updatedAt: preferTheirs ? theirs.updatedAt : mine.updatedAt,
      };
    }
  }

  /* --- saved views: union by id, never removed --- */
  const savedViews = unionByKey(local.savedViews ?? [], remote.savedViews ?? [], (v) => v && v.id, false);

  return {
    db: {
      ...local,
      // Settings are per-machine (sync folder, theme) and deliberately do not travel.
      categories,
      entries,
      diary,
      savedViews,
    },
    added,
  };
}

module.exports = { mergeDatabases, mergeProse, unionScalars, unionByKey, mergeValues };
