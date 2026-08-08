'use strict';
/**
 * Find the folder both computers sync through.
 *
 * Adapted from Constellation's lib/backup.js, widened from Google-Drive-only to also cover
 * Dropbox, OneDrive and iCloud — Nane's Windows PC does not currently have Drive for Desktop
 * mounted, so assuming Drive would have silently found nothing.
 *
 * The convention matches Constellation's: '' means auto-detect, 'off' disables, anything else
 * is used as an explicit path.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/** Candidate roots, best-first. The first one that exists and is a directory wins. */
function candidates() {
  const home = os.homedir();
  const dirs = [];

  if (process.platform === 'darwin') {
    const cloud = path.join(home, 'Library', 'CloudStorage');
    // macOS puts modern cloud providers under CloudStorage with account-suffixed names.
    try {
      for (const name of fs.readdirSync(cloud)) {
        if (name.startsWith('GoogleDrive-')) dirs.push(path.join(cloud, name, 'My Drive'));
        else if (name.startsWith('Dropbox')) dirs.push(path.join(cloud, name));
        else if (name.startsWith('OneDrive')) dirs.push(path.join(cloud, name));
      }
    } catch { /* CloudStorage does not exist on older macOS */ }
    dirs.push(path.join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs'));
    dirs.push(path.join(home, 'Google Drive'));
    dirs.push(path.join(home, 'Dropbox'));
    dirs.push(path.join(home, 'OneDrive'));
  } else if (process.platform === 'win32') {
    dirs.push(path.join(home, 'My Drive'));
    dirs.push(path.join(home, 'Google Drive'));
    for (const letter of ['G', 'H', 'I', 'J']) dirs.push(`${letter}:\\My Drive`);
    dirs.push(path.join(home, 'Dropbox'));
    dirs.push(path.join(home, 'OneDrive'));
    dirs.push(path.join(home, 'iCloudDrive'));
  } else {
    dirs.push(path.join(home, 'Dropbox'));
    dirs.push(path.join(home, 'Google Drive'));
  }

  return dirs;
}

function isDirectory(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Resolve the folder to sync through.
 * @param {string} configured the user's setting: '' (auto), 'off', or an explicit path
 * @returns {Promise<string|null>} the Atheneum folder inside it, or null
 */
async function locateSyncDir(configured) {
  const setting = String(configured ?? '').trim();
  if (setting.toLowerCase() === 'off') return null;

  if (setting) {
    // An explicit path is taken at face value — but only if it actually exists, so a typo
    // surfaces as "not found" rather than quietly creating a folder in the wrong place.
    return isDirectory(setting) ? path.join(setting, 'Atheneum') : null;
  }

  for (const dir of candidates()) {
    if (isDirectory(dir)) return path.join(dir, 'Atheneum');
  }
  return null;
}

/** Human-readable list of where auto-detect looked, for the error message in Settings. */
function describeCandidates() {
  return candidates().map((d) => path.basename(path.dirname(d)) || d);
}

module.exports = { locateSyncDir, describeCandidates, candidates };
