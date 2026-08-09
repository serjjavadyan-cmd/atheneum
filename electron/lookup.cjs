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
 * Books — Apple Books first
 *
 * Measured against the alternatives: Apple returns 784x1200 artwork where Open Library tops
 * out at 333x500 and the Google Books API thumbnail is about 128px. It also returns the
 * edition a person means — Fagles and Fitzgerald for the Iliad, rather than a 1946 reprint —
 * and finds "Meno" by Plato, which Open Library misses without an author hint.
 *
 * Open Library is kept as a second source because Apple has no page count or publisher, and
 * the merge below combines them into one candidate.
 * ------------------------------------------------------------------ */

/** Apple serves artwork at whatever size you ask for by rewriting the path segment. */
function appleArtwork(url, size = 1200) {
  if (!url) return null;
  return url.replace(/\/\d+x\d+bb\./, `/${size}x${size}bb.`);
}

async function appleBooks(query, hints) {
  const term = [query, hints.author].filter(Boolean).join(' ');
  const data = await getJson(
    `https://itunes.apple.com/search?media=ebook&limit=8&term=${encodeURIComponent(term)}`,
    {},
    'Apple Books',
  );

  return (data.results ?? []).map((r) => ({
    id: `apple:${r.trackId}`,
    source: 'Apple Books',
    title: clean(r.trackName),
    year: year(r.releaseDate),
    coverUrl: appleArtwork(r.artworkUrl100),
    url: r.trackViewUrl ?? null,
    fields: {
      // "Homer, Robert Fagles & Bernard Knox" is a display string, not a list.
      author: clean(r.artistName).split(/,\s*|\s&\s/).filter(Boolean),
      year: year(r.releaseDate),
      // Apple's genre list ends with shelf categories like "Books" that say nothing.
      genre: (r.genres ?? []).filter((g) => !/^(Books|Fiction & Literature|Nonfiction)$/i.test(g)),
      description: clean(String(r.description ?? '').replace(/<[^>]+>/g, '')) || null,
    },
  }));
}

/* ------------------------------------------------------------------ *
 * Open Library and Google Books
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
 * Anime and manga — AniList first
 *
 * Chosen over MyAnimeList on measurement: bigger artwork (460x695 against roughly 425x600),
 * cleaner matching, and it stays up. Jikan depends on MyAnimeList being reachable and reports
 * its outages as a 504; it was down every time this was tested. Jikan remains as a fallback
 * because it occasionally has a title AniList doesn't.
 *
 * No key, 30 requests a minute.
 * ------------------------------------------------------------------ */

const ANILIST_QUERY = `
query ($search: String, $type: MediaType) {
  Page(perPage: 8) {
    media(search: $search, type: $type, sort: SEARCH_MATCH) {
      id
      title { romaji english }
      startDate { year }
      seasonYear season format status episodes chapters volumes averageScore genres
      description(asHtml: false)
      source
      siteUrl
      studios(isMain: true) { nodes { name } }
      staff(perPage: 4) { edges { role node { name { full } } } }
      characters(perPage: 8, sort: ROLE) { nodes { name { full } } }
      coverImage { extraLarge large }
    }
  }
}`;

async function anilist(kind, query) {
  const res = await request(
    'https://graphql.anilist.co',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        query: ANILIST_QUERY,
        variables: { search: query, type: kind === 'anime' ? 'ANIME' : 'MANGA' },
      }),
    },
    'AniList',
  );
  const body = await res.json();
  if (body.errors?.length) throw new Error(`AniList: ${body.errors[0].message}`);

  const capitalise = (s) => (s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : null);

  return (body.data?.Page?.media ?? []).map((m) => {
    const staff = m.staff?.edges ?? [];
    const pick = (re) => staff.filter((e) => re.test(e.role ?? '')).map((e) => clean(e.node.name.full));
    const characters = (m.characters?.nodes ?? []).map((c) => clean(c.name.full)).filter(Boolean);
    // AniList descriptions carry <br> and <i> even when asHtml is false.
    const description = clean(String(m.description ?? '').replace(/<[^>]+>/g, ' ')) || null;
    const yr = m.seasonYear ?? m.startDate?.year ?? null;

    const common = {
      id: `anilist:${kind}:${m.id}`,
      source: 'AniList',
      title: clean(m.title.english || m.title.romaji),
      year: yr,
      coverUrl: m.coverImage?.extraLarge ?? m.coverImage?.large ?? null,
      url: m.siteUrl ?? null,
    };

    if (kind === 'anime') {
      return {
        ...common,
        fields: {
          studio: m.studios?.nodes?.[0]?.name ?? null,
          director: pick(/director/i),
          genre: m.genres ?? [],
          episodes: m.episodes ?? null,
          year: yr,
          season: m.season && yr ? `${capitalise(m.season)} ${yr}` : null,
          source: m.source ? capitalise(String(m.source).replace(/_/g, ' ')) : null,
          characters,
          description,
        },
      };
    }

    return {
      ...common,
      fields: {
        author: pick(/story|original/i).length ? pick(/story|original/i) : pick(/./),
        artist: pick(/art/i),
        genre: m.genres ?? [],
        volumes: m.volumes ?? null,
        year: yr,
        serialisation: m.status === 'FINISHED' ? 'Completed'
          : m.status === 'RELEASING' ? 'Ongoing'
          : m.status === 'HIATUS' ? 'Hiatus'
          : m.status === 'CANCELLED' ? 'Cancelled'
          : null,
        characters,
        description,
      },
    };
  });
}

/* ------------------------------------------------------------------ *
 * Jikan — MyAnimeList's data, kept as a fallback behind AniList
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
  books: ['applebooks', 'openlibrary'],
  movies: ['tmdb-movie'],
  tv: ['tmdb-tv'],
  anime: ['anilist-anime', 'jikan-anime'],
  manga: ['anilist-manga', 'jikan-manga'],
  games: ['igdb'],
  boardgames: ['bgg'],
};

const ALL_SOURCES = [
  { id: 'applebooks', label: 'Apple Books', needsKey: null },
  { id: 'openlibrary', label: 'Open Library', needsKey: null },
  { id: 'googlebooks', label: 'Google Books', needsKey: null },
  { id: 'anilist-anime', label: 'AniList — anime', needsKey: null },
  { id: 'anilist-manga', label: 'AniList — manga', needsKey: null },
  { id: 'jikan-anime', label: 'MyAnimeList — anime', needsKey: null },
  { id: 'jikan-manga', label: 'MyAnimeList — manga', needsKey: null },
  // BGG began requiring authentication on its XML API; kept listed so the failure explains
  // itself rather than looking like the app is broken.
  { id: 'bgg', label: 'BoardGameGeek (needs an account)', needsKey: null },
  { id: 'tmdb-movie', label: 'TMDB — films', needsKey: 'tmdb' },
  { id: 'tmdb-tv', label: 'TMDB — TV', needsKey: 'tmdb' },
  { id: 'igdb', label: 'IGDB — games', needsKey: 'igdb' },
];

/**
 * How good each source's artwork is, measured rather than guessed. When two sources describe
 * the same thing, the cover comes from whichever scores highest here regardless of which one
 * supplied the rest of the data.
 */
const COVER_QUALITY = {
  'Apple Books': 100,   // 784x1200
  TMDB: 90,             // w780
  IGDB: 85,             // t_cover_big_2x
  AniList: 80,          // 460x695
  MyAnimeList: 60,      // ~425x600
  BoardGameGeek: 55,
  'Open Library': 40,   // 333x500
  'Google Books': 10,   // ~128px
};

function runSource(source, query, hints, keys) {
  switch (source) {
    case 'applebooks': return appleBooks(query, hints);
    case 'openlibrary': return openLibrary(query, hints);
    case 'googlebooks': return googleBooks(query, hints);
    case 'anilist-anime': return anilist('anime', query);
    case 'anilist-manga': return anilist('manga', query);
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
/** Normalise a title enough to recognise the same work described by two different services. */
function titleKey(title, yr) {
  const t = String(title ?? '')
    .toLowerCase()
    .replace(/[’'`]/g, '')
    .replace(/^(the|a|an)\s+/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return `${t}::${yr ?? ''}`;
}

/**
 * Fold results describing the same thing into one candidate.
 *
 * Without this, searching a book shows the Apple edition and the Open Library edition as two
 * near-identical cards, and picking the wrong one costs you either the good cover or the page
 * count. Merged, one card carries the best artwork available and the union of the metadata.
 */
function mergeResults(results) {
  const byKey = new Map();

  for (const r of results) {
    // Match on title alone rather than title+year, since services disagree about which year a
    // work belongs to — first publication, this edition, or this printing.
    const loose = titleKey(r.title, '');
    const existing = byKey.get(loose);

    // Only ever merge *across* services. Two hits from the same one are two real editions,
    // and collapsing them would hide the choice between, say, Fagles and Fitzgerald.
    if (!existing || existing.sources.includes(r.source)) {
      if (!existing) byKey.set(loose, { ...r, sources: [r.source] });
      else byKey.set(`${loose}#${byKey.size}`, { ...r, sources: [r.source] });
      continue;
    }

    existing.sources.push(r.source);

    // Fill only the gaps: the first source to answer is the higher-priority one.
    for (const [key, value] of Object.entries(r.fields)) {
      const held = existing.fields[key];
      const heldEmpty = held == null || held === '' || (Array.isArray(held) && !held.length);
      const incomingUseful = value != null && value !== '' && (!Array.isArray(value) || value.length);
      if (heldEmpty && incomingUseful) existing.fields[key] = value;
    }

    // The cover is chosen on measured quality, not on who answered first.
    const mine = COVER_QUALITY[existing.source] ?? 50;
    const theirs = COVER_QUALITY[r.source] ?? 50;
    if (r.coverUrl && (!existing.coverUrl || theirs > mine)) {
      existing.coverUrl = r.coverUrl;
      existing.source = r.source;
    }
    existing.year = existing.year ?? r.year;
    existing.url = existing.url ?? r.url;
    existing.imdbId = existing.imdbId ?? r.imdbId;
  }

  return [...byKey.values()];
}

/** Edit distance, capped to what's needed for short titles. */
function distance(a, b) {
  if (a === b) return 0;
  if (!a.length || !b.length) return Math.max(a.length, b.length);
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        prev[j] + 1,
        row[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = row;
  }
  return prev[b.length];
}

const normaliseTitle = (s) => String(s ?? '')
  .toLowerCase().replace(/[’'`]/g, '').replace(/^(the|a|an)\s+/, '')
  .replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Order candidates by how well they answer what was actually typed.
 *
 * Services return their own idea of relevance, which for "Illiad" put a 2026 omnibus and a
 * copy of the Odyssey above the Iliad itself. Scoring on closeness to the query — tolerant of
 * the typo, penalising titles that are much longer than what was asked for — fixes that
 * without needing the query to be spelled correctly.
 */
function rankResults(results, query) {
  const q = normaliseTitle(query);

  const score = (r) => {
    const t = normaliseTitle(r.title);
    let s = 0;

    if (t === q) s += 100;
    else {
      const d = distance(q, t);
      // A near-miss on a short title is a typo; a long title is a different work.
      s += Math.max(0, 60 - d * 8);
      if (t.startsWith(q)) s += 25;
      else if (t.includes(q)) s += 15;
      // Extra words beyond the query are usually omnibus editions or companions.
      s -= Math.min(30, Math.max(0, t.split(' ').length - q.split(' ').length) * 5);
    }

    if (r.coverUrl) s += 20;
    if (r.sources.length > 1) s += 8; // corroborated by more than one service
    s += Math.min(10, Object.values(r.fields).filter((v) => v != null && v !== '' && (!Array.isArray(v) || v.length)).length);
    return s;
  };

  return [...results].sort((a, b) => score(b) - score(a));
}

async function search(categoryId, query, hints = {}, keys = {}, force = null) {
  const trimmed = String(query ?? '').trim();
  if (!trimmed) return { results: [], notes: ['Give the entry a title first.'], sources: ALL_SOURCES };

  const sources = force ? [force] : (SOURCES[categoryId] ?? ['applebooks', 'openlibrary']);
  const notes = [];
  const collected = [];

  for (const source of sources) {
    try {
      const found = await runSource(source, trimmed, hints, keys);
      collected.push(...found.filter((r) => r && r.title));
    } catch (err) {
      // humanise() already names the service, so prefixing the source id would read twice.
      notes.push(err.message);
    }
    // Once a good source has answered well there is no need to bother the weaker ones.
    if (!force && collected.length >= 6) break;
  }

  const results = rankResults(mergeResults(collected), trimmed);

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

/**
 * Read pixel dimensions straight from the file header.
 *
 * Needed because a "successful" download is not the same as a usable cover: Open Library
 * answers a missing cover with a valid 43-byte 1x1 image and a perfectly good content-type,
 * which would otherwise be stored and shown as a blank card.
 */
function imageDimensions(buf) {
  // Each format is checked against its own minimum. A single blanket length guard would
  // reject a perfectly readable short header — a 1x1 GIF placeholder is only 43 bytes.
  if (buf.length < 10) return null;

  // PNG
  if (buf.length >= 24 && buf.readUInt32BE(0) === 0x89504e47) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  // GIF
  if (buf.slice(0, 3).toString('ascii') === 'GIF') {
    return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  }
  // WebP (VP8X / VP8 / VP8L all start RIFF....WEBP)
  if (buf.length >= 30 && buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') {
    const chunk = buf.slice(12, 16).toString('ascii');
    if (chunk === 'VP8X') return { width: (buf.readUIntLE(24, 3) & 0xffffff) + 1, height: (buf.readUIntLE(27, 3) & 0xffffff) + 1 };
    if (chunk === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  }
  // JPEG: walk the segments to the start-of-frame marker.
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    // Reading the frame needs bytes up to i+8, so i may go as far as length-9 inclusive.
    while (i <= buf.length - 9) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      const len = buf.readUInt16BE(i + 2);
      if (len <= 0) break;
      i += 2 + len;
    }
  }
  return null;
}

/** Narrower than this and it is a placeholder or a thumbnail, not a cover. */
const MIN_COVER_WIDTH = 200;

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

    const size = imageDimensions(buffer);
    if (size && size.width < MIN_COVER_WIDTH) {
      throw new Error(
        `That source has no real cover for this — it returned a ${size.width}×${size.height} placeholder.`,
      );
    }

    const ext = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg';
    return { bytes: buffer, ext, width: size?.width ?? 0, height: size?.height ?? 0 };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  search, fetchImage, ALL_SOURCES, SOURCES,
  // Exported for scripts/test-lookup.cjs — pure, so they can be tested without the network.
  mergeResults, rankResults, imageDimensions, appleArtwork, humanise, MIN_COVER_WIDTH,
};
