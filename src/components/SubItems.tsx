import { useState } from 'react';
import { useStore } from '../store';
import type { Category, Entry, SubItem } from '../types';
import { Rating } from './primitives';
import { IconCheck, IconPlus, IconTrash } from './Icons';

/**
 * The small things inside an entry — episodes of a show, chapters worth remembering, missions,
 * play sessions. Deliberately not a full index: you add only the ones you want to say something
 * about, so an empty list is the normal state and the section stays out of the way until used.
 */

export function SubItems({ entry, category }: { entry: Entry; category: Category }) {
  const addSubItem = useStore((s) => s.addSubItem);
  const label = category.subItemLabel;
  const [justAdded, setJustAdded] = useState<string | null>(null);

  if (!label) return null;

  const items = entry.subItems;
  const done = items.filter((i) => i.done).length;

  return (
    <section className="detail-section">
      <header className="detail-section-head">
        <h2 className="detail-section-title">{label}</h2>
        <span className="row" style={{ gap: 12 }}>
          {items.length > 0 && (
            <span className="field-hint">
              {done} of {items.length} done
            </span>
          )}
          <button className="btn btn-sm" onClick={() => setJustAdded(addSubItem(entry.id))}>
            <IconPlus size={12} /> Add
          </button>
        </span>
      </header>

      {items.length === 0 ? (
        <p className="field-hint">
          Nothing here yet — add the {label.toLowerCase()} you want to remember, not all of them.
        </p>
      ) : (
        <div className="subitems">
          {items.map((item) => (
            <SubItemRow
              key={item.id}
              entryId={entry.id}
              item={item}
              autoFocus={item.id === justAdded}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function SubItemRow({
  entryId, item, autoFocus,
}: { entryId: string; item: SubItem; autoFocus: boolean }) {
  const update = useStore((s) => s.updateSubItem);
  const remove = useStore((s) => s.removeSubItem);
  const [open, setOpen] = useState(autoFocus);

  return (
    <div className={`subitem${item.done ? ' is-done' : ''}${open ? ' is-open' : ''}`}>
      <div className="subitem-head">
        <button
          className={`checkbox${item.done ? ' is-on' : ''}`}
          onClick={() => update(entryId, item.id, { done: !item.done })}
          role="checkbox"
          aria-checked={item.done}
          aria-label={item.done ? 'Mark as not done' : 'Mark as done'}
        >
          <IconCheck size={11} />
        </button>

        <input
          className="input-bare subitem-number"
          value={item.number}
          placeholder="#"
          onChange={(e) => update(entryId, item.id, { number: e.target.value })}
          aria-label="Number"
        />

        <input
          className="input-bare grow"
          value={item.title}
          autoFocus={autoFocus}
          placeholder="Title"
          onChange={(e) => update(entryId, item.id, { title: e.target.value })}
          aria-label="Title"
        />

        <Rating value={item.rating} onChange={(v) => update(entryId, item.id, { rating: v })} />

        <button
          className={`btn-icon${open ? ' is-on' : ''}`}
          onClick={() => setOpen((v) => !v)}
          aria-label="Notes and date"
          title="Notes and date"
        >
          ⋯
        </button>
      </div>

      {open && (
        <div className="subitem-body">
          <textarea
            className="textarea"
            style={{ minHeight: 62 }}
            value={item.note}
            placeholder="What happened, what you thought…"
            onChange={(e) => update(entryId, item.id, { note: e.target.value })}
          />
          <div className="row" style={{ gap: 10, justifyContent: 'space-between' }}>
            <label className="row" style={{ gap: 8 }}>
              <span className="field-label" style={{ margin: 0 }}>On</span>
              <input
                className="input-bare"
                type="date"
                value={item.date ?? ''}
                onChange={(e) => update(entryId, item.id, { date: e.target.value || null })}
              />
            </label>
            <button
              className="btn btn-sm btn-danger"
              onClick={() => remove(entryId, item.id)}
            >
              <IconTrash size={11} /> Remove
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
