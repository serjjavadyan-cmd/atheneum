import type { Category, Entry, Field, FieldValue, Person } from '../types';
import type { LookupResult } from '../platform';
import { isPersonArray } from './query';
import { parseDuration, uid } from './util';

/**
 * Turning a search result into field values.
 *
 * The rule Nane asked for: fill what's empty, never touch what she typed. So every field is
 * classified before anything is written, and the panel shows both lists — what would change
 * and what is being left alone — so applying is never a surprise.
 */

export interface Proposal {
  field: Field;
  /** The value that would be written. */
  value: FieldValue;
  /** How it will read on the page. */
  preview: string;
}

export interface Plan {
  /** Empty fields the result can fill. */
  fills: Proposal[];
  /** Fields already holding something. Shown, never written. */
  locked: { field: Field; current: string }[];
  /** Field keys the result had data for that this category has no home for. */
  unused: string[];
}

/** A value counts as present if it would render as anything at all. */
export function hasValue(v: FieldValue): boolean {
  if (v === null || v === undefined || v === '') return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'number') return true;
  if (typeof v === 'boolean') return v;
  return true;
}

function toPeople(raw: unknown): Person[] {
  const list = Array.isArray(raw) ? raw : [raw];
  return list
    .map((item) => {
      if (typeof item === 'string') return { id: uid(), name: item.trim() };
      if (item && typeof item === 'object' && 'name' in item) {
        const o = item as { name: string; note?: string };
        return { id: uid(), name: String(o.name).trim(), note: o.note };
      }
      return null;
    })
    .filter((p): p is Person => Boolean(p && p.name));
}

function toStringArray(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : [raw];
  return list
    .map((x) => {
      if (typeof x === 'string') return x.trim();
      if (x && typeof x === 'object' && 'name' in x) return String((x as { name: string }).name).trim();
      return '';
    })
    .filter(Boolean);
}

function firstString(raw: unknown): string | null {
  const arr = toStringArray(raw);
  return arr[0] ?? null;
}

function toNumber(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  const n = Number(String(raw ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** Coerce a provider value into whatever the field actually is. */
export function coerce(raw: unknown, field: Field): FieldValue {
  if (raw === null || raw === undefined || raw === '') return null;

  switch (field.type) {
    case 'people':
      return toPeople(raw);

    case 'multiselect':
    case 'tags':
      return toStringArray(raw);

    case 'select': {
      const value = firstString(raw);
      if (!value) return null;
      // Match an existing choice case-insensitively rather than adding a near-duplicate.
      const match = (field.options ?? []).find((o) => o.toLowerCase() === value.toLowerCase());
      return match ?? value;
    }

    case 'number':
    case 'progress':
      return toNumber(raw);

    case 'rating': {
      const n = toNumber(raw);
      return n === null ? null : Math.max(0, Math.min(10, Math.round(n)));
    }

    case 'duration': {
      if (typeof raw === 'number') return Math.round(raw);
      return parseDuration(String(raw));
    }

    case 'checkbox':
      return Boolean(raw);

    case 'date': {
      const s = String(raw);
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
      const d = new Date(s);
      return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
    }

    case 'longtext':
    case 'text':
    case 'url':
    default: {
      if (Array.isArray(raw)) return toStringArray(raw).join(', ') || null;
      return String(raw).trim() || null;
    }
  }
}

function previewOf(value: FieldValue): string {
  if (value === null || value === undefined) return '';
  if (isPersonArray(value)) {
    return value.map((p) => (p.note ? `${p.name} (${p.note})` : p.name)).join(', ');
  }
  if (Array.isArray(value)) return (value as string[]).join(', ');
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  const s = String(value);
  return s.length > 180 ? `${s.slice(0, 177)}…` : s;
}

function currentOf(value: FieldValue): string {
  const p = previewOf(value);
  return p.length > 60 ? `${p.slice(0, 57)}…` : p;
}

/**
 * Work out exactly what applying a result would do, without doing any of it.
 */
export function planFill(entry: Entry, category: Category, result: LookupResult): Plan {
  const fills: Proposal[] = [];
  const locked: { field: Field; current: string }[] = [];
  const used = new Set<string>();

  for (const field of category.fields) {
    if (field.hidden) continue;

    const incoming = result.fields[field.key];
    const existing = entry.values[field.key];

    if (hasValue(existing)) {
      // Only worth showing as "left alone" if the result actually had something to offer.
      if (incoming !== undefined && incoming !== null && incoming !== '') {
        locked.push({ field, current: currentOf(existing) });
        used.add(field.key);
      }
      continue;
    }

    if (incoming === undefined || incoming === null || incoming === '') continue;

    const value = coerce(incoming, field);
    if (!hasValue(value)) continue;

    fills.push({ field, value, preview: previewOf(value) });
    used.add(field.key);
  }

  const unused = Object.keys(result.fields).filter(
    (k) => !used.has(k) && hasValue(result.fields[k] as FieldValue),
  );

  return { fills, locked, unused };
}

/** The already-filled values worth using to narrow a search. */
export function hintsFrom(entry: Entry, category: Category): Record<string, unknown> {
  const hints: Record<string, unknown> = {};
  for (const field of category.fields) {
    const value = entry.values[field.key];
    if (!hasValue(value)) continue;
    if (field.key === 'author' || field.key === 'director' || field.key === 'creator') {
      hints.author = isPersonArray(value) ? value[0]?.name : String(value);
    }
    if (field.key === 'year' || field.key === 'firstAired') {
      hints.year = typeof value === 'number' ? value : Number(value) || undefined;
    }
  }
  return hints;
}
