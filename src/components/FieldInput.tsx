import { useEffect, useRef, useState } from 'react';
import type { Field, FieldValue, Person } from '../types';
import { formatDuration, parseDuration, uid } from '../lib/util';
import { isPersonArray } from '../lib/query';
import { Checkbox, Rating } from './primitives';
import { IconPlus, IconX } from './Icons';

/**
 * One editor per field type. The detail page is always editable — there is no separate
 * "edit mode" to enter and forget to leave.
 */

interface Props {
  field: Field;
  value: FieldValue;
  onChange: (value: FieldValue) => void;
  /** Every known value for this field across the library, offered as suggestions. */
  suggestions?: string[];
}

export function FieldInput({ field, value, onChange, suggestions = [] }: Props) {
  switch (field.type) {
    case 'longtext':
      return <AutoTextarea value={asString(value)} onChange={onChange} hint={field.hint} />;

    case 'number':
      return (
        <input
          className="input-bare"
          type="number"
          value={value == null || value === '' ? '' : String(value)}
          placeholder={field.hint ?? '—'}
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        />
      );

    case 'rating':
      return (
        <Rating
          value={typeof value === 'number' ? value : 0}
          onChange={(v) => onChange(v)}
        />
      );

    case 'date':
      return (
        <input
          className="input-bare"
          type="date"
          value={asString(value)}
          onChange={(e) => onChange(e.target.value || null)}
        />
      );

    case 'checkbox':
      return (
        <Checkbox checked={value === true} onChange={(v) => onChange(v)} />
      );

    case 'duration':
      return <DurationInput value={typeof value === 'number' ? value : null} onChange={onChange} />;

    case 'progress':
      return (
        <input
          className="input-bare"
          type="number"
          min={0}
          value={value == null || value === '' ? '' : String(value)}
          placeholder={field.hint ?? '0'}
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        />
      );

    case 'select':
      return (
        <select
          className="select"
          value={asString(value)}
          onChange={(e) => onChange(e.target.value || null)}
        >
          <option value="">—</option>
          {(field.options ?? []).map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      );

    case 'multiselect':
      return (
        <TokenInput
          tokens={asStringArray(value)}
          onChange={(t) => onChange(t)}
          options={field.options ?? []}
          placeholder={field.hint ?? 'Add…'}
        />
      );

    case 'tags':
      return (
        <TokenInput
          tokens={asStringArray(value)}
          onChange={(t) => onChange(t)}
          options={suggestions}
          allowFree
          placeholder={field.hint ?? 'Add a tag…'}
        />
      );

    case 'people':
      return (
        <PeopleInput
          people={isPersonArray(value) ? value : []}
          onChange={(p) => onChange(p)}
          suggestions={suggestions}
          hint={field.hint}
        />
      );

    case 'url':
      return (
        <input
          className="input-bare"
          type="url"
          value={asString(value)}
          placeholder={field.hint ?? 'https://'}
          onChange={(e) => onChange(e.target.value || null)}
        />
      );

    case 'text':
    default:
      return (
        <input
          className="input-bare"
          value={asString(value)}
          placeholder={field.hint ?? '—'}
          onChange={(e) => onChange(e.target.value || null)}
        />
      );
  }
}

function asString(v: FieldValue): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  return '';
}

function asStringArray(v: FieldValue): string[] {
  if (Array.isArray(v) && !isPersonArray(v)) return v as string[];
  return [];
}

/* ------------------------------------------------------------------ *
 * Textarea that grows with its content — no inner scrollbar, ever
 * ------------------------------------------------------------------ */

function AutoTextarea({
  value, onChange, hint,
}: { value: string; onChange: (v: string) => void; hint?: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      className="textarea prose"
      style={{ minHeight: 70, overflow: 'hidden' }}
      value={value}
      placeholder={hint ?? 'Write…'}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/* ------------------------------------------------------------------ *
 * Duration — accepts "2h 14m", "134", "1:34"
 * ------------------------------------------------------------------ */

function DurationInput({
  value, onChange,
}: { value: number | null; onChange: (v: FieldValue) => void }) {
  const [text, setText] = useState(() => formatDuration(value));
  const [focused, setFocused] = useState(false);

  // While focused the raw text is the source of truth; when not, show the formatted value.
  useEffect(() => {
    if (!focused) setText(formatDuration(value));
  }, [value, focused]);

  return (
    <input
      className="input-bare"
      value={text}
      placeholder="2h 14m"
      onFocus={() => setFocused(true)}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        setFocused(false);
        onChange(parseDuration(text));
      }}
    />
  );
}

/* ------------------------------------------------------------------ *
 * Tokens — multiselect and tags
 * ------------------------------------------------------------------ */

function TokenInput({
  tokens, onChange, options, allowFree = false, placeholder,
}: {
  tokens: string[];
  onChange: (tokens: string[]) => void;
  options: string[];
  allowFree?: boolean;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState('');
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const add = (t: string) => {
    const clean = t.trim();
    if (!clean || tokens.includes(clean)) { setDraft(''); return; }
    onChange([...tokens, clean]);
    setDraft('');
  };

  const remaining = options.filter(
    (o) => !tokens.includes(o) && o.toLowerCase().includes(draft.trim().toLowerCase()),
  );

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <div className="chips" style={{ alignItems: 'center' }}>
        {tokens.map((t) => (
          <span key={t} className="chip">
            {t}
            <button className="chip-x" onClick={() => onChange(tokens.filter((x) => x !== t))} aria-label={`Remove ${t}`}>
              <IconX size={11} />
            </button>
          </span>
        ))}
        <input
          className="input-bare"
          style={{ width: 130, fontSize: 12.5, margin: 0, padding: '3px 6px' }}
          value={draft}
          placeholder={tokens.length ? '' : placeholder}
          onFocus={() => setOpen(true)}
          onChange={(e) => { setDraft(e.target.value); setOpen(true); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              if (allowFree || options.includes(draft.trim())) add(draft);
              else if (remaining.length) add(remaining[0]);
            }
            if (e.key === 'Backspace' && !draft && tokens.length) {
              onChange(tokens.slice(0, -1));
            }
            if (e.key === 'Escape') setOpen(false);
          }}
        />
      </div>

      {open && (remaining.length > 0 || (allowFree && draft.trim())) && (
        <div className="dropdown">
          {allowFree && draft.trim() && !options.includes(draft.trim()) && (
            <button className="dropdown-item" onMouseDown={(e) => { e.preventDefault(); add(draft); }}>
              <IconPlus size={12} /> Add “{draft.trim()}”
            </button>
          )}
          {remaining.slice(0, 40).map((o) => (
            <button
              key={o}
              className="dropdown-item"
              onMouseDown={(e) => { e.preventDefault(); add(o); }}
            >
              {o}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * People — author, director, cast, characters, anyone
 * ------------------------------------------------------------------ */

function PeopleInput({
  people, onChange, suggestions, hint,
}: {
  people: Person[];
  onChange: (people: Person[]) => void;
  suggestions: string[];
  hint?: string;
}) {
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<string | null>(null);

  const add = (name: string) => {
    const clean = name.trim();
    if (!clean) return;
    onChange([...people, { id: uid(), name: clean }]);
    setDraft('');
  };

  const matches = draft.trim()
    ? suggestions
        .filter((s) => s.toLowerCase().includes(draft.trim().toLowerCase()))
        .filter((s) => !people.some((p) => p.name === s))
        .slice(0, 8)
    : [];

  return (
    <div style={{ position: 'relative' }}>
      <div className="people">
        {people.map((p) => (
          <span key={p.id} className="person">
            {editing === p.id ? (
              <input
                className="input-bare"
                style={{ width: 150, fontSize: 12.5, margin: 0, padding: '2px 4px' }}
                autoFocus
                defaultValue={p.note ?? ''}
                placeholder="as… (role)"
                onBlur={(e) => {
                  onChange(people.map((x) => (x.id === p.id ? { ...x, note: e.target.value.trim() || undefined } : x)));
                  setEditing(null);
                }}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur(); }}
              />
            ) : (
              <>
                <button onClick={() => setEditing(p.id)} title="Add a role note">{p.name}</button>
                {p.note && <span className="person-note">{p.note}</span>}
              </>
            )}
            <button
              className="chip-x"
              onClick={() => onChange(people.filter((x) => x.id !== p.id))}
              aria-label={`Remove ${p.name}`}
            >
              <IconX size={11} />
            </button>
          </span>
        ))}
        <input
          className="input-bare"
          style={{ width: 150, fontSize: 12.5, margin: 0, padding: '3px 6px' }}
          value={draft}
          placeholder={people.length ? 'Add…' : hint ?? 'Add a name…'}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); add(draft); }
            if (e.key === 'Backspace' && !draft && people.length) onChange(people.slice(0, -1));
          }}
          onBlur={() => { if (draft.trim()) add(draft); }}
        />
      </div>

      {matches.length > 0 && (
        <div className="dropdown">
          {matches.map((m) => (
            <button key={m} className="dropdown-item" onMouseDown={(e) => { e.preventDefault(); add(m); }}>
              {m}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
