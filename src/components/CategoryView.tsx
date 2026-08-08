import { useEffect, useMemo } from 'react';
import { useStore, selectEntries } from '../store';
import { ensureView, emptyFilter, isFilterActive, useUi } from '../ui';
import type { Category, Entry, FilterSpec } from '../types';
import { filterEntries, groupEntries, groupOptions, sortEntries, sortOptions } from '../lib/query';
import { EntryCard, EntryRow } from './EntryCard';
import { Menu } from './Menu';
import { IconEdit, IconFilter, IconGallery, IconGrid, IconList, IconPlus, IconSearch, IconSort, IconX } from './Icons';

export function CategoryView({ category }: { category: Category }) {
  const db = useStore((s) => s.db);
  const go = useUi((s) => s.go);
  const setView = useUi((s) => s.setView);
  const editCategory = useUi((s) => s.editCategory);
  const startNewEntry = useUi((s) => s.startNewEntry);
  const views = useUi((s) => s.views);

  // Seed this category's view state from its own defaults the first time it's opened.
  useEffect(() => {
    ensureView(category.id, {
      sort: category.defaultSort,
      layout: category.defaultLayout,
      groupBy: null,
      filter: emptyFilter(),
    });
  }, [category.id, category.defaultSort, category.defaultLayout]);

  const view = views[category.id];

  const all = useMemo(() => selectEntries(db, category.id), [db, category.id]);

  const groups = useMemo(() => {
    if (!view) return [];
    const filtered = filterEntries(all, view.filter, category);
    const sorted = sortEntries(filtered, view.sort, category);
    return groupEntries(sorted, view.groupBy, category);
  }, [all, view, category]);

  if (!view) return null;

  const shown = groups.reduce((n, g) => n + g.entries.length, 0);
  const sorts = sortOptions(category);
  const groupsAvailable = groupOptions(category);
  const activeSort = sorts.find((s) => s.key === view.sort.key);
  const activeGroup = groupsAvailable.find((g) => g.key === view.groupBy);
  const filtering = isFilterActive(view.filter);

  const tint = `${category.hue} 55% 60%`;

  return (
    <>
      <div className="topbar" style={{ ['--tint' as string]: tint }}>
        <div className="topbar-title">
          <span>{category.pluralName}</span>
          <span className="count">
            {filtering ? `${shown} of ${all.length}` : all.length}
          </span>
        </div>

        <button
          className="btn-icon"
          onClick={() => editCategory(category.id)}
          title="Edit this category and its fields"
          aria-label="Edit category"
        >
          <IconEdit size={14} />
        </button>

        <div className="grow" />

        <label className="search">
          <span className="search-icon"><IconSearch size={13} /></span>
          <input
            value={view.filter.text}
            placeholder={`Search ${category.pluralName.toLowerCase()}…`}
            onChange={(e) => setView(category.id, { filter: { ...view.filter, text: e.target.value } })}
          />
          {view.filter.text && (
            <button className="chip-x" onClick={() => setView(category.id, { filter: { ...view.filter, text: '' } })} aria-label="Clear search">
              <IconX size={12} />
            </button>
          )}
        </label>

        <Menu
          title="Sort"
          label={<><IconSort size={13} />{activeSort?.label ?? 'Sort'}</>}
          align="right"
          header={
            <div className="dropdown-head">
              <div className="segmented" style={{ width: '100%' }}>
                <button
                  className={view.sort.direction === 'asc' ? 'is-on' : ''}
                  style={{ flex: 1 }}
                  onClick={() => setView(category.id, { sort: { ...view.sort, direction: 'asc' } })}
                >
                  Ascending
                </button>
                <button
                  className={view.sort.direction === 'desc' ? 'is-on' : ''}
                  style={{ flex: 1 }}
                  onClick={() => setView(category.id, { sort: { ...view.sort, direction: 'desc' } })}
                >
                  Descending
                </button>
              </div>
            </div>
          }
          items={sorts.map((s) => ({
            key: s.key,
            label: s.label,
            checked: s.key === view.sort.key,
            onSelect: () => setView(category.id, { sort: { key: s.key, direction: s.direction } }),
          }))}
        />

        <Menu
          title="Group by"
          label={activeGroup ? `By ${activeGroup.label.toLowerCase()}` : 'Group'}
          align="right"
          items={[
            { key: '__none', label: 'No grouping', checked: !view.groupBy, onSelect: () => setView(category.id, { groupBy: null }) },
            ...groupsAvailable.map((g) => ({
              key: g.key,
              label: g.label,
              checked: g.key === view.groupBy,
              onSelect: () => setView(category.id, { groupBy: g.key }),
            })),
          ]}
        />

        <FilterMenu category={category} />

        <div className="segmented">
          {([['grid', IconGrid], ['list', IconList], ['gallery', IconGallery]] as const).map(([key, Icon]) => (
            <button
              key={key}
              className={view.layout === key ? 'is-on' : ''}
              onClick={() => setView(category.id, { layout: key })}
              title={`${key[0].toUpperCase()}${key.slice(1)} view`}
              aria-label={`${key} view`}
            >
              <Icon size={13} />
            </button>
          ))}
        </div>

        <SaveViewButton category={category} />

        <button className="btn btn-primary" onClick={() => startNewEntry(category.id)}>
          <IconPlus size={13} /> Add
        </button>
      </div>

      <div className="content">
        <div className="content-pad">
          {filtering && (
            <ActiveFilters category={category} />
          )}

          {shown === 0 ? (
            <div className="empty" style={{ ['--tint' as string]: tint }}>
              <div className="empty-mark">{category.glyph}</div>
              <div className="empty-title">
                {all.length === 0 ? `No ${category.pluralName.toLowerCase()} yet` : 'Nothing matches'}
              </div>
              <div className="empty-body">
                {all.length === 0
                  ? `Add your first ${category.name.toLowerCase()} and it will appear here. Drop a cover image onto it and the whole page takes on its colour.`
                  : 'Try loosening the search or clearing a filter.'}
              </div>
              {all.length === 0 ? (
                <button className="btn btn-primary" onClick={() => startNewEntry(category.id)}>
                  <IconPlus size={13} /> Add a {category.name.toLowerCase()}
                </button>
              ) : (
                <button className="btn" onClick={() => setView(category.id, { filter: emptyFilter() })}>
                  Clear filters
                </button>
              )}
            </div>
          ) : (
            groups.map((group) => (
              <section className="group" key={group.key || 'all'}>
                {view.groupBy && (
                  <header className="group-head">
                    <h2 className="group-name">{group.label}</h2>
                    <span className="group-count">{group.entries.length}</span>
                  </header>
                )}
                <EntryLayout
                  entries={group.entries}
                  category={category}
                  layout={view.layout}
                  onOpen={(e) => go({ name: 'entry', entryId: e.id })}
                />
              </section>
            ))
          )}
        </div>
      </div>
    </>
  );
}

function EntryLayout({
  entries, category, layout, onOpen,
}: {
  entries: Entry[];
  category: Category;
  layout: 'grid' | 'list' | 'gallery';
  onOpen: (e: Entry) => void;
}) {
  if (layout === 'list') {
    const shownFields = category.fields.filter((f) => f.showOnCard && !f.hidden);
    return (
      <div className="list">
        <div className="list-head">
          <span />
          <span>Title</span>
          <span>{shownFields[0]?.label ?? ''}</span>
          <span>{shownFields[1]?.label ?? ''}</span>
          <span>Rating</span>
          <span>Status</span>
        </div>
        {entries.map((e) => (
          <EntryRow key={e.id} entry={e} category={category} onOpen={() => onOpen(e)} />
        ))}
      </div>
    );
  }

  return (
    <div className={layout === 'gallery' ? 'gallery' : 'grid'}>
      {entries.map((e) => (
        <EntryCard
          key={e.id}
          entry={e}
          category={category}
          wideArt={layout === 'gallery'}
          onOpen={() => onOpen(e)}
        />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Saved views — pin a filter + sort + layout to the sidebar
 * ------------------------------------------------------------------ */

function SaveViewButton({ category }: { category: Category }) {
  const views = useUi((s) => s.views);
  const toast = useUi((s) => s.toast);
  const saveView = useStore((s) => s.saveView);
  const saved = useStore((s) => s.db.savedViews);
  const view = views[category.id];
  if (!view) return null;

  // Only worth offering once the view is actually distinctive.
  const worthSaving = isFilterActive(view.filter) || view.groupBy !== null;
  if (!worthSaving) return null;

  // Don't offer to save something already pinned.
  const already = saved.some(
    (v) =>
      v.categoryId === category.id &&
      v.groupBy === view.groupBy &&
      JSON.stringify(v.filter) === JSON.stringify(view.filter),
  );
  if (already) return null;

  return (
    <button
      className="btn"
      title="Pin this filter and sort to the sidebar"
      onClick={() => {
        const suggested = describeView(category, view);
        const name = prompt('Name this view', suggested);
        if (name == null) return;
        saveView({
          name: name.trim() || suggested,
          categoryId: category.id,
          filter: view.filter,
          sort: view.sort,
          layout: view.layout,
          groupBy: view.groupBy,
        });
        toast('Pinned to the sidebar.', 'success');
      }}
    >
      <IconPlus size={12} /> Save view
    </button>
  );
}

/** A readable default name, built from whatever makes this view different. */
function describeView(category: Category, view: { filter: FilterSpec; groupBy: string | null }): string {
  const bits: string[] = [];
  if (view.filter.favoritesOnly) bits.push('Favourites');
  for (const s of view.filter.statuses) bits.push(category.statusLabels[s] ?? '');
  if (view.filter.minRating > 0) bits.push(`${view.filter.minRating / 2}★+`);
  for (const t of view.filter.tags) bits.push(`#${t}`);
  if (view.filter.text.trim()) bits.push(`“${view.filter.text.trim()}”`);
  const label = bits.filter(Boolean).join(' · ');
  return label ? `${label} — ${category.pluralName}` : category.pluralName;
}

/* ------------------------------------------------------------------ *
 * Filters
 * ------------------------------------------------------------------ */

function FilterMenu({ category }: { category: Category }) {
  const db = useStore((s) => s.db);
  const views = useUi((s) => s.views);
  const setView = useUi((s) => s.setView);
  const view = views[category.id];
  if (!view) return null;

  const { filter } = view;
  const tags = [...new Set(selectEntries(db, category.id).flatMap((e) => e.tags))].sort();
  const active = isFilterActive(filter);

  const items = [
    {
      key: '__fav',
      label: 'Favourites only',
      checked: filter.favoritesOnly,
      onSelect: () => setView(category.id, { filter: { ...filter, favoritesOnly: !filter.favoritesOnly } }),
    },
    ...category.statusLabels.map((label, i) => ({
      key: `status-${i}`,
      label,
      checked: filter.statuses.includes(i),
      onSelect: () =>
        setView(category.id, {
          filter: {
            ...filter,
            statuses: filter.statuses.includes(i)
              ? filter.statuses.filter((s) => s !== i)
              : [...filter.statuses, i],
          },
        }),
    })),
    ...[8, 6, 4].map((min) => ({
      key: `rating-${min}`,
      label: `${min / 2}★ and up`,
      checked: filter.minRating === min,
      onSelect: () => setView(category.id, { filter: { ...filter, minRating: filter.minRating === min ? 0 : min } }),
    })),
    ...tags.map((t) => ({
      key: `tag-${t}`,
      label: `#${t}`,
      checked: filter.tags.includes(t),
      onSelect: () =>
        setView(category.id, {
          filter: {
            ...filter,
            tags: filter.tags.includes(t) ? filter.tags.filter((x) => x !== t) : [...filter.tags, t],
          },
        }),
    })),
  ];

  if (active) {
    items.push({
      key: '__clear',
      label: 'Clear all filters',
      checked: false,
      onSelect: () => setView(category.id, { filter: emptyFilter() }),
    });
  }

  return (
    <Menu
      title="Filter"
      align="right"
      buttonClass={active ? 'btn chip is-on' : 'btn'}
      label={<><IconFilter size={13} />Filter</>}
      items={items}
    />
  );
}

/** A readable summary of what's currently filtered, each piece individually removable. */
function ActiveFilters({ category }: { category: Category }) {
  const views = useUi((s) => s.views);
  const setView = useUi((s) => s.setView);
  const view = views[category.id];
  if (!view) return null;
  const { filter } = view;

  const pills: { key: string; label: string; clear: () => void }[] = [];

  if (filter.favoritesOnly) {
    pills.push({ key: 'fav', label: 'Favourites', clear: () => setView(category.id, { filter: { ...filter, favoritesOnly: false } }) });
  }
  if (filter.minRating > 0) {
    pills.push({ key: 'rating', label: `${filter.minRating / 2}★ and up`, clear: () => setView(category.id, { filter: { ...filter, minRating: 0 } }) });
  }
  for (const s of filter.statuses) {
    pills.push({
      key: `s${s}`,
      label: category.statusLabels[s] ?? String(s),
      clear: () => setView(category.id, { filter: { ...filter, statuses: filter.statuses.filter((x) => x !== s) } }),
    });
  }
  for (const t of filter.tags) {
    pills.push({
      key: `t${t}`,
      label: `#${t}`,
      clear: () => setView(category.id, { filter: { ...filter, tags: filter.tags.filter((x) => x !== t) } }),
    });
  }
  for (const [key, value] of Object.entries(filter.fieldEquals)) {
    pills.push({
      key: `f${key}`,
      label: value,
      clear: () => {
        const next = { ...filter.fieldEquals };
        delete next[key];
        setView(category.id, { filter: { ...filter, fieldEquals: next } });
      },
    });
  }

  if (!pills.length) return null;

  return (
    <div className="chips" style={{ marginBottom: 20 }}>
      {pills.map((p) => (
        <span key={p.key} className="chip is-on">
          {p.label}
          <button className="chip-x" onClick={p.clear} aria-label={`Remove ${p.label} filter`}>
            <IconX size={11} />
          </button>
        </span>
      ))}
      <button className="chip" onClick={() => setView(category.id, { filter: emptyFilter() })}>
        Clear all
      </button>
    </div>
  );
}
