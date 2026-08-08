import { create } from 'zustand';
import { platform } from './platform';
import { DEFAULT_CATEGORIES, DEFAULT_SETTINGS } from './defaults';
import { SCHEMA_VERSION } from './types';
import type {
  Category, Database, DiaryDay, Entry, Field, FieldValue, ImageRef, SavedView, Settings, SubItem,
} from './types';
import { debounce, isoDate, now, slugify, toSortTitle, uid } from './lib/util';

/* ------------------------------------------------------------------ *
 * Normalisation
 *
 * Adapted from Constellation's store.init(): every load runs the database through a pass
 * that back-fills fields added by later versions. Old files keep working, and a file written
 * by an older build on the other machine is repaired rather than rejected.
 * ------------------------------------------------------------------ */

export function freshDatabase(): Database {
  return {
    schemaVersion: SCHEMA_VERSION,
    deviceId: uid(),
    deviceName: guessDeviceName(),
    settings: { ...DEFAULT_SETTINGS },
    categories: structuredClone(DEFAULT_CATEGORIES),
    entries: [],
    diary: [],
    savedViews: [],
  };
}

function guessDeviceName(): string {
  const ua = navigator.userAgent;
  if (/Mac/i.test(ua)) return 'MacBook';
  if (/Win/i.test(ua)) return 'Windows PC';
  return 'This device';
}

export function normalise(input: Partial<Database> | null): Database {
  const db = { ...freshDatabase(), ...(input ?? {}) } as Database;

  db.schemaVersion = SCHEMA_VERSION;
  if (!db.deviceId) db.deviceId = uid();
  if (!db.deviceName) db.deviceName = guessDeviceName();
  db.settings = { ...DEFAULT_SETTINGS, ...(db.settings ?? {}) } as Settings;

  // Categories: keep the user's, and add any builtin they've never seen (a new app version
  // shipping a new default category should appear rather than silently not exist).
  if (!Array.isArray(db.categories)) db.categories = [];
  const haveCategory = new Set(db.categories.map((c) => c.id));
  for (const def of DEFAULT_CATEGORIES) {
    if (!haveCategory.has(def.id)) db.categories.push(structuredClone(def));
  }

  // A newer version adding a field to a built-in category should reach existing libraries too,
  // the same way a new category does. Matching is by key, so a field she removed still exists
  // as hidden and is left alone rather than reappearing.
  for (const def of DEFAULT_CATEGORIES) {
    const existing = db.categories.find((c) => c.id === def.id);
    if (!existing || !Array.isArray(existing.fields)) continue;
    const haveKey = new Set(existing.fields.map((f) => f.key));
    for (const field of def.fields) {
      if (!haveKey.has(field.key)) existing.fields.push(structuredClone(field));
    }
  }

  db.categories = db.categories.map(normaliseCategory);
  db.categories.sort((a, b) => a.order - b.order);

  if (!Array.isArray(db.entries)) db.entries = [];
  db.entries = db.entries.map((e) => normaliseEntry(e, db.deviceId));

  if (!Array.isArray(db.diary)) db.diary = [];
  db.diary = db.diary.map((d) => normaliseDiary(d, db.deviceId));

  if (!Array.isArray(db.savedViews)) db.savedViews = [];

  return db;
}

function normaliseCategory(c: Category): Category {
  const out: Category = {
    id: c.id || uid(),
    name: c.name ?? 'Untitled',
    pluralName: c.pluralName ?? c.name ?? 'Untitled',
    glyph: c.glyph || '◇',
    hue: typeof c.hue === 'number' ? c.hue : 42,
    fields: Array.isArray(c.fields) ? c.fields.map(normaliseField) : [],
    statusLabels: Array.isArray(c.statusLabels) && c.statusLabels.length
      ? c.statusLabels
      : ['To do', 'In progress', 'Done'],
    subItemLabel: c.subItemLabel === undefined ? null : c.subItemLabel,
    tracksWho: c.tracksWho === undefined ? true : Boolean(c.tracksWho),
    defaultLayout: c.defaultLayout ?? 'grid',
    defaultSort: c.defaultSort ?? { key: 'title', direction: 'asc' },
    builtin: Boolean(c.builtin),
    hidden: Boolean(c.hidden),
    order: typeof c.order === 'number' ? c.order : 99,
  };
  return out;
}

function normaliseField(f: Field): Field {
  return {
    id: f.id || f.key || uid(),
    key: f.key || slugify(f.label ?? 'field'),
    label: f.label ?? 'Field',
    type: f.type ?? 'text',
    options: Array.isArray(f.options) ? f.options : undefined,
    showOnCard: Boolean(f.showOnCard),
    hint: f.hint,
    hidden: Boolean(f.hidden),
  };
}

function normaliseEntry(e: Entry, deviceId: string): Entry {
  const title = e.title ?? 'Untitled';
  return {
    id: e.id || uid(),
    categoryId: e.categoryId,
    title,
    sortTitle: e.sortTitle || toSortTitle(title),
    images: Array.isArray(e.images) ? e.images : [],
    coverIndex: typeof e.coverIndex === 'number' ? e.coverIndex : 0,
    values: e.values && typeof e.values === 'object' ? e.values : {},
    rating: typeof e.rating === 'number' ? e.rating : 0,
    status: typeof e.status === 'number' ? e.status : 0,
    who: e.who === 'a' || e.who === 'b' ? e.who : 'both',
    favorite: Boolean(e.favorite),
    notes: e.notes ?? '',
    tags: Array.isArray(e.tags) ? e.tags : [],
    subItems: Array.isArray(e.subItems) ? e.subItems.map(normaliseSubItem) : [],
    dateStarted: e.dateStarted ?? null,
    dateFinished: e.dateFinished ?? null,
    createdAt: e.createdAt ?? now(),
    updatedAt: e.updatedAt ?? e.createdAt ?? now(),
    origin: e.origin ?? deviceId,
    archived: Boolean(e.archived),
  };
}

function normaliseSubItem(s: SubItem): SubItem {
  return {
    id: s.id || uid(),
    number: s.number ?? '',
    title: s.title ?? '',
    note: s.note ?? '',
    rating: typeof s.rating === 'number' ? s.rating : 0,
    done: Boolean(s.done),
    date: s.date ?? null,
    createdAt: s.createdAt ?? now(),
  };
}

function normaliseDiary(d: DiaryDay, deviceId: string): DiaryDay {
  return {
    id: d.id || uid(),
    date: d.date || isoDate(),
    mood: d.mood ?? null,
    body: d.body ?? '',
    linkedEntryIds: Array.isArray(d.linkedEntryIds) ? d.linkedEntryIds : [],
    createdAt: d.createdAt ?? now(),
    updatedAt: d.updatedAt ?? d.createdAt ?? now(),
    origin: d.origin ?? deviceId,
    archived: Boolean(d.archived),
  };
}

/* ------------------------------------------------------------------ *
 * Store
 * ------------------------------------------------------------------ */

interface AppState {
  db: Database;
  loaded: boolean;
  saving: boolean;

  load: () => Promise<void>;
  replaceDb: (db: Database) => void;

  // entries
  createEntry: (categoryId: string, title: string) => string;
  updateEntry: (id: string, patch: Partial<Entry>) => void;
  setValue: (id: string, key: string, value: FieldValue) => void;
  addImage: (id: string, image: ImageRef) => void;
  removeImage: (id: string, hash: string) => void;
  setCover: (id: string, index: number) => void;
  setArchived: (id: string, archived: boolean) => void;
  destroyEntry: (id: string) => void;

  // sub-items — episodes, chapters, missions
  addSubItem: (entryId: string, partial?: Partial<SubItem>) => string;
  updateSubItem: (entryId: string, subId: string, patch: Partial<SubItem>) => void;
  removeSubItem: (entryId: string, subId: string) => void;

  // categories & fields
  createCategory: (partial?: Partial<Category>) => string;
  updateCategory: (id: string, patch: Partial<Category>) => void;
  reorderCategories: (orderedIds: string[]) => void;
  addField: (categoryId: string, field: Partial<Field>) => string;
  updateField: (categoryId: string, fieldId: string, patch: Partial<Field>) => void;
  reorderFields: (categoryId: string, orderedIds: string[]) => void;

  // diary
  createDiaryDay: (date: string) => string;
  updateDiaryDay: (id: string, patch: Partial<DiaryDay>) => void;

  // views & settings
  saveView: (view: Omit<SavedView, 'id' | 'order'>) => string;
  deleteView: (id: string) => void;
  updateSettings: (patch: Partial<Settings>) => void;
}

let saveQueue: Database | null = null;
const flushSave = debounce(() => {
  const db = saveQueue;
  if (!db) return;
  saveQueue = null;
  void platform.saveDb(db).catch((e) => console.error('save failed', e));
}, 250);

export const useStore = create<AppState>((set) => {
  /** Apply a change to the database and schedule a write. */
  function mutate(fn: (db: Database) => Database | void) {
    set((state) => {
      const draft = { ...state.db };
      const result = fn(draft) ?? draft;
      saveQueue = result;
      flushSave();
      return { db: result };
    });
  }

  function touchEntry(db: Database, id: string, patch: Partial<Entry>) {
    db.entries = db.entries.map((e) =>
      e.id === id ? { ...e, ...patch, updatedAt: now() } : e,
    );
  }

  return {
    db: freshDatabase(),
    loaded: false,
    saving: false,

    async load() {
      const raw = await platform.loadDb();
      const db = normalise(raw);
      // Write straight back so a repaired/migrated file is persisted immediately.
      await platform.saveDb(db);
      set({ db, loaded: true });
    },

    replaceDb(db) {
      const clean = normalise(db);
      saveQueue = clean;
      flushSave();
      set({ db: clean });
    },

    /* ---- entries ---- */

    createEntry(categoryId, title) {
      const id = uid();
      mutate((db) => {
        // Seed any field that declares a default, so a new entry starts sensibly filled.
        const category = db.categories.find((c) => c.id === categoryId);
        const values: Record<string, FieldValue> = {};
        for (const field of category?.fields ?? []) {
          if (field.defaultValue !== undefined) values[field.key] = field.defaultValue;
        }

        const entry: Entry = {
          id,
          categoryId,
          title: title.trim() || 'Untitled',
          sortTitle: toSortTitle(title),
          images: [],
          coverIndex: 0,
          values,
          rating: 0,
          status: 0,
          who: 'both',
          favorite: false,
          notes: '',
          tags: [],
          subItems: [],
          dateStarted: null,
          dateFinished: null,
          createdAt: now(),
          updatedAt: now(),
          origin: db.deviceId,
          archived: false,
        };
        db.entries = [...db.entries, entry];
      });
      return id;
    },

    updateEntry(id, patch) {
      mutate((db) => {
        const next = { ...patch };
        if (typeof next.title === 'string') next.sortTitle = toSortTitle(next.title);
        touchEntry(db, id, next);
      });
    },

    setValue(id, key, value) {
      mutate((db) => {
        const entry = db.entries.find((e) => e.id === id);
        if (!entry) return;
        touchEntry(db, id, { values: { ...entry.values, [key]: value } });
      });
    },

    addImage(id, image) {
      mutate((db) => {
        const entry = db.entries.find((e) => e.id === id);
        if (!entry) return;
        if (entry.images.some((i) => i.hash === image.hash)) return;
        touchEntry(db, id, { images: [...entry.images, image] });
      });
    },

    removeImage(id, hash) {
      mutate((db) => {
        const entry = db.entries.find((e) => e.id === id);
        if (!entry) return;
        const images = entry.images.filter((i) => i.hash !== hash);
        const coverIndex = Math.min(entry.coverIndex, Math.max(0, images.length - 1));
        touchEntry(db, id, { images, coverIndex });
      });
    },

    setCover(id, index) {
      mutate((db) => touchEntry(db, id, { coverIndex: index }));
    },

    setArchived(id, archived) {
      mutate((db) => touchEntry(db, id, { archived }));
    },

    /** The only true delete in the app. Local-only, never reaches the sync folder. */
    destroyEntry(id) {
      mutate((db) => {
        db.entries = db.entries.filter((e) => e.id !== id);
      });
    },

    /* ---- sub-items ---- */

    addSubItem(entryId, partial = {}) {
      const id = uid();
      mutate((db) => {
        const entry = db.entries.find((e) => e.id === entryId);
        if (!entry) return;
        // Guess the next number so adding episode after episode doesn't mean retyping.
        const lastNumeric = [...entry.subItems]
          .map((s) => Number(s.number))
          .filter((n) => Number.isFinite(n))
          .pop();
        const item: SubItem = {
          id,
          number: partial.number ?? (lastNumeric !== undefined ? String(lastNumeric + 1) : '1'),
          title: partial.title ?? '',
          note: partial.note ?? '',
          rating: partial.rating ?? 0,
          done: partial.done ?? false,
          date: partial.date ?? null,
          createdAt: now(),
        };
        touchEntry(db, entryId, { subItems: [...entry.subItems, item] });
      });
      return id;
    },

    updateSubItem(entryId, subId, patch) {
      mutate((db) => {
        const entry = db.entries.find((e) => e.id === entryId);
        if (!entry) return;
        touchEntry(db, entryId, {
          subItems: entry.subItems.map((s) => (s.id === subId ? { ...s, ...patch } : s)),
        });
      });
    },

    removeSubItem(entryId, subId) {
      mutate((db) => {
        const entry = db.entries.find((e) => e.id === entryId);
        if (!entry) return;
        touchEntry(db, entryId, { subItems: entry.subItems.filter((s) => s.id !== subId) });
      });
    },

    /* ---- categories & fields ---- */

    createCategory(partial = {}) {
      const id = uid();
      mutate((db) => {
        const category: Category = {
          id,
          name: partial.name ?? 'New category',
          pluralName: partial.pluralName ?? partial.name ?? 'New category',
          glyph: partial.glyph ?? '◇',
          hue: partial.hue ?? Math.floor(Math.random() * 360),
          fields: partial.fields ?? [
            { id: uid(), key: 'description', label: 'Description', type: 'longtext' },
          ],
          statusLabels: partial.statusLabels ?? ['To do', 'In progress', 'Done'],
          subItemLabel: partial.subItemLabel ?? null,
          tracksWho: partial.tracksWho ?? true,
          defaultLayout: partial.defaultLayout ?? 'grid',
          defaultSort: partial.defaultSort ?? { key: 'title', direction: 'asc' },
          builtin: false,
          hidden: false,
          order: db.categories.length,
        };
        db.categories = [...db.categories, category];
      });
      return id;
    },

    updateCategory(id, patch) {
      mutate((db) => {
        db.categories = db.categories.map((c) => (c.id === id ? { ...c, ...patch } : c));
      });
    },

    reorderCategories(orderedIds) {
      mutate((db) => {
        const index = new Map(orderedIds.map((cid, i) => [cid, i]));
        db.categories = db.categories
          .map((c) => ({ ...c, order: index.get(c.id) ?? c.order }))
          .sort((a, b) => a.order - b.order);
      });
    },

    addField(categoryId, field) {
      const id = uid();
      mutate((db) => {
        db.categories = db.categories.map((c) => {
          if (c.id !== categoryId) return c;
          // Keys must be unique within a category — values are stored under them.
          const base = slugify(field.label ?? 'field');
          let key = base;
          let n = 2;
          while (c.fields.some((f) => f.key === key)) key = `${base}-${n++}`;
          const created: Field = {
            id,
            key,
            label: field.label ?? 'New field',
            type: field.type ?? 'text',
            options: field.options,
            showOnCard: field.showOnCard,
            hint: field.hint,
          };
          return { ...c, fields: [...c.fields, created] };
        });
      });
      return id;
    },

    updateField(categoryId, fieldId, patch) {
      mutate((db) => {
        db.categories = db.categories.map((c) =>
          c.id !== categoryId
            ? c
            : {
                ...c,
                // `key` is deliberately not patchable — stored values are addressed by it.
                fields: c.fields.map((f) =>
                  f.id === fieldId ? { ...f, ...patch, key: f.key } : f,
                ),
              },
        );
      });
    },

    reorderFields(categoryId, orderedIds) {
      mutate((db) => {
        db.categories = db.categories.map((c) => {
          if (c.id !== categoryId) return c;
          const byId = new Map(c.fields.map((f) => [f.id, f]));
          const next = orderedIds.map((fid) => byId.get(fid)).filter(Boolean) as Field[];
          // Anything not in the list (e.g. hidden fields) keeps its place at the end.
          for (const f of c.fields) if (!orderedIds.includes(f.id)) next.push(f);
          return { ...c, fields: next };
        });
      });
    },

    /* ---- diary ---- */

    createDiaryDay(date) {
      const id = uid();
      mutate((db) => {
        const day: DiaryDay = {
          id,
          date,
          mood: null,
          body: '',
          linkedEntryIds: [],
          createdAt: now(),
          updatedAt: now(),
          origin: db.deviceId,
          archived: false,
        };
        db.diary = [...db.diary, day];
      });
      return id;
    },

    updateDiaryDay(id, patch) {
      mutate((db) => {
        db.diary = db.diary.map((d) =>
          d.id === id ? { ...d, ...patch, updatedAt: now() } : d,
        );
      });
    },

    /* ---- views & settings ---- */

    saveView(view) {
      const id = uid();
      mutate((db) => {
        db.savedViews = [...db.savedViews, { ...view, id, order: db.savedViews.length }];
      });
      return id;
    },

    deleteView(id) {
      mutate((db) => {
        db.savedViews = db.savedViews.filter((v) => v.id !== id);
      });
    },

    updateSettings(patch) {
      mutate((db) => {
        db.settings = { ...db.settings, ...patch };
      });
    },
  };
});

/* ---- selectors ---- */

export const selectCategory = (db: Database, id: string | null) =>
  db.categories.find((c) => c.id === id) ?? null;

export const selectEntry = (db: Database, id: string | null) =>
  db.entries.find((e) => e.id === id) ?? null;

/** Live (non-archived) entries in a category. */
export const selectEntries = (db: Database, categoryId: string | null) =>
  db.entries.filter((e) => !e.archived && (!categoryId || e.categoryId === categoryId));

export function allTags(db: Database, categoryId: string | null): string[] {
  const set = new Set<string>();
  for (const e of selectEntries(db, categoryId)) for (const t of e.tags) set.add(t);
  return [...set].sort((a, b) => a.localeCompare(b));
}

export { useStore as default };
