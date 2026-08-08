'use strict';
/**
 * Looking things up online.
 *
 * Runs in the main process, not the renderer — the app's CSP deliberately forbids outbound
 * requests from the page, and most of these APIs would fail CORS anyway.
 *
 * Every provider returns the same shape, so the renderer never learns which one answered:
 *
 *   { id, source, title, year, coverUrl, url, fields: { <key>: value } }
 *
 * The keys in `fields` match the default field keys in src/defaults.ts. The renderer maps them
 * onto whatever fields the category actually has and ignores the rest, so a renamed or deleted
 * field simply doesn't get filled.
 *
 * No provider may throw. A dead network, a rate limit or a bad key returns an empty list and a
 * note, because half a result is far better than a failed lookup.
 */

const UA = 'Atheneum/0.1 (personal library app)';
const TIMEOUT_MS = 12000;

/**
 * Known failure modes, said in plain language.
 *
 * These are real and current, verified against the live services: BoardGameGeek started
 * requiring authentication on its XML API, and Jikan reports upstream MyAnimeList outages as a
 * 504 of its own. Reporting them as bare status codes would look like a bug in the app.
 */
function humanise(source, status, body) {
  if (source === 'bgg' && status === 401) {
    return 'BoardGameGeek now requires an account for its API, so board game lookups are unavailable. Add these by hand for now.';
  }
  if (source.startsWith('jikan') && (status === 504 || /MyAnimeList may be down/i.test(body ?? ''))) {
    return 'MyAnimeList is not responding at the moment. Worth trying again shortly.';
  }
  if (status === 429) {
    return `${source} is rate-limiting requests right now. Try again in a minute.`;
  }
  return `${source} returned ${status}.`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * One retry on the statuses that are usually momentary. Anything else fails immediately —
 * retrying a 401 or a 404 just makes the user wait longer for the same answer.
 */
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

async function request(url, options = {}, source = 'lookup', attempt = 0) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: { 'User-Agent': UA, ...(options.headers ?? {}) },
    });
    if (!res.ok) {
      if (RETRYABLE.has(res.status) && attempt === 0) {
        clearTimeout(timer);
        await sleep(900);
        return request(url, options, source, 1);
      }
      let body = '';
      try { body = (await res.text()).slice(0, 300); } catch { /* body is optional context */ }
      throw new Error(humanise(source, res.status, body));
    }
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function getJson(url, options = {}, source = 'lookup') {
  const res = await request(url, { ...options, headers: { Accept: 'application/json', ...(options.headers ?? {}) } }, source);
  const data = await res.json();
  // Jikan answers 200 with an error envelope when MyAnimeList is the thing that's down.
  if (data && typeof data === 'object' && data.status >= 400 && data.message) {
    throw new Error(humanise(source, data.status, data.message));
  }
  return data;
}

async function getText(url, source = 'lookup') {
  const res = await request(url, {}, source);
  return res.text();
}

const clean = (s) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '');
const year = (s) => {
  const m = String(s ?? '').match(/(\d{4})/);
  return m ? Number(m[1]) : null;
};

/* ------------------------------------------------------------------ *
 * Books — Open Library, then Google Books
 * ------------------------------------------------------------------ */

async function openLibrary(query, hints) {
  // Structured `title=` / `author=` beats stuffing everything into `q=` by a mile: searching
  // "The Iliad Homer" as free text surfaces 16th-century Greek printings, while the structured
  // form returns the editions you would actually mean.
  const params = new URLSearchParams({
    title: query,
    limit: '8',
    fields: 'key,title,author_name,first_publish_year,number_of_pages_median,publisher,cover_i,subject,language',
  });
  if (hints.author) params.set('author', String(hints.author));

  const data = await getJson(`https://openlibrary.org/search.json?${params}`, {}, 'Open Library');

  return (data.docs ?? []).map((d) => ({
    id: `ol:${d.key}`,
    source: 'Open Library',
    title: clean(d.title),
    year: d.first_publish_year ?? null,
    coverUrl: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg` : null,
    url: `https://openlibrary.org${d.key}`,
    fields: {
      author: d.author_name ?? [],
      year: d.first_publish_year ?? null,
      pages: d.number_of_pages_median ?? null,
      publisher: d.publisher?.[0] ?? null,
      // Open Library subjects are a firehose; the first few are the useful ones.
      genre: (d.subject ?? []).slice(0, 6),
      language: d.language?.[0] ?? null,
    },
  }));
}

async function googleBooks(query, hints) {
  const q = [query, hints.author && `inauthor:${hints.author}`].filter(Boolean).join(' ');
  const data = await getJson(
    `https://www.googleapis.com/books/v1/volumes?maxResults=8&q=${encodeURIComponent(q)}`,
    {},
    'Google Books',
  );

  return (data.items ?? []).map((item) => {
    const v = item.volumeInfo ?? {};
    // Google's thumbnails come back over http and zoomed out; both are worth fixing.
    const thumb = (v.imageLinks?.thumbnail ?? '')
      .replace(/^http:/, 'https:')
      .replace(/&zoom=\d+/, '&zoom=1');
    return {
      id: `gb:${item.id}`,
      source: 'Google Books',
      title: clean(v.title),
      year: year(v.publishedDate),
      coverUrl: thumb || null,
      url: v.infoLink ?? null,
      fields: {
        author: v.authors ?? [],
        year: year(v.publishedDate),
        pages: v.pageCount ?? null,
        publisher: clean(v.publisher) || null,
        genre: v.categories ?? [],
        language: v.language ?? null,
        description: clean(v.description) || null,
      },
    };
  });
}

/* ------------------------------------------------------------------ *
 * Anime and manga — Jikan, which serves MyAnimeList's own data
 * ------------------------------------------------------------------ */

async function jikan(kind, query) {
  const data = await getJson(
    `https://api.jikan.moe/v4/${kind}?limit=8&q=${encodeURIComponent(query)}`,
    {},
    `jikan-${kind}`,
  );

  return (data.data ?? []).map((d) => {
    const common = {
      id: `mal:${kind}:${d.mal_id}`,
      source: 'MyAnimeList',
      title: clean(d.title_english || d.title),
      year: d.year ?? year(d.published?.from ?? d.aired?.from),
      coverUrl: d.images?.jpg?.large_image_url ?? d.images?.jpg?.image_url ?? null,
      url: d.url ?? null,
    };

    if (kind === 'anime') {
      return {
        ...common,
        fields: {
          studio: d.studios?.[0]?.name ?? null,
          genre: (d.genres ?? []).concat(d.themes ?? []).map((g) => g.name),
          episodes: d.episodes ?? null,
          year: common.year,
          season: d.season && d.year ? `${d.season[0].toUpperCase()}${d.season.slice(1)} ${d.year}` : null,
          source: d.source ? `${d.source[0].toUpperCase()}${d.source.slice(1)}` : null,
          description: clean(d.synopsis) || null,
        },
      };
    }

    return {
      ...common,
      fields: {
        author: (d.authors ?? []).map((a) => clean(a.name).split(', ').reverse().join(' ')),
        genre: (d.genres ?? []).concat(d.themes ?? []).map((g) => g.name),
        volumes: d.volumes ?? null,
        year: common.year,
        serialisation: d.status === 'Finished' ? 'Completed'
          : d.status === 'Publishing' ? 'Ongoing'
          : d.status ?? null,
        description: clean(d.synopsis) || null,
      },
    };
  });
}

/* ------------------------------------------------------------------ *
 * Films and TV — TMDB. Also carries the IMDb id, so entries can link out.
 * ------------------------------------------------------------------ */

async function tmdb(kind, query, hints, keys) {
  if (!keys.tmdbKey) {
    const err = new Error('Add a free TMDB key in Settings for film and TV lookups.');
    err.needsKey = 'tmdb';
    throw err;
  }

  const yearParam = hints.year ? `&${kind === 'movie' ? 'year' : 'first_air_date_year'}=${hints.year}` : '';
  const search = await getJson(
    `https://api.themoviedb.org/3/search/${kind}?api_key=${keys.tmdbKey}` +
    `&query=${encodeURIComponent(query)}${yearParam}`,
  );

  const top = (search.results ?? []).slice(0, 6);

  // One detail call per candidate, for credits and the IMDb id. Six small requests is fine.
  return Promise.all(top.map(async (r) => {
    let detail = {};
    try {
      detail = await getJson(
        `https://api.themoviedb.org/3/${kind}/${r.id}?api_key=${keys.tmdbKey}` +
        '&append_to_response=credits,external_ids',
      );
    } catch { /* the search result alone is still useful */ }

    const crew = detail.credits?.crew ?? [];
    const cast = (detail.credits?.cast ?? []).slice(0, 12);
    const imdbId = detail.external_ids?.imdb_id ?? detail.imdb_id ?? null;

    const base = {
      id: `tmdb:${kind}:${r.id}`,
      source: 'TMDB',
      title: clean(r.title || r.name),
      year: year(r.release_date || r.first_air_date),
      coverUrl: r.poster_path ? `https://image.tmdb.org/t/p/w780${r.poster_path}` : null,
      url: imdbId ? `https://www.imdb.com/title/${imdbId}/` : `https://www.themoviedb.org/${kind}/${r.id}`,
      imdbId,
    };

    const shared = {
      genre: (detail.genres ?? []).map((g) => g.name),
      cast: cast.map((c) => ({ name: clean(c.name), note: clean(c.character) || undefined })),
      characters: cast.map((c) => clean(c.character)).filter(Boolean).slice(0, 8),
      description: clean(r.overview) || null,
      imdb: imdbId ? `https://www.imdb.com/title/${imdbId}/` : null,
    };

    if (kind === 'movie') {
      return {
        ...base,
        fields: {
          ...shared,
          director: crew.filter((c) => c.job === 'Director').map((c) => clean(c.name)),
          year: base.year,
          runtime: detail.runtime ?? null,
          country: detail.production_countries?.[0]?.name ?? null,
          language: detail.original_language ?? null,
        },
      };
    }

    return {
      ...base,
      fields: {
        ...shared,
        creator: (detail.created_by ?? []).map((c) => clean(c.name)),
        firstAired: base.year,
        seasons: detail.number_of_seasons ?? null,
        episodes: detail.number_of_episodes ?? null,
        network: detail.networks?.[0]?.name ?? null,
      },
    };
  }));
}

/** IMDb ratings, which TMDB does not carry. */
async function omdbRating(imdbId, keys) {
  if (!keys.omdbKey || !imdbId) return null;
  try {
    const data = await getJson(`https://www.omdbapi.com/?apikey=${keys.omdbKey}&i=${imdbId}`);
    const rating = Number(data.imdbRating);
    return Number.isFinite(rating) ? rating : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * Games — IGDB, behind a free Twitch app
 * ------------------------------------------------------------------ */

let igdbToken = { value: null, expires: 0 };

async function igdbAuth(keys) {
  if (igdbToken.value && Date.now() < igdbToken.expires) return igdbToken.value;
  const data = await getJson(
    'https://id.twitch.tv/oauth2/token?grant_type=client_credentials' +
    `&client_id=${encodeURIComponent(keys.igdbClientId)}` +
    `&client_secret=${encodeURIComponent(keys.igdbClientSecret)}`,
    { method: 'POST' },
  );
  igdbToken = {
    value: data.access_token,
    // Expire a minute early rather than discover it mid-request.
    expires: Date.now() + Math.max(0, (data.expires_in ?? 3600) - 60) * 1000,
  };
  return igdbToken.value;
}

async function igdb(query, keys) {
  if (!keys.igdbClientId || !keys.igdbClientSecret) {
    const err = new Error('Add free IGDB (Twitch) credentials in Settings for game lookups.');
    err.needsKey = 'igdb';
    throw err;
  }
  const token = await igdbAuth(keys);

  const body =
    `search "${query.replace(/"/g, '')}"; ` +
    'fields name,first_release_date,summary,cover.image_id,genres.name,platforms.name,' +
    'involved_companies.company.name,involved_companies.developer,involved_companies.publisher,url; ' +
    'limit 8;';

  const res = await fetch('https://api.igdb.com/v4/games', {
    method: 'POST',
    headers: {
      'Client-ID': keys.igdbClientId,
      Authorization: `Bearer ${token}`,
      'User-Agent': UA,
    },
    body,
  });
  if (!res.ok) throw new Error(`IGDB ${res.status}`);
  const data = await res.json();

  return (data ?? []).map((g) => {
    const companies = g.involved_companies ?? [];
    return {
      id: `igdb:${g.id}`,
      source: 'IGDB',
      title: clean(g.name),
      year: g.first_release_date ? new Date(g.first_release_date * 1000).getFullYear() : null,
      coverUrl: g.cover?.image_id
        ? `https://images.igdb.com/igdb/image/upload/t_cover_big_2x/${g.cover.image_id}.jpg`
        : null,
      url: g.url ?? null,
      fields: {
        developer: companies.find((c) => c.developer)?.company?.name ?? null,
        publisher: companies.find((c) => c.publisher)?.company?.name ?? null,
        genre: (g.genres ?? []).map((x) => x.name),
        platform: (g.platforms ?? []).map((x) => x.name),
        year: g.first_release_date ? new Date(g.first_release_date * 1000).getFullYear() : null,
        description: clean(g.summary) || null,
      },
    };
  });
}

/* ------------------------------------------------------------------ *
 * Board games — BoardGameGeek, which speaks XML and nothing else
 * ------------------------------------------------------------------ */

const xmlValue = (xml, attr) => {
  const m = xml.match(new RegExp(`${attr}="([^"]*)"`));
  return m ? m[1] : null;
};

function decodeEntities(s) {
  return String(s ?? '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

async function boardGameGeek(query) {
  const searchXml = await getText(
    `https://boardgamegeek.com/xmlapi2/search?type=boardgame&query=${encodeURIComponent(query)}`,
    'bgg',
  );
  const ids = [...searchXml.matchAll(/<item[^>]*id="(\d+)"/g)].map((m) => m[1]).slice(0, 6);
  if (!ids.length) return [];

  const xml = await getText(`https://boardgamegeek.com/xmlapi2/thing?id=${ids.join(',')}&stats=1`, 'bgg');
  const items = xml.split('<item ').slice(1);

  return items.map((chunk) => {
    const id = xmlValue(chunk, 'id');
    const nameMatch = chunk.match(/<name[^>]*type="primary"[^>]*value="([^"]*)"/);
    const categories = [...chunk.matchAll(/<link[^>]*type="boardgamecategory"[^>]*value="([^"]*)"/g)].map((m) => decodeEntities(m[1]));
    const mechanics = [...chunk.matchAll(/<link[^>]*type="boardgamemechanic"[^>]*value="([^"]*)"/g)].map((m) => decodeEntities(m[1]));
    const designers = [...chunk.matchAll(/<link[^>]*type="boardgamedesigner"[^>]*value="([^"]*)"/g)].map((m) => decodeEntities(m[1]));
    const publishers = [...chunk.matchAll(/<link[^>]*type="boardgamepublisher"[^>]*value="([^"]*)"/g)].map((m) => decodeEntities(m[1]));
    const imageMatch = chunk.match(/<image>([^<]*)<\/image>/);
    const descMatch = chunk.match(/<description>([\s\S]*?)<\/description>/);
    const minP = xmlValue(chunk, 'minplayers');
    const maxP = xmlValue(chunk, 'maxplayers');
    const weightMatch = chunk.match(/<averageweight[^>]*value="([\d.]+)"/);

    return {
      id: `bgg:${id}`,
      source: 'BoardGameGeek',
      title: decodeEntities(nameMatch?.[1] ?? ''),
      year: Number(xmlValue(chunk, 'yearpublished')) || null,
      coverUrl: imageMatch?.[1] ?? null,
      url: `https://boardgamegeek.com/boardgame/${id}`,
      fields: {
        designer: designers.slice(0, 4),
        publisher: publishers[0] ?? null,
        players: minP && maxP ? (minP === maxP ? minP : `${minP}–${maxP}`) : null,
        playTime: Number(xmlValue(chunk, 'playingtime')) || null,
        // BGG weight is 1–5; the app's rating field is 0–10 in half steps.
        weight: weightMatch ? Math.round(Number(weightMatch[1]) * 2) : null,
        mechanics: mechanics.slice(0, 8),
        genre: categories.slice(0, 6),
        year: Number(xmlValue(chunk, 'yearpublished')) || null,
        description: decodeEntities(descMatch?.[1] ?? '').replace(/<[^>]+>/g, '').slice(0, 1200) || null,
      },
    };
  }).filter((r) => r.title);
}

/* ------------------------------------------------------------------ *
 * Dispatch
 * ------------------------------------------------------------------ */

/** Which sources suit which built-in category, best first. */
const SOURCES = {
  books: ['openlibrary', 'googlebooks'],
  movies: ['tmdb-movie'],
  tv: ['tmdb-tv'],
  anime: ['jikan-anime'],
  manga: ['jikan-manga'],
  games: ['igdb'],
  boardgames: ['bgg'],
};

const ALL_SOURCES = [
  { id: 'openlibrary', label: 'Open Library', needsKey: null },
  { id: 'googlebooks', label: 'Google Books', needsKey: null },
  { id: 'jikan-anime', label: 'MyAnimeList — anime', needsKey: null },
  { id: 'jikan-manga', label: 'MyAnimeList — manga', needsKey: null },
  // BGG began requiring authentication on its XML API; kept listed so the failure explains
  // itself rather than looking like the app is broken.
  { id: 'bgg', label: 'BoardGameGeek (needs an account)', needsKey: null },
  { id: 'tmdb-movie', label: 'TMDB — films', needsKey: 'tmdb' },
  { id: 'tmdb-tv', label: 'TMDB — TV', needsKey: 'tmdb' },
  { id: 'igdb', label: 'IGDB — games', needsKey: 'igdb' },
];

function runSource(source, query, hints, keys) {
  switch (source) {
    case 'openlibrary': return openLibrary(query, hints);
    case 'googlebooks': return googleBooks(query, hints);
    case 'jikan-anime': return jikan('anime', query);
    case 'jikan-manga': return jikan('manga', query);
    case 'tmdb-movie': return tmdb('movie', query, hints, keys);
    case 'tmdb-tv': return tmdb('tv', query, hints, keys);
    case 'igdb': return igdb(query, keys);
    case 'bgg': return boardGameGeek(query);
    default: return Promise.resolve([]);
  }
}

/**
 * Search for a title.
 *
 * @param {string} categoryId  used to pick sensible sources when none is forced
 * @param {string} query       the title
 * @param {object} hints       already-filled values that narrow the search (author, year)
 * @param {object} keys        the user's optional API keys
 * @param {string|null} force  a specific source id, when the user overrides
 */
async function search(categoryId, query, hints = {}, keys = {}, force = null) {
  const trimmed = String(query ?? '').trim();
  if (!trimmed) return { results: [], notes: ['Give the entry a title first.'], sources: ALL_SOURCES };

  const sources = force ? [force] : (SOURCES[categoryId] ?? ['openlibrary', 'googlebooks']);
  const notes = [];
  const results = [];

  for (const source of sources) {
    try {
      const found = await runSource(source, trimmed, hints, keys);
      results.push(...found.filter((r) => r && r.title));
    } catch (err) {
      // humanise() already names the service, so prefixing the source id would read twice.
      notes.push(err.message);
    }
  }

  // Enrich films and shows with their IMDb rating when a key is present.
  if (keys.omdbKey) {
    await Promise.all(results.map(async (r) => {
      if (!r.imdbId) return;
      const rating = await omdbRating(r.imdbId, keys);
      if (rating != null) r.fields.imdbRating = rating;
    }));
  }

  return { results: results.slice(0, 16), notes, sources: ALL_SOURCES };
}

/** Fetch cover bytes so the renderer never has to make a network request itself. */
async function fetchImage(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const type = res.headers.get('content-type') ?? '';
    if (!type.startsWith('image/')) throw new Error('That link is not an image.');
    const buffer = Buffer.from(await res.arrayBuffer());
    if (!buffer.length) throw new Error('The image came back empty.');
    const ext = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg';
    return { bytes: buffer, ext };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { search, fetchImage, ALL_SOURCES, SOURCES };
