'use strict';
/**
 * Storing and serving cover images.
 *
 * Split out of main.cjs so the smoke test can exercise exactly the code the app runs, rather
 * than a copy of it that could drift.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const MIME = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
};

/** The privileged-scheme declaration. Must be registered before the app is ready. */
const SCHEME = {
  scheme: 'atheneum',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
};

/** Store bytes under their own content hash. Identical bytes are written once. */
async function saveImage(imagesDir, bytes, ext) {
  const buffer = Buffer.from(bytes);
  const hash = crypto.createHash('sha256').update(buffer).digest('hex');
  const safeExt = /^[a-z0-9]{1,5}$/i.test(ext) ? ext.toLowerCase() : 'jpg';
  const rel = path.posix.join(hash.slice(0, 2), `${hash}.${safeExt}`);
  const abs = path.join(imagesDir, hash.slice(0, 2), `${hash}.${safeExt}`);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  if (!fs.existsSync(abs)) await fsp.writeFile(abs, buffer);
  return { hash, file: rel };
}

/**
 * Resolve an `atheneum://images/<rel>` URL to a file on disk.
 *
 * Pure and synchronous so the traversal guard can be tested directly.
 * @returns {{ok: true, path: string, type: string} | {ok: false, status: number}}
 */
function resolveImageRequest(imagesDir, requestUrl) {
  let url;
  try {
    url = new URL(requestUrl);
  } catch {
    return { ok: false, status: 400 };
  }
  if (url.hostname !== 'images') return { ok: false, status: 404 };

  const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
  if (!rel) return { ok: false, status: 404 };

  const root = path.resolve(imagesDir);
  const abs = path.resolve(path.join(root, rel));
  // Anything that climbs out of the images directory is refused, whatever the URL claims.
  if (abs !== root && !abs.startsWith(root + path.sep)) return { ok: false, status: 403 };

  const ext = path.extname(abs).slice(1).toLowerCase();
  return { ok: true, path: abs, type: MIME[ext] ?? 'application/octet-stream' };
}

/** Wire the protocol up. Call after the app is ready. */
function registerImageProtocol(protocol, imagesDir) {
  protocol.handle('atheneum', async (request) => {
    const resolved = resolveImageRequest(imagesDir, request.url);
    if (!resolved.ok) return new Response('Not available', { status: resolved.status });
    try {
      const bytes = await fsp.readFile(resolved.path);
      return new Response(bytes, {
        headers: {
          'Content-Type': resolved.type,
          // Filenames are content hashes, so a stored image can never change under a URL.
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

module.exports = { SCHEME, MIME, saveImage, resolveImageRequest, registerImageProtocol };
