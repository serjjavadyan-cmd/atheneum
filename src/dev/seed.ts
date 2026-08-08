import { useStore } from '../store';
import { importImageFile } from '../lib/images';
import { isoDate, uid } from '../lib/util';
import type { Person } from '../types';

/**
 * Development-only sample library, reachable at `?seed`.
 *
 * It exists so the design can be judged against real content — a grid of covers with
 * different dominant colours is the only honest way to check whether the ambient tint
 * idea actually works. Never bundled into a production build.
 */

const people = (...names: string[]): Person[] => names.map((n) => ({ id: uid(), name: n }));

interface Seed {
  category: string;
  title: string;
  colors: [string, string];
  rating: number;
  status: number;
  favorite?: boolean;
  values: Record<string, unknown>;
  notes?: string;
}

const SEEDS: Seed[] = [
  {
    category: 'books', title: 'Piranesi', colors: ['#1b3a5c', '#8fb8d8'],
    rating: 10, status: 2, favorite: true,
    values: {
      author: people('Susanna Clarke'), genre: ['Fantasy', 'Literary fiction'],
      year: 2020, pages: 245, publisher: 'Bloomsbury',
      characters: people('Piranesi', 'The Other', '16'),
      description: 'A man lives in an infinite house of statues and tides, keeping a careful journal of a world he does not question.',
    },
    notes: 'The kindest book about loneliness I have ever read. The tides do something to me.',
  },
  {
    category: 'books', title: 'The Left Hand of Darkness', colors: ['#0d2b2b', '#7fd4c1'],
    rating: 9, status: 2,
    values: {
      author: people('Ursula K. Le Guin'), genre: ['Sci-fi', 'Classic'],
      year: 1969, pages: 304, characters: people('Genly Ai', 'Estraven'),
      description: 'An envoy on a frozen world learns what it costs to be understood.',
    },
  },
  {
    category: 'books', title: 'Pachinko', colors: ['#5c1f24', '#e0a05a'],
    rating: 8, status: 2,
    values: {
      author: people('Min Jin Lee'), genre: ['Historical', 'Literary fiction'],
      year: 2017, pages: 490,
    },
  },
  {
    category: 'books', title: 'The Wind-Up Bird Chronicle', colors: ['#2a2440', '#b9a3e3'],
    rating: 7, status: 1,
    values: { author: people('Haruki Murakami'), genre: ['Literary fiction', 'Fantasy'], year: 1994, pages: 607 },
  },
  {
    category: 'books', title: 'Braiding Sweetgrass', colors: ['#243d1c', '#a8cf72'],
    rating: 9, status: 2,
    values: { author: people('Robin Wall Kimmerer'), genre: ['Non-fiction', 'Essays'], year: 2013, pages: 391 },
  },
  {
    category: 'books', title: 'Tomorrow, and Tomorrow, and Tomorrow', colors: ['#123a4a', '#5fc9d6'],
    rating: 8, status: 0,
    values: { author: people('Gabrielle Zevin'), genre: ['Contemporary'], year: 2022, pages: 401 },
  },

  {
    category: 'movies', title: 'In the Mood for Love', colors: ['#4a0f1e', '#d4526e'],
    rating: 10, status: 2, favorite: true,
    values: {
      director: people('Wong Kar-wai'), genre: ['Drama', 'Romance'], year: 2000,
      cast: [{ id: uid(), name: 'Maggie Cheung', note: 'Su Li-zhen' }, { id: uid(), name: 'Tony Leung', note: 'Chow Mo-wan' }],
      runtime: 98, country: 'Hong Kong',
      description: 'Two neighbours discover their spouses are having an affair, and build something quieter and more devastating in response.',
    },
    notes: 'Every frame is a held breath.',
  },
  {
    category: 'movies', title: 'Arrival', colors: ['#14232e', '#79a8c4'],
    rating: 9, status: 2,
    values: {
      director: people('Denis Villeneuve'), genre: ['Sci-fi', 'Drama'], year: 2016,
      cast: [{ id: uid(), name: 'Amy Adams', note: 'Louise Banks' }],
      runtime: 116,
    },
  },
  {
    category: 'movies', title: 'Portrait of a Lady on Fire', colors: ['#2e1810', '#e08b4a'],
    rating: 10, status: 2, favorite: true,
    values: {
      director: people('Céline Sciamma'), genre: ['Drama', 'Romance'], year: 2019, runtime: 122,
      cast: people('Noémie Merlant', 'Adèle Haenel'),
    },
  },
  {
    category: 'movies', title: 'Paprika', colors: ['#3d0f38', '#f06fc4'],
    rating: 8, status: 2,
    values: { director: people('Satoshi Kon'), genre: ['Animation', 'Sci-fi'], year: 2006, runtime: 90 },
  },
  {
    category: 'movies', title: 'Dune: Part Two', colors: ['#4a3410', '#e6b45c'],
    rating: 8, status: 0,
    values: { director: people('Denis Villeneuve'), genre: ['Sci-fi', 'Adventure'], year: 2024, runtime: 166 },
  },

  {
    category: 'tv', title: 'Severance', colors: ['#0f2038', '#6fa8dc'],
    rating: 10, status: 1, favorite: true,
    values: {
      creator: people('Dan Erickson'), genre: ['Drama', 'Sci-fi', 'Thriller'],
      firstAired: 2022, seasons: 2, network: 'Apple TV+',
      characters: people('Mark S.', 'Helly R.', 'Irving B.', 'Dylan G.'),
    },
  },
  {
    category: 'tv', title: 'Fleabag', colors: ['#5c1010', '#e26d6d'],
    rating: 10, status: 2,
    values: { creator: people('Phoebe Waller-Bridge'), genre: ['Comedy', 'Drama'], firstAired: 2016, seasons: 2 },
  },
  {
    category: 'tv', title: 'The Bear', colors: ['#123020', '#63c98a'],
    rating: 9, status: 1,
    values: { creator: people('Christopher Storer'), genre: ['Drama', 'Comedy'], firstAired: 2022, seasons: 3 },
  },

  {
    category: 'manga', title: 'Vinland Saga', colors: ['#1c2f42', '#8fb0cc'],
    rating: 10, status: 1, favorite: true,
    values: {
      author: people('Makoto Yukimura'), genre: ['Seinen', 'Action'],
      volumes: 28, volumesRead: 14, serialisation: 'Ongoing', year: 2005,
      characters: people('Thorfinn', 'Askeladd', 'Canute'),
    },
  },
  {
    category: 'manga', title: 'Witch Hat Atelier', colors: ['#2b1a42', '#b98fe0'],
    rating: 9, status: 1,
    values: { author: people('Kamome Shirahama'), genre: ['Shōnen', 'Fantasy'], volumes: 13, volumesRead: 9, serialisation: 'Ongoing' },
  },
  {
    category: 'manga', title: 'A Silent Voice', colors: ['#123a3a', '#72cfc4'],
    rating: 9, status: 2,
    values: { author: people('Yoshitoki Ōima'), genre: ['Shōnen', 'Slice of life'], volumes: 7, volumesRead: 7, serialisation: 'Completed' },
  },

  {
    category: 'games', title: 'Outer Wilds', colors: ['#3d2410', '#e5a15c'],
    rating: 10, status: 2, favorite: true,
    values: {
      developer: 'Mobius Digital', platform: ['PC'], genre: ['Adventure', 'Puzzle'],
      year: 2019, hours: 32,
      description: 'Twenty-two minutes at a time, a solar system tells you what happened to it.',
    },
    notes: 'I would give anything to play it again for the first time.',
  },
  {
    category: 'games', title: 'Hollow Knight', colors: ['#101a30', '#7d9fd6'],
    rating: 9, status: 2,
    values: { developer: 'Team Cherry', platform: ['Switch', 'PC'], genre: ['Metroidvania'], year: 2017, hours: 61 },
  },
  {
    category: 'games', title: 'Disco Elysium', colors: ['#3a2020', '#d68f6f'],
    rating: 10, status: 1,
    values: { developer: 'ZA/UM', platform: ['PC'], genre: ['RPG'], year: 2019, hours: 24 },
  },
  {
    category: 'games', title: 'Stardew Valley', colors: ['#1e3a16', '#8fd166'],
    rating: 8, status: 1,
    values: { developer: 'ConcernedApe', platform: ['Switch', 'PC'], genre: ['Simulation'], year: 2016, hours: 140 },
  },

  {
    category: 'boardgames', title: 'Wingspan', colors: ['#2b3d14', '#b6d16f'],
    rating: 9, status: 2,
    values: { designer: people('Elizabeth Hargrave'), publisher: 'Stonemaier', players: '1–5', playTime: 70, weight: 5 },
  },
  {
    category: 'boardgames', title: 'Spirit Island', colors: ['#123832', '#63c4ae'],
    rating: 10, status: 2, favorite: true,
    values: { designer: people('R. Eric Reuss'), publisher: 'Greater Than Games', players: '1–4', playTime: 120, weight: 8, mechanics: ['Co-op', 'Area control'] },
  },
  {
    category: 'boardgames', title: 'Azul', colors: ['#152a4a', '#6f9fd8'],
    rating: 8, status: 2,
    values: { designer: people('Michael Kiesling'), players: '2–4', playTime: 35, weight: 3, mechanics: ['Drafting', 'Tile-laying'] },
  },

  {
    category: 'cities', title: 'Lisbon', colors: ['#4a3a12', '#f0cf7a'],
    rating: 9, status: 1, favorite: true,
    values: {
      country: 'Portugal', region: 'Estremadura', wouldReturn: true,
      highlights: 'The 28 tram at dawn before anyone else is awake. Pastéis in Belém. The view from Graça with a beer going warm in my hand.',
      food: 'Bifana. Too many pastéis de nata to admit to.',
    },
  },
  {
    category: 'cities', title: 'Kyoto', colors: ['#3a1420', '#e07a9a'],
    rating: 10, status: 1,
    values: {
      country: 'Japan', wouldReturn: true,
      highlights: 'Walking the Philosopher\'s Path in the rain. The moss at Gio-ji.',
    },
  },
  {
    category: 'cities', title: 'Reykjavík', colors: ['#14283a', '#78b4d8'],
    rating: 8, status: 1,
    values: { country: 'Iceland', wouldReturn: true, highlights: 'The light never quite left.' },
  },
  {
    category: 'cities', title: 'Sarajevo', colors: ['#2e2814', '#c9b46f'],
    rating: 0, status: 0,
    values: { country: 'Bosnia and Herzegovina' },
  },
];

const DIARY = [
  { back: 0, mood: 'Quiet', body: 'Finished Piranesi on the balcony with the last of the light. Sat there a while afterwards not doing anything.\n\nI keep thinking about the statue of the faun.' },
  { back: 1, mood: 'Content', body: 'Long walk, no podcast, no music. Just the noise of the street.\n\nStarted Vinland Saga volume 14 on the tram home.' },
  { back: 2, mood: 'Restless', body: 'Could not settle on anything all evening. Started three things, finished none of them.' },
  { back: 4, mood: 'Alive', body: 'Spirit Island with M and J and we actually won, on level 3, with about four minutes left on the clock. Shouting at a board game at eleven at night like children.' },
  { back: 7, mood: 'Melancholy', body: 'Rewatched In the Mood for Love. Same feeling, every time — like being shown something through a doorway you are not allowed through.' },
  { back: 9, mood: 'Tired', body: 'Nothing much. Soup, a bath, bed at nine.' },
];

/** Draw a cover: a two-colour field with a large initial. Enough to exercise tint sampling. */
async function makeCover(title: string, [a, b]: [string, string], wide: boolean): Promise<File> {
  const w = wide ? 900 : 600;
  const h = wide ? 600 : 900;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  const grad = ctx.createLinearGradient(0, 0, w * 0.6, h);
  grad.addColorStop(0, a);
  grad.addColorStop(1, b);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // A soft vignette and a light bloom, so the sampler sees a real range of tones.
  const bloom = ctx.createRadialGradient(w * 0.72, h * 0.22, 0, w * 0.72, h * 0.22, w * 0.8);
  bloom.addColorStop(0, 'rgba(255,255,255,0.28)');
  bloom.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = bloom;
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.font = `${Math.round(h * 0.3)}px Georgia, serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(title[0].toUpperCase(), w / 2, h * 0.46);

  ctx.fillStyle = 'rgba(255,255,255,0.72)';
  ctx.font = `${Math.round(h * 0.036)}px Georgia, serif`;
  const line = title.length > 30 ? `${title.slice(0, 29)}…` : title;
  ctx.fillText(line, w / 2, h * 0.82);

  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.86));
  return new File([blob!], 'cover.jpg', { type: 'image/jpeg' });
}

export async function seedLibrary(): Promise<void> {
  const store = useStore.getState();
  if (store.db.entries.length > 0) {
    console.info('[seed] library already has entries — skipping.');
    return;
  }

  for (const s of SEEDS) {
    const id = store.createEntry(s.category, s.title);
    const wide = s.category === 'cities';
    try {
      const file = await makeCover(s.title, s.colors, wide);
      const image = await importImageFile(file);
      useStore.getState().addImage(id, image);
    } catch (e) {
      console.warn('[seed] cover failed for', s.title, e);
    }

    useStore.getState().updateEntry(id, {
      rating: s.rating,
      status: s.status,
      favorite: Boolean(s.favorite),
      notes: s.notes ?? '',
      dateFinished: s.status === 2 ? isoDate(new Date(Date.now() - Math.random() * 2e10)) : null,
    });
    for (const [key, value] of Object.entries(s.values)) {
      useStore.getState().setValue(id, key, value as never);
    }
  }

  // Diary days, with a couple linked to what was being read that day.
  const entries = useStore.getState().db.entries;
  const find = (t: string) => entries.find((e) => e.title === t)?.id;
  const links: Record<number, string[]> = {
    0: [find('Piranesi')].filter(Boolean) as string[],
    1: [find('Vinland Saga')].filter(Boolean) as string[],
    4: [find('Spirit Island')].filter(Boolean) as string[],
    7: [find('In the Mood for Love')].filter(Boolean) as string[],
  };

  DIARY.forEach((d) => {
    const date = isoDate(new Date(Date.now() - d.back * 86400000));
    const id = useStore.getState().createDiaryDay(date);
    useStore.getState().updateDiaryDay(id, {
      mood: d.mood,
      body: d.body,
      linkedEntryIds: links[d.back] ?? [],
    });
  });

  console.info(`[seed] added ${SEEDS.length} entries and ${DIARY.length} diary days.`);
}
