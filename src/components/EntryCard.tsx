import type { Category, Entry } from '../types';
import { valueToText } from '../lib/query';
import { CoverImage, Rating, StatusPill, coverOf, tintOf } from './primitives';
import { IconHeart } from './Icons';

/**
 * Cards are intentionally plain DOM.
 *
 * An earlier version gave the artwork a `layoutId` matching the detail page's cover so one
 * would physically expand into the other. It was dropped for a plainer entrance on the detail
 * side: the shared handoff depends on framer measuring both boxes across an unmount, and when
 * it does go wrong the failure mode is a cover permanently stuck at the card's scale — a
 * visibly broken page. The detail cover springs in on its own instead, which reads much the
 * same in motion with no cross-component coordination to get wedged.
 */

interface Props {
  entry: Entry;
  category: Category | null;
  onOpen: () => void;
  wideArt?: boolean;
}

export function EntryCard({ entry, category, onOpen, wideArt = false }: Props) {
  const cover = coverOf(entry);
  const tint = tintOf(entry, category);

  // The first one or two fields marked "show on card" become the subtitle.
  const subtitle = (category?.fields ?? [])
    .filter((f) => f.showOnCard && !f.hidden)
    .map((f) => valueToText(entry.values[f.key], f))
    .filter(Boolean)
    .slice(0, 2)
    .join(' · ');

  return (
    <button
      className={`card${wideArt ? ' is-wide-art' : ''}`}
      style={{ ['--tint' as string]: tint }}
      onClick={onOpen}
      aria-label={entry.title}
    >
      <div className="card-art">
        {cover ? (
          <CoverImage image={cover} alt="" />
        ) : (
          <div className="card-placeholder"><span>{entry.title}</span></div>
        )}

        {entry.favorite && (
          <span className="card-fav" aria-label="Favourite"><IconHeart size={11} /></span>
        )}

        {category && (
          <div className="card-status">
            <StatusPill status={entry.status} labels={category.statusLabels} />
          </div>
        )}
      </div>

      <div className="card-body">
        <div className="card-title">{entry.title}</div>
        {subtitle && <div className="card-sub">{subtitle}</div>}
        {entry.rating > 0 && (
          <div className="card-meta"><Rating value={entry.rating} /></div>
        )}
      </div>
    </button>
  );
}

/** The compact row used by the list layout. */
export function EntryRow({ entry, category, onOpen }: Props) {
  const cover = coverOf(entry);
  const tint = tintOf(entry, category);
  const shown = (category?.fields ?? []).filter((f) => f.showOnCard && !f.hidden);

  return (
    <button
      className="list-row"
      style={{ ['--tint' as string]: tint }}
      onClick={onOpen}
      aria-label={entry.title}
    >
      <span className="list-thumb">
        {cover ? <CoverImage image={cover} alt="" /> : null}
      </span>
      <span className="list-title">{entry.title}</span>
      <span className="list-cell">{valueToText(entry.values[shown[0]?.key], shown[0])}</span>
      <span className="list-cell">{valueToText(entry.values[shown[1]?.key], shown[1])}</span>
      <span>{entry.rating > 0 ? <Rating value={entry.rating} /> : null}</span>
      <span className="list-cell">{category?.statusLabels[entry.status] ?? ''}</span>
    </button>
  );
}
