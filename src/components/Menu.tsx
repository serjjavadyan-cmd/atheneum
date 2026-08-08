import { useEffect, useRef, useState } from 'react';
import { IconCheck, IconChevronDown } from './Icons';

export interface MenuItem {
  key: string;
  label: string;
  checked?: boolean;
  danger?: boolean;
  onSelect: () => void;
}

interface Props {
  label: React.ReactNode;
  items: MenuItem[];
  align?: 'left' | 'right';
  /** Rendered above the items, e.g. a direction toggle. */
  header?: React.ReactNode;
  buttonClass?: string;
  title?: string;
}

export function Menu({ label, items, align = 'left', header, buttonClass = 'btn', title }: Props) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  return (
    <div ref={wrap} style={{ position: 'relative', flex: '0 0 auto' }}>
      <button
        className={buttonClass}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        title={title}
      >
        {label}
        {buttonClass !== 'btn-icon' && <IconChevronDown size={11} />}
      </button>

      {open && (
        <div className="dropdown" style={align === 'right' ? { right: 0, left: 'auto' } : undefined} role="menu">
          {header}
          {items.map((item) => (
            <button
              key={item.key}
              className={`dropdown-item${item.checked ? ' is-checked' : ''}${item.danger ? ' is-danger' : ''}`}
              role="menuitem"
              onClick={() => { item.onSelect(); setOpen(false); }}
            >
              <span className="dropdown-check">{item.checked ? <IconCheck size={12} /> : null}</span>
              <span className="grow" style={{ textAlign: 'left' }}>{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
