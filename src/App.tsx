import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useStore } from './store';
import { useUi } from './ui';
import { Sidebar } from './components/Sidebar';
import { CategoryView } from './components/CategoryView';
import { ArchiveView, EntryDetail } from './components/EntryDetail';
import { DiaryView } from './components/DiaryView';
import { SettingsView } from './components/SettingsView';
import { CategoryEditor } from './components/CategoryEditor';
import { CommandPalette } from './components/CommandPalette';
import { IconX } from './components/Icons';
import { useAutoSync } from './lib/useAutoSync';

export default function App() {
  const loaded = useStore((s) => s.loaded);
  const load = useStore((s) => s.load);
  const db = useStore((s) => s.db);
  const route = useUi((s) => s.route);
  const go = useUi((s) => s.go);
  const back = useUi((s) => s.back);
  const startNewEntry = useUi((s) => s.startNewEntry);

  useAutoSync();

  useEffect(() => {
    void load().then(() => {
      // Development convenience: `?seed` fills an empty library with sample content so the
      // design can be judged against real covers. Stripped from production builds.
      if (import.meta.env.DEV && new URLSearchParams(location.search).has('seed')) {
        void import('./dev/seed').then((m) => m.seedLibrary());
      }
    });
  }, [load]);

  // Reflect settings onto the document so CSS can react to them.
  useEffect(() => {
    document.body.dataset.reduceMotion = String(db.settings.reduceMotion);
    document.body.dataset.platform = /Mac/i.test(navigator.userAgent) ? 'mac' : 'win';
  }, [db.settings.reduceMotion]);

  // If the route points at something that no longer exists, fall back to the first category.
  useEffect(() => {
    if (!loaded) return;
    if (route.name === 'entry' && !db.entries.some((e) => e.id === route.entryId)) {
      go({ name: 'category', categoryId: db.categories[0]?.id ?? 'books' });
    }
    if (route.name === 'category' && !db.categories.some((c) => c.id === route.categoryId)) {
      go({ name: 'category', categoryId: db.categories[0]?.id ?? 'books' });
    }
  }, [loaded, route, db.entries, db.categories, go]);

  /* --- global keys --- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const inField = /^(INPUT|TEXTAREA)$/.test((e.target as HTMLElement)?.tagName ?? '');

      if (mod && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        const categoryId = route.name === 'category' ? route.categoryId : db.categories[0]?.id;
        if (categoryId) startNewEntry(categoryId);
      }
      if (e.key === 'Escape' && !inField && route.name === 'entry') {
        back();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [route, db.categories, startNewEntry, back]);

  if (!loaded) {
    return (
      <div className="app">
        <div className="boot"><span className="boot-mark">❖</span></div>
      </div>
    );
  }

  const category = route.name === 'category'
    ? db.categories.find((c) => c.id === route.categoryId) ?? null
    : null;
  const entry = route.name === 'entry'
    ? db.entries.find((e) => e.id === route.entryId) ?? null
    : null;

  const routeKey =
    route.name === 'category' ? `cat-${route.categoryId}`
    : route.name === 'entry' ? `entry-${route.entryId}`
    : route.name;

  return (
    <div className="app">
      <div className="titlebar" />
      <div className="shell">
        <Sidebar />
        <main className="main">
          {/*
            Route changes fade via CSS (`.route` keyed animation) rather than AnimatePresence.
            A JS exit animation would keep the old page mounted over the new one, and the fade
            is not worth a second copy of a long grid in the tree.
          */}
          <div className="route" key={routeKey}>
            {route.name === 'category' && category && <CategoryView category={category} />}
            {route.name === 'entry' && entry && (
              <div className="content"><EntryDetail entry={entry} /></div>
            )}
            {route.name === 'diary' && <DiaryView />}
            {route.name === 'archive' && <ArchiveView />}
            {route.name === 'settings' && <SettingsView />}
          </div>
        </main>
      </div>

      <NewEntryDialog />
      <CategoryEditor />
      <CommandPalette />
      <Toasts />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * New entry — one field, Enter to create
 * ------------------------------------------------------------------ */

function NewEntryDialog() {
  const categoryId = useUi((s) => s.newEntryCategoryId);
  const startNewEntry = useUi((s) => s.startNewEntry);
  const go = useUi((s) => s.go);
  const db = useStore((s) => s.db);
  const createEntry = useStore((s) => s.createEntry);
  const [title, setTitle] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (categoryId) {
      setTitle('');
      queueMicrotask(() => inputRef.current?.focus());
    }
  }, [categoryId]);

  if (!categoryId) return null;
  const category = db.categories.find((c) => c.id === categoryId);
  if (!category) return null;

  const submit = (openAfter: boolean) => {
    const clean = title.trim();
    if (!clean) return;
    const id = createEntry(categoryId, clean);
    setTitle('');
    if (openAfter) {
      startNewEntry(null);
      go({ name: 'entry', entryId: id });
    } else {
      // Keep the dialog open so a stack of books can be typed in one go.
      inputRef.current?.focus();
    }
  };

  return (
    <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) startNewEntry(null); }}>
      <motion.div
        className="modal"
        style={{ maxWidth: 460 }}
        initial={{ opacity: 0, y: 10, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="modal-head">
          <span className="modal-title">New {category.name.toLowerCase()}</span>
          <button className="btn-icon" onClick={() => startNewEntry(null)} aria-label="Close">
            <IconX size={14} />
          </button>
        </div>
        <div className="modal-body">
          <div className="field-row">
            <label className="field-label" htmlFor="new-entry-title">Title</label>
            <input
              id="new-entry-title"
              ref={inputRef}
              className="input"
              value={title}
              placeholder={`Name of the ${category.name.toLowerCase()}…`}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); submit(!e.shiftKey); }
                if (e.key === 'Escape') startNewEntry(null);
              }}
            />
            <span className="field-hint">
              Enter to add and open it · Shift + Enter to add and keep typing
            </span>
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={() => startNewEntry(null)}>Cancel</button>
          <button className="btn btn-primary" disabled={!title.trim()} onClick={() => submit(true)}>
            Add
          </button>
        </div>
      </motion.div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Toasts
 * ------------------------------------------------------------------ */

function Toasts() {
  const toasts = useUi((s) => s.toasts);
  return (
    <div className="toasts" aria-live="polite">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            className="toast"
            data-kind={t.kind}
            initial={{ opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.97 }}
            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
          >
            {t.kind === 'success' && <span className="toast-mark">✦</span>}
            {t.text}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
