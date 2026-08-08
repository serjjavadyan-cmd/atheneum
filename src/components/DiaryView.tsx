import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import { useUi } from '../ui';
import { MOODS } from '../defaults';
import type { DiaryDay } from '../types';
import { isoDate, parseIsoDate } from '../lib/util';
import { coverOf } from './primitives';
import { CoverImage } from './primitives';
import { IconChevronDown, IconChevronLeft, IconLink, IconPlus, IconX } from './Icons';

/**
 * The diary is a calendar on the left and a single day's writing on the right.
 *
 * Days are not unique by date: a merge can bring back a day written on the other machine
 * for a date you also wrote on here, and both are kept. When that happens the day shows
 * every version rather than picking one.
 */

export function DiaryView() {
  const db = useStore((s) => s.db);
  const createDiaryDay = useStore((s) => s.createDiaryDay);
  const [selected, setSelected] = useState(() => isoDate());
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });

  const days = useMemo(() => db.diary.filter((d) => !d.archived), [db.diary]);

  const byDate = useMemo(() => {
    const map = new Map<string, DiaryDay[]>();
    for (const d of days) {
      const list = map.get(d.date);
      if (list) list.push(d);
      else map.set(d.date, [d]);
    }
    return map;
  }, [days]);

  const selectedDays = byDate.get(selected) ?? [];

  const written = days.length;
  const streak = useMemo(() => computeStreak(new Set(days.map((d) => d.date))), [days]);

  return (
    <>
      <div className="topbar" style={{ ['--tint' as string]: '42 55% 60%' }}>
        <div className="topbar-title">
          <span>Diary</span>
          <span className="count">
            {written} {written === 1 ? 'day' : 'days'}
            {streak > 1 && ` · ${streak}-day streak`}
          </span>
        </div>
        <div className="grow" />
        <button className="btn" onClick={() => { setSelected(isoDate()); setMonth({ year: new Date().getFullYear(), month: new Date().getMonth() }); }}>
          Today
        </button>
      </div>

      <div className="content">
        <div className="diary">
          <aside className="diary-cal">
            <Calendar
              year={month.year}
              month={month.month}
              selected={selected}
              written={byDate}
              onSelect={setSelected}
              onMonthChange={setMonth}
            />

            <div className="diary-recent">
              <div className="eyebrow" style={{ marginBottom: 10 }}>Recent</div>
              {days.length === 0 && <div className="field-hint">Nothing written yet.</div>}
              {[...days]
                .sort((a, b) => b.date.localeCompare(a.date))
                .slice(0, 12)
                .map((d) => (
                  <button
                    key={d.id}
                    className={`diary-recent-item${d.date === selected ? ' is-active' : ''}`}
                    onClick={() => {
                      setSelected(d.date);
                      const dt = parseIsoDate(d.date);
                      setMonth({ year: dt.getFullYear(), month: dt.getMonth() });
                    }}
                  >
                    <span className="diary-recent-date">{formatDayShort(d.date)}</span>
                    <span className="diary-recent-peek">
                      {d.body.trim().split('\n')[0] || <span className="muted">—</span>}
                    </span>
                  </button>
                ))}
            </div>
          </aside>

          <div className="diary-page">
            <header className="diary-page-head">
              <h1 className="diary-date display">{formatDayLong(selected)}</h1>
              {selected > isoDate() && <span className="chip">In the future</span>}
            </header>

            {selectedDays.length === 0 ? (
              <div className="diary-blank">
                <p className="empty-body" style={{ marginBottom: 16 }}>
                  Nothing written for this day yet.
                </p>
                <button className="btn btn-primary" onClick={() => createDiaryDay(selected)}>
                  <IconPlus size={13} /> Write
                </button>
              </div>
            ) : (
              selectedDays.map((day, i) => (
                <DayEditor
                  key={day.id}
                  day={day}
                  /* Only meaningful when a merge produced two versions of the same date. */
                  duplicateIndex={selectedDays.length > 1 ? i + 1 : null}
                  duplicateTotal={selectedDays.length}
                />
              ))
            )}
          </div>
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * A single day
 * ------------------------------------------------------------------ */

function DayEditor({
  day, duplicateIndex, duplicateTotal,
}: { day: DiaryDay; duplicateIndex: number | null; duplicateTotal: number }) {
  const db = useStore((s) => s.db);
  const update = useStore((s) => s.updateDiaryDay);
  const go = useUi((s) => s.go);
  const [linking, setLinking] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(220, el.scrollHeight)}px`;
  }, [day.body, day.id]);

  const linked = day.linkedEntryIds
    .map((id) => db.entries.find((e) => e.id === id))
    .filter(Boolean) as NonNullable<ReturnType<typeof db.entries.find>>[];

  return (
    <article className="diary-day">
      {duplicateIndex && (
        <div className="diary-dupe">
          Version {duplicateIndex} of {duplicateTotal} — written on{' '}
          {day.origin === db.deviceId ? 'this computer' : 'your other computer'}. Both are kept.
        </div>
      )}

      <div className="diary-moods">
        {MOODS.map((m) => (
          <button
            key={m}
            className={`chip${day.mood === m ? ' is-on' : ''}`}
            onClick={() => update(day.id, { mood: day.mood === m ? null : m })}
          >
            {m}
          </button>
        ))}
      </div>

      <textarea
        ref={textRef}
        className="diary-text"
        value={day.body}
        placeholder="Today…"
        onChange={(e) => update(day.id, { body: e.target.value })}
      />

      <div className="diary-links">
        {linked.map((e) => {
          const cat = db.categories.find((c) => c.id === e.categoryId) ?? null;
          return (
            <span key={e.id} className="diary-link">
              <button className="diary-link-open" onClick={() => go({ name: 'entry', entryId: e.id })}>
                <span className="diary-link-thumb">
                  {coverOf(e) ? <CoverImage image={coverOf(e)} alt="" /> : <span>{cat?.glyph}</span>}
                </span>
                {e.title}
              </button>
              <button
                className="chip-x"
                onClick={() => update(day.id, { linkedEntryIds: day.linkedEntryIds.filter((x) => x !== e.id) })}
                aria-label={`Unlink ${e.title}`}
              >
                <IconX size={11} />
              </button>
            </span>
          );
        })}

        <div style={{ position: 'relative' }}>
          <button className="chip" onClick={() => setLinking((v) => !v)}>
            <IconLink size={12} /> Link something
          </button>
          {linking && (
            <EntryPicker
              exclude={day.linkedEntryIds}
              onPick={(id) => {
                update(day.id, { linkedEntryIds: [...day.linkedEntryIds, id] });
                setLinking(false);
              }}
              onClose={() => setLinking(false)}
            />
          )}
        </div>
      </div>
    </article>
  );
}

function EntryPicker({
  exclude, onPick, onClose,
}: { exclude: string[]; onPick: (id: string) => void; onClose: () => void }) {
  const db = useStore((s) => s.db);
  const [q, setQ] = useState('');
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [onClose]);

  const matches = db.entries
    .filter((e) => !e.archived && !exclude.includes(e.id))
    .filter((e) => e.title.toLowerCase().includes(q.trim().toLowerCase()))
    .slice(0, 40);

  return (
    <div ref={wrap} className="dropdown" style={{ minWidth: 280 }}>
      <div className="dropdown-head">
        <input
          className="input-bare"
          autoFocus
          value={q}
          placeholder="Find an entry…"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
        />
      </div>
      {matches.length === 0 && <div className="dropdown-item muted">Nothing found</div>}
      {matches.map((e) => {
        const cat = db.categories.find((c) => c.id === e.categoryId);
        return (
          <button key={e.id} className="dropdown-item" onClick={() => onPick(e.id)}>
            <span style={{ width: 14, color: 'var(--ink-faint)' }}>{cat?.glyph}</span>
            <span className="grow" style={{ textAlign: 'left' }}>{e.title}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Calendar
 * ------------------------------------------------------------------ */

function Calendar({
  year, month, selected, written, onSelect, onMonthChange,
}: {
  year: number;
  month: number;
  selected: string;
  written: Map<string, DiaryDay[]>;
  onSelect: (date: string) => void;
  onMonthChange: (m: { year: number; month: number }) => void;
}) {
  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  // Monday-first grid.
  const lead = (first.getDay() + 6) % 7;
  const today = isoDate();

  const cells: (string | null)[] = [
    ...Array<null>(lead).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => isoDate(new Date(year, month, i + 1))),
  ];

  const shift = (delta: number) => {
    const d = new Date(year, month + delta, 1);
    onMonthChange({ year: d.getFullYear(), month: d.getMonth() });
  };

  return (
    <div className="cal">
      <div className="cal-head">
        <button className="btn-icon" onClick={() => shift(-1)} aria-label="Previous month">
          <IconChevronLeft size={13} />
        </button>
        <span className="cal-title">
          {first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
        </span>
        <button className="btn-icon" onClick={() => shift(1)} aria-label="Next month" style={{ transform: 'rotate(-90deg)' }}>
          <IconChevronDown size={13} />
        </button>
      </div>

      <div className="cal-grid">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
          <span key={i} className="cal-dow">{d}</span>
        ))}
        {cells.map((date, i) => {
          if (!date) return <span key={`pad-${i}`} />;
          const has = written.has(date);
          const isToday = date === today;
          return (
            <button
              key={date}
              className={`cal-day${date === selected ? ' is-selected' : ''}${isToday ? ' is-today' : ''}${has ? ' has-entry' : ''}`}
              onClick={() => onSelect(date)}
            >
              {Number(date.slice(8))}
              {has && <span className="cal-dot" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * helpers
 * ------------------------------------------------------------------ */

function formatDayLong(date: string): string {
  return parseIsoDate(date).toLocaleDateString(undefined, {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

function formatDayShort(date: string): string {
  return parseIsoDate(date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** Consecutive days written, counting back from today (or yesterday, if today is blank). */
function computeStreak(dates: Set<string>): number {
  const cursor = new Date();
  if (!dates.has(isoDate(cursor))) cursor.setDate(cursor.getDate() - 1);
  let n = 0;
  while (dates.has(isoDate(cursor))) {
    n++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return n;
}
