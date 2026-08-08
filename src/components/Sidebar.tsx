import { useStore } from '../store';
import { useUi } from '../ui';
import { IconArchive, IconCalendar, IconPlus, IconSettings, IconX } from './Icons';

export function Sidebar() {
  const db = useStore((s) => s.db);
  const createCategory = useStore((s) => s.createCategory);
  const deleteView = useStore((s) => s.deleteView);
  const route = useUi((s) => s.route);
  const go = useUi((s) => s.go);
  const setView = useUi((s) => s.setView);
  const editCategory = useUi((s) => s.editCategory);

  const visible = db.categories.filter((c) => !c.hidden);
  const archivedCount = db.entries.filter((e) => e.archived).length;

  const counts = new Map<string, number>();
  for (const e of db.entries) {
    if (e.archived) continue;
    counts.set(e.categoryId, (counts.get(e.categoryId) ?? 0) + 1);
  }

  return (
    <nav className="sidebar" aria-label="Sections">
      <div className="sidebar-head">
        <div className="wordmark">
          <span className="wordmark-mark">❖</span>
          <span className="wordmark-text">Atheneum</span>
        </div>
      </div>

      <div className="sidebar-scroll">
        <div className="nav-section">
          <div className="nav-section-title">
            <span>Library</span>
            <button
              onClick={() => {
                const id = createCategory();
                go({ name: 'category', categoryId: id });
                editCategory(id);
              }}
              title="New category"
              aria-label="New category"
            >
              <IconPlus size={13} />
            </button>
          </div>

          {visible.map((c) => {
            const active = route.name === 'category' && route.categoryId === c.id;
            return (
              <button
                key={c.id}
                className={`nav-item${active ? ' is-active' : ''}`}
                style={{ ['--tint' as string]: `${c.hue} 55% 62%` }}
                onClick={() => go({ name: 'category', categoryId: c.id })}
                aria-current={active ? 'page' : undefined}
              >
                <span className="nav-glyph">{c.glyph}</span>
                <span className="nav-label">{c.pluralName}</span>
                <span className="nav-count">{counts.get(c.id) ?? 0}</span>
              </button>
            );
          })}
        </div>

        {db.savedViews.length > 0 && (
          <div className="nav-section">
            <div className="nav-section-title"><span>Views</span></div>
            {db.savedViews.map((v) => {
              const cat = db.categories.find((c) => c.id === v.categoryId) ?? null;
              return (
                <button
                  key={v.id}
                  className="nav-item nav-item-view"
                  style={{ ['--tint' as string]: `${cat?.hue ?? 42} 55% 62%` }}
                  onClick={() => {
                    // Restore the whole view, then land on its category.
                    if (v.categoryId) {
                      setView(v.categoryId, {
                        filter: v.filter, sort: v.sort, layout: v.layout, groupBy: v.groupBy,
                      });
                      go({ name: 'category', categoryId: v.categoryId });
                    }
                  }}
                  title={cat ? `In ${cat.pluralName}` : undefined}
                >
                  <span className="nav-glyph">◆</span>
                  <span className="nav-label">{v.name}</span>
                  <span
                    className="nav-remove"
                    role="button"
                    tabIndex={0}
                    aria-label={`Remove view ${v.name}`}
                    onClick={(e) => { e.stopPropagation(); deleteView(v.id); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); deleteView(v.id); } }}
                  >
                    <IconX size={11} />
                  </span>
                </button>
              );
            })}
          </div>
        )}

        <div className="nav-section">
          <div className="nav-section-title"><span>Journal</span></div>
          <button
            className={`nav-item${route.name === 'diary' ? ' is-active' : ''}`}
            style={{ ['--tint' as string]: '42 55% 62%' }}
            onClick={() => go({ name: 'diary' })}
          >
            <span className="nav-glyph"><IconCalendar size={14} /></span>
            <span className="nav-label">Diary</span>
            <span className="nav-count">{db.diary.filter((d) => !d.archived).length}</span>
          </button>
        </div>
      </div>

      <div className="sidebar-foot">
        {archivedCount > 0 && (
          <button
            className={`nav-item${route.name === 'archive' ? ' is-active' : ''}`}
            style={{ ['--tint' as string]: '0 0% 55%' }}
            onClick={() => go({ name: 'archive' })}
          >
            <span className="nav-glyph"><IconArchive size={14} /></span>
            <span className="nav-label">Archive</span>
            <span className="nav-count">{archivedCount}</span>
          </button>
        )}
        <button
          className={`nav-item${route.name === 'settings' ? ' is-active' : ''}`}
          style={{ ['--tint' as string]: '42 55% 62%' }}
          onClick={() => go({ name: 'settings' })}
        >
          <span className="nav-glyph"><IconSettings size={14} /></span>
          <span className="nav-label">Settings</span>
        </button>
      </div>
    </nav>
  );
}
