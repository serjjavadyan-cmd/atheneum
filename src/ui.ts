import { create } from 'zustand';
import type { FilterSpec, Layout, SortSpec } from './types';
import { uid } from './lib/util';

/**
 * Ephemeral interface state — where you are, what's filtered, what's on screen.
 * Deliberately separate from the store: none of this is worth persisting or syncing.
 */

export type Route =
  | { name: 'category'; categoryId: string }
  | { name: 'entry'; entryId: string }
  | { name: 'diary' }
  | { name: 'settings' }
  | { name: 'archive' };

export interface Toast {
  id: string;
  text: string;
  kind: 'info' | 'success' | 'error';
}

/** Per-category view state, so switching away and back keeps your sort and filters. */
export interface ViewState {
  sort: SortSpec;
  layout: Layout;
  groupBy: string | null;
  filter: FilterSpec;
}

export const emptyFilter = (): FilterSpec => ({
  text: '',
  statuses: [],
  tags: [],
  minRating: 0,
  favoritesOnly: false,
  fieldEquals: {},
});

export function isFilterActive(f: FilterSpec): boolean {
  return (
    f.text.trim() !== '' ||
    f.statuses.length > 0 ||
    f.tags.length > 0 ||
    f.minRating > 0 ||
    f.favoritesOnly ||
    Object.keys(f.fieldEquals).length > 0
  );
}

interface UiState {
  route: Route;
  history: Route[];
  paletteOpen: boolean;
  editingCategoryId: string | null;
  newEntryCategoryId: string | null;
  toasts: Toast[];
  views: Record<string, ViewState>;

  go: (route: Route) => void;
  back: () => void;
  setPalette: (open: boolean) => void;
  editCategory: (id: string | null) => void;
  startNewEntry: (categoryId: string | null) => void;
  toast: (text: string, kind?: Toast['kind']) => void;
  dismissToast: (id: string) => void;
  getView: (categoryId: string, fallback: ViewState) => ViewState;
  setView: (categoryId: string, patch: Partial<ViewState>) => void;
}

export const useUi = create<UiState>((set, get) => ({
  route: { name: 'category', categoryId: 'books' },
  history: [],
  paletteOpen: false,
  editingCategoryId: null,
  newEntryCategoryId: null,
  toasts: [],
  views: {},

  go(route) {
    set((s) => ({ route, history: [...s.history, s.route].slice(-40) }));
    // A new page should start at the top, not wherever the last one was scrolled to.
    queueMicrotask(() => {
      document.querySelector('.content')?.scrollTo({ top: 0 });
    });
  },

  back() {
    set((s) => {
      if (!s.history.length) return s;
      const history = [...s.history];
      const route = history.pop()!;
      return { route, history };
    });
  },

  setPalette(open) {
    set({ paletteOpen: open });
  },

  editCategory(id) {
    set({ editingCategoryId: id });
  },

  startNewEntry(categoryId) {
    set({ newEntryCategoryId: categoryId });
  },

  toast(text, kind = 'info') {
    const id = uid();
    set((s) => ({ toasts: [...s.toasts, { id, text, kind }] }));
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 6000 : 3000);
  },

  dismissToast(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },

  getView(categoryId, fallback) {
    return get().views[categoryId] ?? fallback;
  },

  setView(categoryId, patch) {
    set((s) => {
      // Falls back to a blank view rather than dropping the change: applying a saved view can
      // land before the category screen has mounted and seeded its own state.
      const current: ViewState = s.views[categoryId] ?? {
        sort: { key: 'title', direction: 'asc' },
        layout: 'grid',
        groupBy: null,
        filter: emptyFilter(),
      };
      return { views: { ...s.views, [categoryId]: { ...current, ...patch } } };
    });
  },
}));

/** Seed a category's view state the first time it is opened. */
export function ensureView(categoryId: string, initial: ViewState) {
  const { views } = useUi.getState();
  if (views[categoryId]) return;
  useUi.setState({ views: { ...views, [categoryId]: initial } });
}
