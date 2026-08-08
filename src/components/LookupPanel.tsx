import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useStore } from '../store';
import { useUi } from '../ui';
import { platform } from '../platform';
import type { LookupResponse, LookupResult } from '../platform';
import type { Category, Entry } from '../types';
import { hintsFrom, planFill, type Plan } from '../lib/applyLookup';
import { IconCheck, IconImage, IconSearch, IconX } from './Icons';

/**
 * Pick a match, see exactly what it would change, then apply.
 *
 * Two modes. `details` fills empty fields and can optionally take the cover too; `cover` only
 * ever touches the artwork. Either way nothing is written until the Apply button is pressed,
 * and fields that already hold something are shown as untouchable rather than quietly skipped.
 */

interface Props {
  entry: Entry;
  category: Category;
  mode: 'details' | 'cover';
  onClose: () => void;
}

export function LookupPanel({ entry, category, mode, onClose }: Props) {
  const db = useStore((s) => s.db);
  const setValue = useStore((s) => s.setValue);
  const addImage = useStore((s) => s.addImage);
  const toast = useUi((s) => s.toast);

  const [query, setQuery] = useState(entry.title);
  const [source, setSource] = useState<string | null>(null);
  const [response, setResponse] = useState<LookupResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [chosen, setChosen] = useState<LookupResult | null>(null);
  const [alsoCover, setAlsoCover] = useState(true);
  const [applying, setApplying] = useState(false);

  const keys = {
    tmdbKey: db.settings.tmdbKey,
    igdbClientId: db.settings.igdbClientId,
    igdbClientSecret: db.settings.igdbClientSecret,
    omdbKey: db.settings.omdbKey,
  };

  const run = useCallback(
    async (q: string, forced: string | null) => {
      if (!q.trim()) return;
      setBusy(true);
      setChosen(null);
      try {
        const res = await platform.lookupSearch(
          category.id, q, hintsFrom(entry, category), keys, forced,
        );
        setResponse(res);
        // A single confident hit still needs approving, but pre-selecting saves a click.
        if (res.results.length === 1) setChosen(res.results[0]);
      } catch (e) {
        setResponse({
          results: [],
          notes: [e instanceof Error ? e.message : 'The search failed.'],
          sources: [],
        });
      } finally {
        setBusy(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [category.id, entry.id],
  );

  useEffect(() => { void run(entry.title, null); }, [run, entry.title]);

  const plan: Plan | null = chosen ? planFill(entry, category, chosen) : null;

  const apply = async () => {
    if (!chosen) return;
    setApplying(true);
    try {
      let filled = 0;

      if (mode === 'details' && plan) {
        for (const proposal of plan.fills) {
          setValue(entry.id, proposal.field.key, proposal.value);
          filled++;
        }
      }

      const wantsCover = mode === 'cover' || (mode === 'details' && alsoCover);
      let gotCover = false;
      if (wantsCover && chosen.coverUrl) {
        try {
          const saved = await platform.lookupCover(chosen.coverUrl);
          addImage(entry.id, {
            hash: saved.hash,
            file: saved.file,
            width: 0,
            height: 0,
            // The tint is sampled locally on next render; a neutral placeholder until then.
            tint: `${category.hue} 40% 55%`,
          });
          gotCover = true;
        } catch (e) {
          toast(e instanceof Error ? e.message : 'The cover could not be downloaded.', 'error');
        }
      }

      const bits = [
        filled > 0 && `${filled} ${filled === 1 ? 'field' : 'fields'} filled`,
        gotCover && 'cover added',
      ].filter(Boolean);
      toast(bits.length ? `Done — ${bits.join(', ')}.` : 'Nothing to add.', 'success');
      onClose();
    } finally {
      setApplying(false);
    }
  };

  const missingKeyNote = response?.notes.find((n) => n.includes('Settings'));

  return (
    <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <motion.div
        className="modal modal-lg lookup"
        style={{ ['--tint' as string]: `${category.hue} 55% 60%` }}
        initial={{ opacity: 0, y: 10, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="modal-head">
          <span className="modal-title">
            {mode === 'cover' ? 'Find a cover' : 'Fill in the details'}
          </span>
          <button className="btn-icon" onClick={onClose} aria-label="Close"><IconX size={14} /></button>
        </div>

        <div className="lookup-search">
          <span className="search-icon"><IconSearch size={14} /></span>
          <input
            className="input-bare grow"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void run(query, source); }}
            placeholder="Title to search for…"
            aria-label="Search"
          />
          {response && response.sources.length > 0 && (
            <select
              className="select"
              style={{ width: 178, flex: '0 0 auto' }}
              value={source ?? ''}
              onChange={(e) => {
                const next = e.target.value || null;
                setSource(next);
                void run(query, next);
              }}
              aria-label="Source"
            >
              <option value="">Best sources</option>
              {response.sources.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
          )}
          <button className="btn" onClick={() => void run(query, source)} disabled={busy}>
            {busy ? 'Searching…' : 'Search'}
          </button>
        </div>

        <div className="modal-body lookup-body">
          {missingKeyNote && (
            <div className="lookup-note">
              {missingKeyNote}
              <button className="chip" onClick={() => { onClose(); useUi.getState().go({ name: 'settings' }); }}>
                Open Settings
              </button>
            </div>
          )}

          {busy && <p className="field-hint">Looking…</p>}

          {!busy && response && response.results.length === 0 && (
            <div className="empty" style={{ padding: '40px 20px' }}>
              <div className="empty-title">Nothing found</div>
              <div className="empty-body">
                {response.notes.filter((n) => n !== missingKeyNote).join(' ') ||
                  'Try a shorter title, or pick a different source above.'}
              </div>
            </div>
          )}

          {!busy && response && response.results.length > 0 && (
            <div className="lookup-results">
              {response.results.map((r) => (
                <button
                  key={r.id}
                  className={`lookup-card${chosen?.id === r.id ? ' is-chosen' : ''}`}
                  onClick={() => setChosen(r)}
                >
                  <span className="lookup-art">
                    {r.coverUrl
                      ? <img src={r.coverUrl} alt="" loading="lazy" referrerPolicy="no-referrer" />
                      : <span className="lookup-art-empty">{category.glyph}</span>}
                    {chosen?.id === r.id && (
                      <span className="lookup-tick"><IconCheck size={12} /></span>
                    )}
                  </span>
                  <span className="lookup-meta">
                    <span className="lookup-title">{r.title}</span>
                    <span className="lookup-sub">
                      {[r.year, r.source].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}

          {plan && mode === 'details' && (
            <div className="lookup-plan">
              <h3 className="lookup-plan-title">
                {plan.fills.length > 0
                  ? `Will fill ${plan.fills.length} empty ${plan.fills.length === 1 ? 'field' : 'fields'}`
                  : 'Nothing left to fill'}
              </h3>

              {plan.fills.length > 0 && (
                <dl className="lookup-diff">
                  {plan.fills.map((p) => (
                    <div key={p.field.id}>
                      <dt>{p.field.label}</dt>
                      <dd>{p.preview}</dd>
                    </div>
                  ))}
                </dl>
              )}

              {plan.locked.length > 0 && (
                <>
                  <h3 className="lookup-plan-title is-quiet">
                    Leaving your own {plan.locked.length === 1 ? 'entry' : 'entries'} alone
                  </h3>
                  <dl className="lookup-diff is-locked">
                    {plan.locked.map((l) => (
                      <div key={l.field.id}>
                        <dt>{l.field.label}</dt>
                        <dd>{l.current}</dd>
                      </div>
                    ))}
                  </dl>
                </>
              )}
            </div>
          )}
        </div>

        <div className="modal-foot">
          {mode === 'details' && chosen?.coverUrl && (
            <label className="row grow" style={{ gap: 8, cursor: 'pointer' }}>
              <span className={`checkbox${alsoCover ? ' is-on' : ''}`} onClick={() => setAlsoCover(!alsoCover)}>
                <IconCheck size={11} />
              </span>
              <span style={{ fontSize: 12.5 }} onClick={() => setAlsoCover(!alsoCover)}>
                Take the cover too
              </span>
            </label>
          )}
          {!(mode === 'details' && chosen?.coverUrl) && <span className="grow" />}

          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            disabled={!chosen || applying || (mode === 'cover' && !chosen?.coverUrl)}
            onClick={() => void apply()}
          >
            {applying ? 'Applying…' : mode === 'cover'
              ? <><IconImage size={12} /> Use this cover</>
              : 'Apply'}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
