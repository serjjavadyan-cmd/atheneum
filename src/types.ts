/**
 * Atheneum's data model.
 *
 * Two rules shape everything here:
 *  1. Nothing is ever hard-deleted — records carry `archived` and stay in the file forever,
 *     so a sync can only ever add.
 *  2. Almost nothing is hardcoded — categories own their own field definitions, and an entry's
 *     custom data lives in a single `values` bag keyed by field key.
 */

/** Every field type the field editor can produce. */
export type FieldType =
  | 'text'
  | 'longtext'
  | 'number'
  | 'rating'
  | 'date'
  | 'select'
  | 'multiselect'
  | 'people'
  | 'tags'
  | 'url'
  | 'checkbox'
  | 'progress'
  | 'duration';

export interface Field {
  id: string;
  /** Stable key into `Entry.values`. Never changes once created, even if the label does. */
  key: string;
  label: string;
  type: FieldType;
  /** For select / multiselect. */
  options?: string[];
  /** Applied to new entries in this category. */
  defaultValue?: FieldValue;
  /** Show this field on the card in grid/list view. */
  showOnCard?: boolean;
  /** Placeholder / helper text in the editor. */
  hint?: string;
  /**
   * Hidden fields are not shown or edited, but their stored values are kept.
   * This is what "deleting" a field does — removal would lose data on sync.
   */
  hidden?: boolean;
}

export type Layout = 'grid' | 'list' | 'gallery';

export interface Category {
  id: string;
  name: string;
  /** Plural form used in headings and counts, e.g. "Books". */
  pluralName: string;
  /** A single character or emoji used as the sidebar mark. */
  glyph: string;
  /** 0–360. Drives the category's accent colour. */
  hue: number;
  fields: Field[];
  /** Ordered progression, e.g. ["To read", "Reading", "Read"]. `Entry.status` indexes this. */
  statusLabels: string[];
  /**
   * What the small things inside an entry are called here — Episodes, Chapters, Missions.
   * Null means this category doesn't offer them.
   */
  subItemLabel: string | null;
  /** Whether the Both / Nane / Sergey control appears on entries in this category. */
  tracksWho: boolean;
  defaultLayout: Layout;
  defaultSort: SortSpec;
  builtin: boolean;
  hidden: boolean;
  /** Sidebar order. */
  order: number;
}

export interface ImageRef {
  /** Content hash — also the filename on disk. Makes image sync a pure copy with no collisions. */
  hash: string;
  /** Stored filename, e.g. "ab/abcdef….jpg". */
  file: string;
  width: number;
  height: number;
  /** Dominant colour sampled at import, as "h s% l%". Drives the entry's ambient tint. */
  tint: string;
  caption?: string;
}

/** A person attached to an entry — author, director, actor, character, composer, anyone. */
export interface Person {
  id: string;
  name: string;
  /** Optional sub-role, e.g. the character an actor played. */
  note?: string;
}

export type FieldValue =
  | string
  | number
  | boolean
  | string[]
  | Person[]
  | null
  | undefined;

/**
 * One of the small things inside an entry — an episode of a show, a chapter worth
 * remembering, a mission, a play session. Only the ones worth adding, never a full index.
 */
export interface SubItem {
  id: string;
  /** Free-form so "S2E4" and "3.1" both work. */
  number: string;
  title: string;
  note: string;
  /** 0–10, as elsewhere. */
  rating: number;
  done: boolean;
  date: string | null;
  createdAt: string;
}

/** Which of you experienced it. The labels live in Settings; these keys never change. */
export type Who = 'both' | 'a' | 'b';

export interface Entry {
  id: string;
  categoryId: string;
  title: string;
  /** Auto-derived: leading articles stripped, lowercased. Used for alphabetical sort. */
  sortTitle: string;
  images: ImageRef[];
  coverIndex: number;
  /** All custom field data, keyed by `Field.key`. */
  values: Record<string, FieldValue>;
  /** 0–10, representing 0–5 stars in half steps. */
  rating: number;
  /** Index into the category's `statusLabels`. */
  status: number;
  /** Who experienced it. Sits immediately before the status control. */
  who: Who;
  favorite: boolean;
  notes: string;
  tags: string[];
  subItems: SubItem[];
  dateStarted: string | null;
  dateFinished: string | null;
  createdAt: string;
  updatedAt: string;
  /** Device that first created this record. */
  origin: string;
  archived: boolean;
}

export interface DiaryDay {
  id: string;
  /** ISO date, "YYYY-MM-DD". Not unique — two devices may both write the same day, and we keep both. */
  date: string;
  mood: string | null;
  body: string;
  /** Entries this day is about. The entry page shows the reverse of this link. */
  linkedEntryIds: string[];
  createdAt: string;
  updatedAt: string;
  origin: string;
  archived: boolean;
}

export type SortDirection = 'asc' | 'desc';

export interface SortSpec {
  /**
   * Either a builtin key or `field:<fieldKey>` to sort by a custom field.
   * Builtins: title | rating | createdAt | updatedAt | dateStarted | dateFinished | status
   */
  key: string;
  direction: SortDirection;
}

export interface FilterSpec {
  text: string;
  /** Indices into the category's statusLabels. Empty means no status filter. */
  statuses: number[];
  tags: string[];
  minRating: number;
  favoritesOnly: boolean;
  /** Empty means no filter on who. */
  who: Who[];
  /** `field:<key>` → required value, for group-by drill-downs. */
  fieldEquals: Record<string, string>;
}

export interface SavedView {
  id: string;
  name: string;
  categoryId: string | null;
  filter: FilterSpec;
  sort: SortSpec;
  layout: Layout;
  groupBy: string | null;
  order: number;
}

export interface Settings {
  /** '' = auto-detect a cloud folder, 'off' = disabled, or an explicit path. */
  syncDir: string;
  syncEnabled: boolean;
  /** Minutes between automatic merges. */
  syncIntervalMin: number;
  /** Enables the Fill details / Find cover buttons. */
  onlineLookup: boolean;
  /** Free, optional. Without it, film and TV lookups fall back to thin no-key sources. */
  tmdbKey: string;
  /** Free, optional. Games. */
  igdbClientId: string;
  igdbClientSecret: string;
  /** Free, optional. Supplies IMDb ratings. */
  omdbKey: string;
  /**
   * Labels for the three-way who control. Editable so two names aren't baked into the source;
   * the stored values stay 'both' | 'a' | 'b' whatever these say.
   */
  whoLabels: { both: string; a: string; b: string };
  accentHue: number;
  /** Reduce or disable the motion design. */
  reduceMotion: boolean;
}

export interface Database {
  schemaVersion: number;
  /** Stable per-install id. Names this device's file in the sync folder. */
  deviceId: string;
  deviceName: string;
  settings: Settings;
  categories: Category[];
  entries: Entry[];
  diary: DiaryDay[];
  savedViews: SavedView[];
}

/**
 * 1 — the original shape.
 * 2 — online lookup added. Libraries written by v1 stored `onlineLookup: false` from the old
 *     default, which would otherwise permanently hide a feature that didn't exist yet.
 */
export const SCHEMA_VERSION = 2;
