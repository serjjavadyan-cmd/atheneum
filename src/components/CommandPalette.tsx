import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import Fuse from 'fuse.js';
import { useStore } from '../store';
import { useUi } from '../ui';
import { valueToText } from '../lib/query';
import { formatDateShort } from '../lib/util';
import { CoverImage, coverOf, tintOf } from './primitives';
import { IconCalendar, IconPlus, IconSearch, IconSettings } from './Icons';

/**
 * Ctrl/⌘K. Searches every entry and every diary day at once, and doubles as a way to jump to a
 * category or start a new entry without touching the mouse.
 */

type Result =
  | { kind: 'entry'; id: string; title: string; sub: string; tint: string; file: string | null }
  | { kind: 'diary'; id: string; date: string; title: string; sub: string }
  | { kind: 'category'; id: string; title: string; glyph: string; hue: number }
  | { kind: 'action'; id: string; title: string; sub: string; run: () => void };

export function CommandPalette() {
  const open = useUi((s) => s.paletteOpen);
  const setPalette = useUi((s) => s.setPalette);
  const go = useUi((s) => s.go);
  const startNewEntry = useUi((s) => s.startNewEntry);
  const db = useStore((s) => s.db);

  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Open on Ctrl/⌘K from anywhere, including from inside a text field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setPalette]);

  useEffect(() => {
    if (open) {
      setQ('');
      setActive(0);
      queueMicrotask(() => inputRef.current?.focus());
    }
  }, [open]);

  /* --- the searchable corpus, rebuilt only when the library changes --- */
  const fuse = useMemo(() => {
    const docs = [
      ...db.entries
        .filter((e) => !e.archived)
        .map((e) => {
          const cat = db.categories.find((c) => c.id === e.categoryId) ?? null;
          const cover = coverOf(e);
          return {
            kind: 'entry' as const,
            id: e.id,
            title: e.title,
            sub: [cat?.name, ...(cat?.fields ?? [])
              .filter((f) => f.showOnCard)
              .map((f) => valueToText(e.values[f.key], f))]
              .filter(Boolean)
              .join(' · '),
            tint: tintOf(e, cat),
            file: cover?.file ?? null,
            // Searched but not shown: everything written on the entry.
            body: [
              e.notes,
              e.tags.join(' '),
              ...(cat?.fields ?? []).map((f) => valueToText(e.values[f.key], f)),
            ].join(' '),
          };
        }),
      ...db.diary
        .filter((d) => !d.archived)
        .map((d) => ({
          kind: 'diary' as const,
          id: d.id,
          date: d.date,
          title: formatDateShort(d.date),
          sub: d.body.trim().split('\n')[0].slice(0, 90) || 'Empty',
          body: d.body,
        })),
    ];

    return new Fuse(docs, {
      keys: [
        { name: 'title', weight: 3 },
        { name: 'sub', weight: 1 },
        { name: 'body', weight: 0.5 },
      ],
      threshold: 0.34,
      ignoreLocation: true,
    });
  }, [db.entries, db.diary, db.categories]);

  const results: Result[] = useMemo(() => {
    const query = q.trim();

    const categories: Result[] = db.categories
      .filter((c) => !c.hidden)
      .filter((c) => !query || c.pluralName.toLowerCase().includes(query.toLowerCase()))
      .map((c) => ({ kind: 'category', id: c.id, title: c.pluralName, glyph: c.glyph, hue: c.hue }));

    if (!query) {
      // Empty palette: somewhere to go rather than a blank box.
      return [
        ...categories,
        { kind: 'action', id: 'diary', title: 'Diary', sub: 'Today', run: () => go({ name: 'diary' }) },
        { kind: 'action', id: 'settings', title: 'Settings', sub: '', run: () => go({ name: 'settings' }) },
      ];
    }

    const found = fuse.search(query, { limit: 24 }).map((r) => r.item);
    const hits: Result[] = found.map((d) =>
      d.kind === 'entry'
        ? { kind: 'entry', id: d.id, title: d.title, sub: d.sub, tint: d.tint, file: d.file }
        : { kind: 'diary', id: d.id, date: d.date, title: d.title, sub: d.sub },
    );

    const actions: Result[] = db.categories
      .filter((c) => !c.hidden)
      .slice(0, 3)
      .map((c) => ({
        kind: 'action' as const,
        id: `new-${c.id}`,
        title: `Add “${query}” as a ${c.name.toLowerCase()}`,
        sub: '',
        run: () => startNewEntry(c.id),
      }));

    return [...hits, ...categories.slice(0, 3), ...actions];
  }, [q, fuse, db.categories, go, startNewEntry]);

  useEffect(() => setActive(0), [q]);

  // Keep the highlighted row in view when arrowing past the fold.
  useEffect(() => {
    listRef.current?.querySelector('.palette-item.is-active')
      ?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!open) return null;

  const choose = (r: Result) => {
    setPalette(false);
    if (r.kind === 'entry') go({ name: 'entry', entryId: r.id });
    else if (r.kind === 'diary') go({ name: 'diary' });
    else if (r.kind === 'category') go({ name: 'category', categoryId: r.id });
    else r.run();
  };

  return (
    <div
      className="scrim palette-scrim"
      onMouseDown={(e) => { if (e.target === e.currentTarget) setPalette(false); }}
    >
      <motion.div
        className="palette"
        initial={{ opacity: 0, y: -8, scale: 0.99 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
        role="dialog"
        aria-label="Search everything"
      >
        <div className="palette-input">
          <IconSearch size={15} />
          <input
            ref={inputRef}
            value={q}
            placeholder="Search everything…"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { e.preventDefault(); setPalette(false); }
              if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(results.length - 1, i + 1)); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
              if (e.key === 'Enter' && results[active]) { e.preventDefault(); choose(results[active]); }
            }}
            aria-activedescendant={results[active] ? `palette-${active}` : undefined}
          />
          <kbd className="kbd">Esc</kbd>
        </div>

        <div className="palette-list" ref={listRef} role="listbox">
          {results.length === 0 && (
            <div className="palette-empty">Nothing matches “{q.trim()}”.</div>
          )}
          {results.map((r, i) => (
            <button
              key={`${r.kind}-${r.id}`}
              id={`palette-${i}`}
              className={`palette-item${i === active ? ' is-active' : ''}`}
              role="option"
              aria-selected={i === active}
              onMouseMove={() => setActive(i)}
              onClick={() => choose(r)}
            >
              <span
                className="palette-mark"
                style={r.kind === 'entry'
                  ? { ['--tint' as string]: r.tint }
                  : r.kind === 'category'
                    ? { ['--tint' as string]: `${r.hue} 55% 60%` }
                    : undefined}
              >
                {r.kind === 'entry' && r.file
                  ? <CoverImage image={{ hash: '', file: r.file, width: 0, height: 0, tint: r.tint }} alt="" />
                  : r.kind === 'category' ? r.glyph
                  : r.kind === 'diary' ? <IconCalendar size={13} />
                  : r.id === 'settings' ? <IconSettings size={13} />
                  : r.id === 'diary' ? <IconCalendar size={13} />
                  : <IconPlus size={13} />}
              </span>
              <span className="palette-text">
                <span className="palette-title">{r.title}</span>
                {'sub' in r && r.sub && <span className="palette-sub">{r.sub}</span>}
              </span>
              <span className="palette-kind">
                {r.kind === 'entry' ? '' : r.kind === 'diary' ? 'Diary' : r.kind === 'category' ? 'Category' : ''}
              </span>
            </button>
          ))}
        </div>

        <div className="palette-foot">
          <span><kbd className="kbd">↑</kbd><kbd className="kbd">↓</kbd> move</span>
          <span><kbd className="kbd">↵</kbd> open</span>
          <span className="grow" />
          <span>{results.length} {results.length === 1 ? 'result' : 'results'}</span>
        </div>
      </motion.div>
    </div>
  );
}
