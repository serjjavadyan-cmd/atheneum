'use strict';
/**
 * Running a sync.
 *
 * Layout inside the shared cloud folder:
 *
 *   <syncDir>/Atheneum/
 *     library-<deviceId>.json     one per machine; a machine only ever writes its own
 *     images/ab/<hash>.jpg        content-addressed, so copying can never collide
 *     snapshots/                  the local db before each merge, newest 20 kept
 *
 * No machine writes another machine's file, so the cloud client never has to resolve a
 * conflict — the worst case is a stale read, which the next sync picks up.
 */
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { mergeDatabases } = require('./merge.cjs');

const KEEP_SNAPSHOTS = 20;

async function exists(p) {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

async function ensureLayout(root) {
  await fsp.mkdir(path.join(root, 'images'), { recursive: true });
  await fsp.mkdir(path.join(root, 'snapshots'), { recursive: true });
}

/** Keep a copy of the local database before touching anything. */
async function snapshot(root, db) {
  const dir = path.join(root, 'snapshots');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  await fsp.writeFile(
    path.join(dir, `${stamp}-${db.deviceId}.json`),
    JSON.stringify(db, null, 2),
    'utf8',
  );

  const files = (await fsp.readdir(dir)).filter((f) => f.endsWith('.json')).sort();
  for (const stale of files.slice(0, Math.max(0, files.length - KEEP_SNAPSHOTS))) {
    await fsp.rm(path.join(dir, stale), { force: true }).catch(() => {});
  }
}

/**
 * Copy any image referenced by the merged database that is missing on either side.
 * Filenames are content hashes, so this is a plain copy with no possibility of clobbering.
 */
async function syncImages(root, localImagesDir, db) {
  const remoteImages = path.join(root, 'images');
  let pushed = 0;
  let pulled = 0;

  const referenced = new Set();
  for (const entry of db.entries ?? []) {
    for (const image of entry.images ?? []) if (image.file) referenced.add(image.file);
  }

  for (const rel of referenced) {
    const localPath = path.join(localImagesDir, rel);
    const remotePath = path.join(remoteImages, rel);
    const hasLocal = await exists(localPath);
    const hasRemote = await exists(remotePath);

    try {
      if (hasLocal && !hasRemote) {
        await fsp.mkdir(path.dirname(remotePath), { recursive: true });
        await fsp.copyFile(localPath, remotePath);
        pushed++;
      } else if (!hasLocal && hasRemote) {
        await fsp.mkdir(path.dirname(localPath), { recursive: true });
        await fsp.copyFile(remotePath, localPath);
        pulled++;
      }
      // Neither side has it: the entry keeps its reference. A missing file shows as a blank
      // cover, which is recoverable; dropping the reference would not be.
    } catch (err) {
      console.warn('image sync skipped', rel, err.message);
    }
  }

  return { pushed, pulled };
}

/**
 * Merge every other device's library into ours, then publish our own.
 *
 * @param {string} root      the <syncDir>/Atheneum folder
 * @param {object} localDb   this machine's database
 * @param {string} localImagesDir
 */
async function runSync(root, localDb, localImagesDir) {
  await ensureLayout(root);
  await snapshot(root, localDb);

  const ourFile = `library-${localDb.deviceId}.json`;
  const files = (await fsp.readdir(root)).filter(
    (f) => f.startsWith('library-') && f.endsWith('.json') && f !== ourFile,
  );

  let merged = localDb;
  const totals = { entries: 0, diary: 0, categories: 0 };
  const devices = [];
  const problems = [];

  for (const file of files) {
    try {
      const raw = await fsp.readFile(path.join(root, file), 'utf8');
      const remote = JSON.parse(raw);
      const result = mergeDatabases(merged, remote);
      merged = result.db;
      totals.entries += result.added.entries;
      totals.diary += result.added.diary;
      totals.categories += result.added.categories;
      devices.push(remote.deviceName || file.replace(/^library-|\.json$/g, ''));
    } catch (err) {
      // A half-written file from a cloud client mid-download must not abort the whole sync,
      // and must certainly not cause us to publish a library missing that device's data.
      problems.push(`${file}: ${err.message}`);
    }
  }

  const images = await syncImages(root, localImagesDir, merged);

  // Publish last, and only our own file.
  const tmp = path.join(root, `${ourFile}.tmp`);
  await fsp.writeFile(tmp, JSON.stringify(merged, null, 2), 'utf8');
  await fsp.rename(tmp, path.join(root, ourFile));

  return {
    db: merged,
    added: totals,
    images,
    devices,
    problems,
  };
}

module.exports = { runSync, syncImages, snapshot };
