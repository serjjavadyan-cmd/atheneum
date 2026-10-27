# Atheneum

A private catalogue for everything you read, watch, play and visit — plus a daily diary.
Offline, yours, on both your computers.

---

## Running it

**Installed** — double-click Atheneum in the Start menu (Windows) or the Dock (macOS).

**From source**, while it's still being worked on:

```
npm install
npm run dev
```

That opens the app window. `Ctrl+C` in the terminal closes everything.

| command | what it does |
| --- | --- |
| `npm run dev` | The real app window, against a live-reloading UI |
| `npm run dev:web` | Just the UI in a browser tab, no Electron. Add `?seed` for a sample library |
| `npm test` | All three suites. Run before trusting a change to merging or auto-fill |
| `npm run build:win` | Builds `release/Atheneum Setup <version>.exe` |
| `npm run build:mac` | Builds `release/Atheneum-<version>.dmg` |

---

## Getting it onto the MacBook

Electron can't cross-build, so the `.dmg` has to be made on the Mac itself. Once:

```
git clone <your-private-repo-url> Atheneum
cd Atheneum
npm install
npm run build:mac
```

The installer lands in `release/`. Open it and drag Atheneum to Applications.

Builds are **unsigned** — signing needs a paid Apple developer account — but what that
costs you depends entirely on how the file reached the Mac:

- **Built on that Mac** (the commands above): nothing. macOS only quarantines files that
  arrive from somewhere else, so a build you produced locally opens like any other app.
- **Downloaded** — from CI, a cloud folder, anywhere: the file is quarantined, and on
  macOS 15 and later a quarantined unsigned app can no longer be let through with
  right-click → Open. Allow it once under **System Settings → Privacy & Security**, where
  a notice about Atheneum appears with an **Open Anyway** button.

That asymmetry is the reason to build on the Mac rather than download a finished installer.

### Or build it in CI

`.github/workflows/build-mac.yml` builds the `.dmg` on a GitHub-hosted Mac, for when the
MacBook is not to hand. Push the repo, open **Actions → Build macOS installer → Run
workflow**, and the `.dmg` is attached to the finished run. It arrives as a download, so
the quarantine note above applies to it.

---

## Sync

Both machines read and write one folder in whatever cloud drive you already run — Google Drive,
Dropbox, OneDrive or iCloud. It's found automatically; you can override it in **Settings → Sync**.
No account, no server, no cost.

```
<your cloud folder>/Atheneum/
  library-<device>.json     one file per computer
  images/                   covers, named by content hash
  snapshots/                the last 20 states, taken before each merge
```

Each computer writes **only its own file** and reads everyone else's, so the cloud client never
has to resolve a conflict.

### A sync only ever adds

That's the rule the whole design is built around.

- An entry, diary day or category on either machine survives.
- Lists — tags, cast, characters, genres, images — are **combined**, never replaced. Remove a tag
  on one machine and it comes back from the other; that's deliberate. Deleting it twice is a
  small annoyance, losing it silently is not.
- Two different values for the same field: the more recent edit wins, but **a blank never
  overwrites something you wrote**.
- Two versions of the same notes or diary entry: **both are kept**, separated by a `— — —` rule.
  Nothing you typed is thrown away because a clock said so.
- A day holds **as many diary entries as you like** — morning and evening are different thoughts.
  Write on the same day on both machines and you get both, stacked, never concatenated.
- **Nothing is ever deleted by a sync.** Removing something means Archive, which is reversible.
  Delete-for-good exists only inside the Archive, only on that one computer, and never travels.

Run `npm test` after touching anything in `electron/sync/` — those assertions exist because the
merge is the one place a bug costs you writing you can't get back. They already caught one: an
early version re-appended the other machine's notes on every sync, so notes grew a copy of
themselves each time.

---

## How it's put together

```
electron/          main process — window, files, the atheneum:// image protocol
  images.cjs       storing and serving covers
  lookup.cjs       the online providers (main process: the page's CSP forbids fetching)
  sync/
    locate.cjs     finds the cloud folder
    merge.cjs      the additive merge (pure, no Electron — that's why it's testable)
    run.cjs        snapshots, reads every device file, copies images, publishes ours
src/
  types.ts         the data model
  defaults.ts      the seven starting categories
  store.ts         state, plus the migration pass that repairs older files
  platform/        the only door to the filesystem; falls back to browser storage in dev
  lib/             images and tint sampling, sorting/filtering, helpers
  components/      the interface
scripts/
  test-sync.cjs      sync safety — the merge rules
  test-fill.cjs      auto-fill safety — fills gaps, never overwrites
  test-lookup.cjs    ranking, merging, and rejecting placeholder images
  test-migrate.cjs   opening an older library loses nothing
  smoke-electron.cjs loads the real built app in a hidden window
  make-icon.cjs      draws the app icon from scratch
```

**Data lives outside the project**, so nothing here can destroy it:

- Windows — `%APPDATA%\Atheneum\library\`
- macOS — `~/Library/Application Support/Atheneum/library/`

### Everything is customizable

Categories, and the fields inside them, are data rather than code. The seven that ship — Books,
Movies, TV, Manga, Video games, Board games, Cities — can be renamed, recoloured, restaged,
refielded or hidden, and you can add your own. Sorting and grouping read whatever fields exist,
so "sort by author" and "group by genre" work on fields you invent too.

Removing a field only hides it. Its values stay on every entry and reappear if you restore it —
a real delete would destroy data here and then propagate that loss to the other machine.

### Covers

Drag an image onto an entry, or paste one. On import it's downscaled, stored under its own
content hash, and a dominant colour is sampled out of it — that colour is what lights the card
and the entry's page, so a Dune page glows amber and a Blade Runner page glows teal.

### Looking things up

Two separate buttons on an entry: **Fill details**, and **Find cover** next to Choose image.
Neither ever fires on its own — you press it, pick from the matches, and see exactly which empty
fields would be filled before anything is written.

**Fields you have filled are never touched.** Type *The Iliad* and *Homer*, press Fill details,
and Homer is used to narrow the search, listed under "leaving your own entries alone", and left
exactly as you wrote him. Everything still blank gets filled in.

| Source | Covers | Cover size | Key |
| --- | --- | --- | --- |
| **Apple Books** | Books | **784×1200** | none |
| Open Library | Books — pages, publisher | 333×500 | none |
| **AniList** | Anime, manga — and the MyAnimeList score and link | **460×695** | none |
| MyAnimeList (via Jikan) | Anime, manga — fallback | ~425×600 | none |
| TMDB | Films, TV — and the IMDb link | w780 | free, 2 min |
| OMDb | IMDb ratings | — | free, 2 min |
| IGDB | Games | large | free Twitch app |

Those sizes are measured, not assumed, and they drove the source order. Apple Books also
returns the *edition you mean* — Fagles and Fitzgerald for the Iliad, rather than a 1946
reprint — and finds "Meno" by Plato, which Open Library misses. AniList was chosen over
MyAnimeList for bigger art, cleaner matching, and because Jikan depends on MyAnimeList being
reachable, which it repeatedly wasn't.

When two services describe the same thing they are folded into **one candidate** carrying the
best available artwork and the union of the metadata. Two editions from the *same* service stay
separate, because choosing between translations is a real choice. Results are then ranked by
closeness to what you typed, which is tolerant of typos: "Illiad" still puts the Fagles *Iliad*
first.

Three things worth knowing, all verified against the live services:

- **Goodreads retired its API in 2020 and IMDb has no free API at all.** Nobody's app fetches
  IMDb posters. TMDB is the substitute; it supplies the artwork and the `imdb_id`, so films and
  shows still get a real IMDb link and, with an OMDb key, the IMDb score.
- **BoardGameGeek now requires an account** for its XML API and returns 401 to everyone else, so
  board games have to be added by hand. The app says so plainly rather than looking broken.
- **Anime needs no key at all.** AniList carries each title’s MyAnimeList id, exactly as TMDB
  carries the IMDb one, so anime and manga entries get a **Score** out of 10 and a clickable
  **MyAnimeList** link from the source with the better artwork — with nothing to sign up for.

- **A successful download is not a usable cover.** Open Library answers a missing cover with a
  valid 43-byte 1×1 image and a correct content-type. Anything under 200px wide is refused, so
  you never end up with a blank card that looks like a bug.

Keys live in **Settings → Looking things up**. Everything works without them, just thinner. All
fetching happens in the main process — the page's own CSP forbids outbound requests.

### Getting the free keys

None need a card, and the app works without any of them.

**TMDB** — films, TV, and the IMDb link.
1. Sign up at `themoviedb.org`.
2. **Settings → API → Request an API key → Developer.** The form wants a name and a
   one-line description; "personal media catalogue" is a fine answer.
3. Copy **API Key (v3 auth)** into Settings → Looking things up.

**OMDb** — the IMDb rating.
1. `omdbapi.com/apikey.aspx`, choose **FREE (1,000 daily)**, give an email.
2. They email a key **and an activation link** — click the link, or the key silently won't work.

**IGDB** — games. It runs on Twitch's developer platform.
1. `dev.twitch.tv/console` → **Applications → Register Your Application**.
2. Any name; OAuth redirect `http://localhost`; category **Application Integration**.
3. Copy the **Client ID**, press **New Secret**, copy that too.

### Who read it

A three-way control sits just before the status stepper on every entry: **Both / Nane / Sergey**,
Both by default. Filter and group by it like anything else. The names are editable in
**Settings → Who**; entries store which of the three, never the name, so renaming is safe. Turn
it off per category in the category editor.

### Episodes, chapters, missions

Each category can name the small things inside an entry — Episodes for TV and anime, Chapters for
books, Volumes for manga, Missions for games, Plays for board games. Add only the ones worth
remembering, each with a number, title, rating, note, date and a done tick. Rename or disable it
per category. On sync they union by id, ticking done on either machine sticks, and two notes on
the same episode both survive.
