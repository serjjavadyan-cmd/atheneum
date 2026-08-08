export function uid(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function now(): string {
  return new Date().toISOString();
}

/** "The Left Hand of Darkness" → "left hand of darkness", so A–Z sorts the way people expect. */
const LEADING_ARTICLE = /^(the|a|an|le|la|les|el|los|las|il|lo|der|die|das|de|het)\s+/i;

export function toSortTitle(title: string): string {
  return title.trim().replace(LEADING_ARTICLE, '').toLocaleLowerCase();
}

/** ISO date for a Date, in local time — `toISOString` would shift across midnight. */
export function isoDate(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseIsoDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function formatDate(s: string | null | undefined): string {
  if (!s) return '';
  const d = s.length === 10 ? parseIsoDate(s) : new Date(s);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
}

export function formatDateShort(s: string | null | undefined): string {
  if (!s) return '';
  const d = s.length === 10 ? parseIsoDate(s) : new Date(s);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Minutes → "2h 14m". */
export function formatDuration(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes) || minutes <= 0) return '';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (!h) return `${m}m`;
  if (!m) return `${h}h`;
  return `${h}h ${m}m`;
}

/** "2h 14m", "134", "1:34" → minutes. */
export function parseDuration(text: string): number | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  const colon = t.match(/^(\d+):(\d{1,2})$/);
  if (colon) return Number(colon[1]) * 60 + Number(colon[2]);
  let total = 0;
  let matched = false;
  const hours = t.match(/(\d+(?:\.\d+)?)\s*h/);
  if (hours) { total += Number(hours[1]) * 60; matched = true; }
  const mins = t.match(/(\d+(?:\.\d+)?)\s*m/);
  if (mins) { total += Number(mins[1]); matched = true; }
  if (matched) return Math.round(total);
  const plain = Number(t);
  return Number.isFinite(plain) ? Math.round(plain) : null;
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const wrapped = (...args: A) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; fn(...args); }, ms);
  };
  wrapped.flush = (...args: A) => {
    if (timer) { clearTimeout(timer); timer = null; }
    fn(...args);
  };
  return wrapped;
}

/** Union two arrays of primitives, preserving first-seen order. Used all over the merge. */
export function unionBy<T>(a: T[], b: T[], keyOf: (x: T) => string): T[] {
  const out: T[] = [];
  const seen = new Set<string>();
  for (const item of [...a, ...b]) {
    const k = keyOf(item);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** Turn a hue into the CSS colour strings the design system expects. */
export function hueTint(hue: number, sat = 60, light = 55): string {
  return `${hue} ${sat}% ${light}%`;
}

export function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'field';
}
