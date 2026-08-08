import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useStore } from '../store';
import { useUi } from '../ui';
import type { Entry } from '../types';
import { importImageFile, imagesFromDataTransfer } from '../lib/images';
import { valueToFacets } from '../lib/query';
import { formatDateShort } from '../lib/util';
import { CoverImage, Rating, StatusStepper, coverOf, tintOf, useImageUrl } from './primitives';
import { FieldInput } from './FieldInput';
import { Menu } from './Menu';
import {
  IconArchive, IconChevronLeft, IconHeart, IconHeartOutline, IconImage, IconPlus, IconTrash, IconX,
} from './Icons';

export function EntryDetail({ entry }: { entry: Entry }) {
  const db = useStore((s) => s.db);
  const updateEntry = useStore((s) => s.updateEntry);
  const setValue = useStore((s) => s.setValue);
  const addImage = useStore((s) => s.addImage);
  const removeImage = useStore((s) => s.removeImage);
  const setCover = useStore((s) => s.setCover);
  const setArchived = useStore((s) => s.setArchived);
  const back = useUi((s) => s.back);
  const go = useUi((s) => s.go);
  const toast = useUi((s) => s.toast);

  const category = db.categories.find((c) => c.id === entry.categoryId) ?? null;
  const cover = coverOf(entry);
  const tint = tintOf(entry, category);
  const ambienceUrl = useImageUrl(cover?.file);

  const [dropping, setDropping] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  /* --- suggestions: every value already used for this field, anywhere in the library --- */
  const suggestionsFor = useCallback(
    (fieldKey: string) => {
      const set = new Set<string>();
      for (const e of db.entries) {
        if (e.categoryId !== entry.categoryId) continue;
        for (const facet of valueToFacets(e.values[fieldKey])) set.add(facet);
      }
      return [...set].sort((a, b) => a.localeCompare(b));
    },
    [db.entries, entry.categoryId],
  );

  const tagSuggestions = useMemo(
    () => [...new Set(db.entries.flatMap((e) => e.tags))].sort(),
    [db.entries],
  );

  /* --- image import: drop, paste, or pick ------------------------------------------- */
  const ingest = useCallback(
    async (files: File[]) => {
      if (!files.length) return;
      setImporting(true);
      try {
        for (const file of files) {
          const image = await importImageFile(file);
          addImage(entry.id, image);
        }
        toast(files.length > 1 ? `${files.length} images added` : 'Image added', 'success');
      } catch (e) {
        console.error(e);
        toast(e instanceof Error ? e.message : 'That image could not be read.', 'error');
      } finally {
        setImporting(false);
      }
    },
    [addImage, entry.id, toast],
  );

  // Paste a cover straight from the clipboard while the page is open.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      // Don't hijack pasting text into a field.
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;
      const files = imagesFromDataTransfer(e.clipboardData);
      if (files.length) {
        e.preventDefault();
        void ingest(files);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [ingest]);

  const linkedDays = useMemo(
    () => db.diary.filter((d) => !d.archived && d.linkedEntryIds.includes(entry.id)),
    [db.diary, entry.id],
  );

  const visibleFields = (category?.fields ?? []).filter((f) => !f.hidden);
  const proseFields = visibleFields.filter((f) => f.type === 'longtext');
  const tableFields = visibleFields.filter((f) => f.type !== 'longtext');
  const wideArt = category?.defaultLayout === 'gallery';

  return (
    <div className="detail" style={{ ['--tint' as string]: tint }}>
      <div className="detail-ambience" aria-hidden="true">
        {ambienceUrl ? <img src={ambienceUrl} alt="" /> : <div className="detail-ambience-fallback" />}
      </div>

      <div className="detail-inner">
        <button className="detail-back" onClick={back}>
          <IconChevronLeft size={13} />
          {category?.pluralName ?? 'Back'}
        </button>

        <div className="detail-top">
          {/* ---- cover column ---- */}
          <div>
            <motion.div
              /* Opens with a spring rather than a shared-element handoff — see EntryCard. */
              initial={{ opacity: 0, scale: 0.92, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ type: 'spring', stiffness: 320, damping: 30, mass: 0.7 }}
              className={`detail-cover${wideArt ? ' is-wide' : ''}${dropping ? ' is-dropping' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDropping(true); }}
              onDragLeave={() => setDropping(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDropping(false);
                void ingest(imagesFromDataTransfer(e.dataTransfer));
              }}
            >
              {cover ? (
                <CoverImage image={cover} alt={entry.title} />
              ) : (
                <div className="detail-cover-empty">
                  <span>{importing ? 'Reading…' : 'Drop a cover here'}</span>
                </div>
              )}
            </motion.div>

            {entry.images.length > 1 && (
              <div className="detail-thumbs">
                {entry.images.map((img, i) => (
                  <div key={img.hash} className={`detail-thumb${i === entry.coverIndex ? ' is-cover' : ''}`}>
                    <button onClick={() => setCover(entry.id, i)} title="Make this the cover" style={{ width: '100%', height: '100%' }}>
                      <CoverImage image={img} alt="" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="detail-cover-actions">
              <button className="btn btn-sm" onClick={() => fileInput.current?.click()}>
                <IconImage size={12} /> {entry.images.length ? 'Add image' : 'Choose image'}
              </button>
              {cover && (
                <button className="btn btn-sm btn-danger" onClick={() => removeImage(entry.id, cover.hash)}>
                  <IconX size={12} /> Remove
                </button>
              )}
              <input
                ref={fileInput}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(e) => {
                  void ingest(Array.from(e.target.files ?? []));
                  e.target.value = '';
                }}
              />
            </div>
          </div>

          {/* ---- information column ---- */}
          <div>
            <div className="detail-head">
              <div className="detail-eyebrow">
                {category && (
                  <button className="detail-cat" onClick={() => go({ name: 'category', categoryId: category.id })}>
                    <span>{category.glyph}</span> {category.name}
                  </button>
                )}
              </div>

              <input
                className="input-bare detail-title"
                value={entry.title}
                placeholder="Untitled"
                onChange={(e) => updateEntry(entry.id, { title: e.target.value })}
              />
            </div>

            <div className="detail-actionbar">
              <Rating value={entry.rating} size="lg" onChange={(v) => updateEntry(entry.id, { rating: v })} />

              {category && (
                <StatusStepper
                  status={entry.status}
                  labels={category.statusLabels}
                  onChange={(n) => {
                    // Reaching the final stage stamps a finish date if there isn't one.
                    const isFinal = n === category.statusLabels.length - 1;
                    updateEntry(entry.id, {
                      status: n,
                      ...(isFinal && !entry.dateFinished
                        ? { dateFinished: new Date().toISOString().slice(0, 10) }
                        : {}),
                    });
                  }}
                />
              )}

              <div className="grow" />

              <button
                className={`btn-icon${entry.favorite ? ' is-on' : ''}`}
                onClick={() => updateEntry(entry.id, { favorite: !entry.favorite })}
                title={entry.favorite ? 'Remove from favourites' : 'Add to favourites'}
                aria-pressed={entry.favorite}
              >
                {entry.favorite ? <IconHeart size={14} /> : <IconHeartOutline size={14} />}
              </button>

              <Menu
                buttonClass="btn-icon"
                title="More"
                align="right"
                label="⋯"
                items={[
                  {
                    key: 'archive',
                    label: 'Move to archive',
                    onSelect: () => {
                      setArchived(entry.id, true);
                      toast('Moved to archive — nothing is ever deleted by a sync.', 'success');
                      back();
                    },
                  },
                ]}
              />
            </div>

            {/* ---- field table ---- */}
            <dl className="detail-fields">
              {tableFields.map((field) => (
                <div className="detail-field" key={field.id}>
                  <dt>{field.label}</dt>
                  <dd>
                    <FieldInput
                      field={field}
                      value={entry.values[field.key]}
                      suggestions={field.type === 'tags' ? tagSuggestions : suggestionsFor(field.key)}
                      onChange={(v) => setValue(entry.id, field.key, v)}
                    />
                  </dd>
                </div>
              ))}

              <div className="detail-field">
                <dt>Started</dt>
                <dd>
                  <input
                    className="input-bare"
                    type="date"
                    value={entry.dateStarted ?? ''}
                    onChange={(e) => updateEntry(entry.id, { dateStarted: e.target.value || null })}
                  />
                </dd>
              </div>
              <div className="detail-field">
                <dt>Finished</dt>
                <dd>
                  <input
                    className="input-bare"
                    type="date"
                    value={entry.dateFinished ?? ''}
                    onChange={(e) => updateEntry(entry.id, { dateFinished: e.target.value || null })}
                  />
                </dd>
              </div>
              <div className="detail-field">
                <dt>Tags</dt>
                <dd>
                  <FieldInput
                    field={{ id: 'tags', key: 'tags', label: 'Tags', type: 'tags', hint: 'Add a tag…' }}
                    value={entry.tags}
                    suggestions={tagSuggestions}
                    onChange={(v) => updateEntry(entry.id, { tags: (v as string[]) ?? [] })}
                  />
                </dd>
              </div>
            </dl>
          </div>
        </div>

        {/* ---- prose ---- */}
        {proseFields.map((field) => (
          <section className="detail-section" key={field.id}>
            <header className="detail-section-head">
              <h2 className="detail-section-title">{field.label}</h2>
            </header>
            <FieldInput
              field={field}
              value={entry.values[field.key]}
              onChange={(v) => setValue(entry.id, field.key, v)}
            />
          </section>
        ))}

        <section className="detail-section">
          <header className="detail-section-head">
            <h2 className="detail-section-title">My notes</h2>
          </header>
          <FieldInput
            field={{ id: 'notes', key: 'notes', label: 'Notes', type: 'longtext', hint: 'What you thought…' }}
            value={entry.notes}
            onChange={(v) => updateEntry(entry.id, { notes: (v as string) ?? '' })}
          />
        </section>

        {linkedDays.length > 0 && (
          <section className="detail-section">
            <header className="detail-section-head">
              <h2 className="detail-section-title">Days you wrote about this</h2>
            </header>
            <div className="chips">
              {linkedDays.map((d) => (
                <button key={d.id} className="chip" onClick={() => go({ name: 'diary' })}>
                  {formatDateShort(d.date)}
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Archive
 * ------------------------------------------------------------------ */

export function ArchiveView() {
  const db = useStore((s) => s.db);
  const setArchived = useStore((s) => s.setArchived);
  const destroyEntry = useStore((s) => s.destroyEntry);
  const toast = useUi((s) => s.toast);
  const go = useUi((s) => s.go);

  const archived = db.entries.filter((e) => e.archived);

  return (
    <>
      <div className="topbar">
        <div className="topbar-title">
          <span>Archive</span>
          <span className="count">{archived.length}</span>
        </div>
      </div>
      <div className="content">
        <div className="content-pad">
          <p className="muted" style={{ maxWidth: 560, marginBottom: 24, fontSize: 13 }}>
            Archiving is how things leave the library. Nothing here is gone — it still syncs, and
            you can put it back at any time. Deleting for good happens only from this page, only on
            this computer, and never travels to your other machine.
          </p>

          {archived.length === 0 ? (
            <div className="empty">
              <div className="empty-mark"><IconArchive size={28} /></div>
              <div className="empty-title">The archive is empty</div>
            </div>
          ) : (
            <div className="list">
              {archived.map((e) => {
                const category = db.categories.find((c) => c.id === e.categoryId) ?? null;
                return (
                  <div className="list-row" key={e.id} style={{ gridTemplateColumns: '34px minmax(0,2fr) minmax(0,1fr) 200px' }}>
                    <span className="list-thumb">
                      {coverOf(e) ? <CoverImage image={coverOf(e)} alt="" /> : null}
                    </span>
                    <span className="list-title">{e.title}</span>
                    <span className="list-cell">{category?.name ?? '—'}</span>
                    <span className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                      <button
                        className="btn btn-sm"
                        onClick={() => { setArchived(e.id, false); toast('Restored', 'success'); }}
                      >
                        <IconPlus size={11} /> Restore
                      </button>
                      <button
                        className="btn btn-sm btn-danger"
                        onClick={() => {
                          if (!confirm(`Delete “${e.title}” for good? This cannot be undone, and it only affects this computer.`)) return;
                          destroyEntry(e.id);
                          toast('Deleted for good on this computer.');
                        }}
                      >
                        <IconTrash size={11} /> Delete
                      </button>
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          <button className="btn" style={{ marginTop: 24 }} onClick={() => go({ name: 'category', categoryId: db.categories[0]?.id ?? 'books' })}>
            Back to the library
          </button>
        </div>
      </div>
    </>
  );
}
