import { useEffect, useState } from 'react';
import { platform } from '../platform';
import type { Category, Entry, ImageRef } from '../types';
import { IconStar } from './Icons';

/* ------------------------------------------------------------------ *
 * Images
 * ------------------------------------------------------------------ */

/**
 * Resolve a stored image to a displayable URL.
 *
 * In Electron this is instant (a custom protocol URL). In the browser fallback the bytes come
 * out of IndexedDB asynchronously, so the platform hands back a transparent placeholder first
 * and fires `atheneum:image-ready` once the real object URL exists.
 */
export function useImageUrl(file: string | null | undefined): string | null {
  const [url, setUrl] = useState(() => (file ? platform.imageUrl(file) : null));

  useEffect(() => {
    if (!file) {
      setUrl(null);
      return;
    }
    setUrl(platform.imageUrl(file));
    if (platform.kind === 'electron') return;

    const onReady = (e: Event) => {
      if ((e as CustomEvent<string>).detail === file) setUrl(platform.imageUrl(file));
    };
    window.addEventListener('atheneum:image-ready', onReady);
    return () => window.removeEventListener('atheneum:image-ready', onReady);
  }, [file]);

  return url;
}

export function coverOf(entry: Entry): ImageRef | null {
  if (!entry.images.length) return null;
  return entry.images[Math.min(entry.coverIndex, entry.images.length - 1)] ?? null;
}

/** The tint an entry lights its surroundings with: its cover's colour, or its category's hue. */
export function tintOf(entry: Entry, category: Category | null): string {
  const cover = coverOf(entry);
  if (cover?.tint) return cover.tint;
  return `${category?.hue ?? 42} 42% 58%`;
}

export function CoverImage({ image, alt }: { image: ImageRef | null; alt: string }) {
  const url = useImageUrl(image?.file);
  if (!image || !url) return null;
  return <img src={url} alt={alt} loading="lazy" draggable={false} />;
}

/* ------------------------------------------------------------------ *
 * Rating — 0–10 internally, 0–5 stars in half steps on screen
 * ------------------------------------------------------------------ */

interface RatingProps {
  value: number;
  onChange?: (value: number) => void;
  size?: 'sm' | 'lg';
}

export function Rating({ value, onChange, size = 'sm' }: RatingProps) {
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover ?? value;
  const interactive = Boolean(onChange);

  return (
    <div
      className={`rating${interactive ? ' is-interactive' : ''}${size === 'lg' ? ' is-lg' : ''}`}
      onMouseLeave={() => setHover(null)}
      role={interactive ? 'slider' : 'img'}
      aria-label={`${value / 2} out of 5 stars`}
      aria-valuenow={interactive ? value / 2 : undefined}
      aria-valuemin={interactive ? 0 : undefined}
      aria-valuemax={interactive ? 5 : undefined}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={(e) => {
        if (!onChange) return;
        if (e.key === 'ArrowRight') { e.preventDefault(); onChange(Math.min(10, value + 1)); }
        if (e.key === 'ArrowLeft') { e.preventDefault(); onChange(Math.max(0, value - 1)); }
      }}
    >
      {[0, 1, 2, 3, 4].map((i) => {
        const full = shown >= (i + 1) * 2;
        const half = !full && shown >= i * 2 + 1;
        return (
          <span
            key={i}
            className={`rating-star${full ? ' is-full' : ''}${half ? ' is-half' : ''}`}
            // Left half of the star sets a half rating, right half sets a full one.
            onMouseMove={interactive ? (e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setHover(i * 2 + (e.clientX - r.left < r.width / 2 ? 1 : 2));
            } : undefined}
            onClick={interactive ? (e) => {
              const r = e.currentTarget.getBoundingClientRect();
              const next = i * 2 + (e.clientX - r.left < r.width / 2 ? 1 : 2);
              onChange!(next === value ? 0 : next); // clicking the current rating clears it
            } : undefined}
          >
            {full ? (
              <IconStar size={size === 'lg' ? 19 : 14} />
            ) : half ? (
              <>
                <span style={{ color: 'var(--ink-faint)' }}>
                  <IconStar size={size === 'lg' ? 19 : 14} />
                </span>
                <span className="half-clip">
                  <span><IconStar size={size === 'lg' ? 19 : 14} /></span>
                </span>
              </>
            ) : (
              <IconStar size={size === 'lg' ? 19 : 14} />
            )}
          </span>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Status
 * ------------------------------------------------------------------ */

/** Where in the progression a status sits, so the dot can reflect it. */
function stageOf(index: number, labels: string[]): 'start' | 'mid' | 'end' | 'off' {
  if (!labels.length) return 'start';
  // Trailing "Abandoned"/"Dropped"-style stages are dead ends, not completion.
  const label = (labels[index] ?? '').toLowerCase();
  if (/abandon|dropped|shelved|cancel|paused/.test(label)) return 'off';
  if (index === 0) return 'start';
  if (index >= labels.length - 1) return 'end';
  const isLastReal = index === labels.length - 2 &&
    /abandon|dropped|shelved|cancel|paused/.test((labels[labels.length - 1] ?? '').toLowerCase());
  return isLastReal ? 'end' : 'mid';
}

export function StatusPill({ status, labels }: { status: number; labels: string[] }) {
  const label = labels[status] ?? labels[0] ?? '—';
  return (
    <span className="status-pill" data-stage={stageOf(status, labels)}>
      <span className="status-dot" />
      {label}
    </span>
  );
}

export function StatusStepper({
  status, labels, onChange,
}: { status: number; labels: string[]; onChange: (n: number) => void }) {
  return (
    <div className="stepper" role="group" aria-label="Status">
      {labels.map((label, i) => (
        <button
          key={label + i}
          className={i === status ? 'is-on' : ''}
          onClick={() => onChange(i)}
          aria-pressed={i === status}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Small form controls
 * ------------------------------------------------------------------ */

export function Switch({
  checked, onChange, label,
}: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      className="row"
      style={{ gap: 10, width: '100%', textAlign: 'left' }}
      onClick={() => onChange(!checked)}
      role="switch"
      aria-checked={checked}
    >
      <span className={`switch${checked ? ' is-on' : ''}`} />
      <span style={{ fontSize: 13 }}>{label}</span>
    </button>
  );
}

export function Checkbox({
  checked, onChange, label,
}: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      className="row"
      style={{ gap: 9 }}
      onClick={() => onChange(!checked)}
      role="checkbox"
      aria-checked={checked}
    >
      <span className={`checkbox${checked ? ' is-on' : ''}`}>✓</span>
      {label && <span style={{ fontSize: 13 }}>{label}</span>}
    </button>
  );
}
