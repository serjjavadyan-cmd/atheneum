import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  DndContext, PointerSensor, closestCenter, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext, useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useStore } from '../store';
import { useUi } from '../ui';
import type { Category, Field, FieldType, Layout } from '../types';
import { IconDrag, IconPlus, IconTrash, IconX } from './Icons';
import { Checkbox } from './primitives';

/**
 * Everything about a category is editable here: what it's called, its mark and colour, the
 * stages an entry moves through, and the fields it holds.
 *
 * Fields are never truly removed — a field you delete is marked `hidden`, which stops it being
 * shown or edited while leaving every stored value intact. Removing it outright would destroy
 * data on this machine and then propagate that loss to the other one at the next sync.
 */

const FIELD_TYPES: { type: FieldType; label: string; note: string }[] = [
  { type: 'text', label: 'Text', note: 'A short line' },
  { type: 'longtext', label: 'Long text', note: 'A paragraph, shown as its own section' },
  { type: 'number', label: 'Number', note: 'Year, page count, hours' },
  { type: 'rating', label: 'Rating', note: 'Five stars, half steps' },
  { type: 'date', label: 'Date', note: 'A calendar date' },
  { type: 'select', label: 'Choice', note: 'One from a list you define' },
  { type: 'multiselect', label: 'Multiple choice', note: 'Several from a list' },
  { type: 'people', label: 'People', note: 'Author, director, cast, characters' },
  { type: 'tags', label: 'Tags', note: 'Free-form labels' },
  { type: 'url', label: 'Link', note: 'A web address' },
  { type: 'checkbox', label: 'Yes / no', note: 'A single tick' },
  { type: 'progress', label: 'Progress', note: 'How far through, e.g. volumes read' },
  { type: 'duration', label: 'Duration', note: 'Accepts "2h 14m"' },
];

const GLYPHS = ['❦', '☾', '▭', '⌘', '◈', '⬢', '⌖', '✦', '❖', '◇', '☘', '⚑', '♪', '☕', '✿', '⌬', '◐', '⊹'];

export function CategoryEditor() {
  const editingId = useUi((s) => s.editingCategoryId);
  const editCategory = useUi((s) => s.editCategory);
  const db = useStore((s) => s.db);
  const category = db.categories.find((c) => c.id === editingId) ?? null;

  if (!category) return null;
  return <Editor category={category} onClose={() => editCategory(null)} />;
}

function Editor({ category, onClose }: { category: Category; onClose: () => void }) {
  const db = useStore((s) => s.db);
  const updateCategory = useStore((s) => s.updateCategory);
  const addField = useStore((s) => s.addField);
  const reorderFields = useStore((s) => s.reorderFields);
  const toast = useUi((s) => s.toast);

  const [tab, setTab] = useState<'about' | 'fields' | 'stages'>('about');

  const entryCount = db.entries.filter((e) => e.categoryId === category.id && !e.archived).length;
  const visibleFields = category.fields.filter((f) => !f.hidden);
  const hiddenFields = category.fields.filter((f) => f.hidden);

  const sensors = useSensors(
    // A small distance threshold so clicking a field's controls doesn't start a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = visibleFields.map((f) => f.id);
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    reorderFields(category.id, ids);
  };

  return (
    <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <motion.div
        className="modal modal-lg"
        style={{ ['--tint' as string]: `${category.hue} 55% 60%` }}
        initial={{ opacity: 0, y: 10, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="modal-head">
          <span className="modal-title">
            <span style={{ color: 'hsl(var(--tint))', marginRight: 9 }}>{category.glyph}</span>
            {category.pluralName}
          </span>
          <div className="segmented">
            <button className={tab === 'about' ? 'is-on' : ''} onClick={() => setTab('about')}>About</button>
            <button className={tab === 'fields' ? 'is-on' : ''} onClick={() => setTab('fields')}>
              Fields <span className="muted">{visibleFields.length}</span>
            </button>
            <button className={tab === 'stages' ? 'is-on' : ''} onClick={() => setTab('stages')}>Stages</button>
          </div>
          <button className="btn-icon" onClick={onClose} aria-label="Close"><IconX size={14} /></button>
        </div>

        <div className="modal-body">
          {tab === 'about' && (
            <>
              <div className="row" style={{ gap: 12, alignItems: 'flex-end' }}>
                <div className="field-row grow">
                  <label className="field-label" htmlFor="cat-singular">Singular</label>
                  <input
                    id="cat-singular"
                    className="input"
                    value={category.name}
                    onChange={(e) => updateCategory(category.id, { name: e.target.value })}
                  />
                  <span className="field-hint">Used on buttons: "Add a {category.name.toLowerCase()}"</span>
                </div>
                <div className="field-row grow">
                  <label className="field-label" htmlFor="cat-plural">Plural</label>
                  <input
                    id="cat-plural"
                    className="input"
                    value={category.pluralName}
                    onChange={(e) => updateCategory(category.id, { pluralName: e.target.value })}
                  />
                  <span className="field-hint">Used in the sidebar and headings</span>
                </div>
              </div>

              <div className="field-row">
                <span className="field-label">Mark</span>
                <div className="chips">
                  {GLYPHS.map((g) => (
                    <button
                      key={g}
                      className={`glyph-swatch${category.glyph === g ? ' is-on' : ''}`}
                      onClick={() => updateCategory(category.id, { glyph: g })}
                      aria-label={`Use ${g}`}
                    >
                      {g}
                    </button>
                  ))}
                  <input
                    className="input"
                    style={{ width: 62, textAlign: 'center' }}
                    value={category.glyph}
                    maxLength={2}
                    onChange={(e) => updateCategory(category.id, { glyph: e.target.value })}
                    aria-label="Custom mark"
                  />
                </div>
                <span className="field-hint">Any character or emoji works.</span>
              </div>

              <div className="field-row">
                <label className="field-label" htmlFor="cat-hue">Colour</label>
                <input
                  id="cat-hue"
                  type="range"
                  min={0}
                  max={360}
                  value={category.hue}
                  className="hue-slider"
                  onChange={(e) => updateCategory(category.id, { hue: Number(e.target.value) })}
                />
                <span className="field-hint">
                  Only used where an entry has no cover of its own — real artwork always wins.
                </span>
              </div>

              <div className="field-row">
                <span className="field-label">Default layout</span>
                <div className="segmented">
                  {(['grid', 'list', 'gallery'] as Layout[]).map((l) => (
                    <button
                      key={l}
                      className={category.defaultLayout === l ? 'is-on' : ''}
                      onClick={() => updateCategory(category.id, { defaultLayout: l })}
                    >
                      {l[0].toUpperCase() + l.slice(1)}
                    </button>
                  ))}
                </div>
                <span className="field-hint">
                  Gallery uses wide artwork — good for places, poor for book covers.
                </span>
              </div>

              <div className="danger-zone">
                <div>
                  <div style={{ fontSize: 13 }}>Hide this category</div>
                  <span className="field-hint">
                    It disappears from the sidebar. Its {entryCount} {entryCount === 1 ? 'entry stays' : 'entries stay'} in
                    the file and come back if you unhide it — nothing is deleted.
                  </span>
                </div>
                <button
                  className="btn btn-danger"
                  onClick={() => {
                    updateCategory(category.id, { hidden: true });
                    toast(`${category.pluralName} hidden. Nothing was deleted.`, 'success');
                    onClose();
                  }}
                >
                  Hide
                </button>
              </div>
            </>
          )}

          {tab === 'fields' && (
            <>
              <p className="field-hint">
                Drag to reorder. The order here is the order on every entry's page.
              </p>

              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                <SortableContext items={visibleFields.map((f) => f.id)} strategy={verticalListSortingStrategy}>
                  <div className="field-list">
                    {visibleFields.map((f) => (
                      <SortableField key={f.id} field={f} categoryId={category.id} />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>

              <button
                className="btn"
                style={{ alignSelf: 'flex-start' }}
                onClick={() => addField(category.id, { label: 'New field', type: 'text' })}
              >
                <IconPlus size={13} /> Add a field
              </button>

              {hiddenFields.length > 0 && (
                <div className="field-row" style={{ marginTop: 10 }}>
                  <span className="field-label">Removed fields</span>
                  <span className="field-hint">
                    Still holding data. Bring one back and its old values reappear.
                  </span>
                  <div className="chips" style={{ marginTop: 6 }}>
                    {hiddenFields.map((f) => (
                      <RestoreField key={f.id} field={f} categoryId={category.id} />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {tab === 'stages' && <StagesTab category={category} />}
        </div>

        <div className="modal-foot">
          <span className="field-hint grow">Changes save as you make them.</span>
          <button className="btn btn-primary" onClick={onClose}>Done</button>
        </div>
      </motion.div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * A draggable field row
 * ------------------------------------------------------------------ */

function SortableField({ field, categoryId }: { field: Field; categoryId: string }) {
  const updateField = useStore((s) => s.updateField);
  const db = useStore((s) => s.db);
  const toast = useUi((s) => s.toast);
  const [open, setOpen] = useState(false);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: field.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.55 : 1,
    zIndex: isDragging ? 5 : undefined,
  };

  const usesOptions = field.type === 'select' || field.type === 'multiselect';
  // How many entries actually have something stored under this key — makes "removing" it honest.
  const filled = db.entries.filter(
    (e) => e.categoryId === categoryId && e.values[field.key] != null && e.values[field.key] !== '',
  ).length;

  return (
    <div ref={setNodeRef} style={style} className={`field-item${open ? ' is-open' : ''}`}>
      <div className="field-item-head">
        <button className="field-grip" {...attributes} {...listeners} aria-label="Reorder">
          <IconDrag size={14} />
        </button>

        <input
          className="input-bare grow"
          value={field.label}
          onChange={(e) => updateField(categoryId, field.id, { label: e.target.value })}
          aria-label="Field name"
        />

        <select
          className="select"
          style={{ width: 152, flex: '0 0 auto' }}
          value={field.type}
          onChange={(e) => updateField(categoryId, field.id, { type: e.target.value as FieldType })}
          aria-label="Field type"
        >
          {FIELD_TYPES.map((t) => (
            <option key={t.type} value={t.type}>{t.label}</option>
          ))}
        </select>

        <button
          className={`btn-icon${open ? ' is-on' : ''}`}
          onClick={() => setOpen((v) => !v)}
          aria-label="Field options"
          title="More"
        >
          ⋯
        </button>
      </div>

      {open && (
        <div className="field-item-body">
          <span className="field-hint">
            {FIELD_TYPES.find((t) => t.type === field.type)?.note}
          </span>

          <div className="field-row">
            <label className="field-label">Hint shown while editing</label>
            <input
              className="input"
              value={field.hint ?? ''}
              placeholder="optional"
              onChange={(e) => updateField(categoryId, field.id, { hint: e.target.value || undefined })}
            />
          </div>

          {usesOptions && (
            <div className="field-row">
              <label className="field-label">Choices</label>
              <textarea
                className="textarea"
                style={{ minHeight: 76 }}
                value={(field.options ?? []).join('\n')}
                placeholder={'One per line'}
                onChange={(e) =>
                  updateField(categoryId, field.id, {
                    options: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean),
                  })
                }
              />
              <span className="field-hint">One per line.</span>
            </div>
          )}

          <Checkbox
            checked={Boolean(field.showOnCard)}
            onChange={(v) => updateField(categoryId, field.id, { showOnCard: v })}
            label="Show under the title on cards"
          />

          <div className="danger-zone">
            <div>
              <div style={{ fontSize: 13 }}>Remove this field</div>
              <span className="field-hint">
                {filled > 0
                  ? `${filled} ${filled === 1 ? 'entry has' : 'entries have'} a value here. It is kept and comes back if you restore the field.`
                  : 'No entry uses it yet.'}
              </span>
            </div>
            <button
              className="btn btn-danger"
              onClick={() => {
                updateField(categoryId, field.id, { hidden: true });
                toast(`“${field.label}” removed. Its values are kept.`, 'success');
              }}
            >
              <IconTrash size={12} /> Remove
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function RestoreField({ field, categoryId }: { field: Field; categoryId: string }) {
  const updateField = useStore((s) => s.updateField);
  return (
    <button className="chip" onClick={() => updateField(categoryId, field.id, { hidden: false })}>
      <IconPlus size={11} /> {field.label}
    </button>
  );
}

/* ------------------------------------------------------------------ *
 * Stages
 * ------------------------------------------------------------------ */

function StagesTab({ category }: { category: Category }) {
  const updateCategory = useStore((s) => s.updateCategory);
  const db = useStore((s) => s.db);
  const toast = useUi((s) => s.toast);
  const labels = category.statusLabels;

  const setLabel = (i: number, value: string) => {
    const next = [...labels];
    next[i] = value;
    updateCategory(category.id, { statusLabels: next });
  };

  const remove = (i: number) => {
    if (labels.length <= 1) return;
    // Entries sitting on or past the removed stage would otherwise point at nothing.
    const stranded = db.entries.filter((e) => e.categoryId === category.id && e.status >= i).length;
    if (stranded > 0 && !confirm(
      `${stranded} ${stranded === 1 ? 'entry is' : 'entries are'} at or past “${labels[i]}”. ` +
      `They will move to the nearest remaining stage. Continue?`,
    )) return;

    updateCategory(category.id, { statusLabels: labels.filter((_, n) => n !== i) });
    toast(`Stage “${labels[i]}” removed.`);
  };

  return (
    <>
      <p className="field-hint">
        The stages an entry moves through, in order. These appear as the stepper on every entry
        and as the status filter.
      </p>

      <div className="field-list">
        {labels.map((label, i) => (
          <div className="field-item" key={i}>
            <div className="field-item-head">
              <span className="stage-index">{i + 1}</span>
              <input
                className="input-bare grow"
                value={label}
                onChange={(e) => setLabel(i, e.target.value)}
                aria-label={`Stage ${i + 1}`}
              />
              <span className="field-hint" style={{ flex: '0 0 auto' }}>
                {db.entries.filter((e) => e.categoryId === category.id && e.status === i && !e.archived).length}
              </span>
              <button
                className="btn-icon"
                onClick={() => remove(i)}
                disabled={labels.length <= 1}
                aria-label={`Remove ${label}`}
              >
                <IconTrash size={13} />
              </button>
            </div>
          </div>
        ))}
      </div>

      <button
        className="btn"
        style={{ alignSelf: 'flex-start' }}
        onClick={() => updateCategory(category.id, { statusLabels: [...labels, 'New stage'] })}
      >
        <IconPlus size={13} /> Add a stage
      </button>

      <p className="field-hint">
        A stage whose name reads as giving up — abandoned, dropped, shelved, paused — is treated
        as a dead end rather than completion, so it never shows the finished marker.
      </p>
    </>
  );
}
