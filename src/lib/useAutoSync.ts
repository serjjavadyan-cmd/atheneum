import { useEffect, useRef } from 'react';
import { useStore } from '../store';
import { useUi } from '../ui';
import { platform } from '../platform';

/**
 * Sync shortly after launch, then on an interval.
 *
 * The opening run is delayed a few seconds so a cloud client that is still pulling files down
 * gets a moment to finish — syncing against a half-downloaded folder is harmless (the merge
 * only adds) but pointlessly noisy.
 */
export function useAutoSync() {
  const enabled = useStore((s) => s.db.settings.syncEnabled);
  const intervalMin = useStore((s) => s.db.settings.syncIntervalMin);
  const loaded = useStore((s) => s.loaded);
  const toast = useUi((s) => s.toast);
  const running = useRef(false);

  useEffect(() => {
    if (!loaded || !enabled || platform.kind !== 'electron') return;

    const sync = async (announce: boolean) => {
      if (running.current) return;
      running.current = true;
      try {
        const { db } = useStore.getState();
        const result = await platform.syncNow(db);
        // Take the merged database wholesale — the main process has already written it.
        useStore.getState().replaceDb(result.db);

        const added = (result as { added?: { entries: number; diary: number } }).added;
        if (announce && added && (added.entries > 0 || added.diary > 0)) {
          const bits = [
            added.entries && `${added.entries} ${added.entries === 1 ? 'entry' : 'entries'}`,
            added.diary && `${added.diary} diary ${added.diary === 1 ? 'day' : 'days'}`,
          ].filter(Boolean);
          toast(`Synced — ${bits.join(' and ')} from your other computer.`, 'success');
        }
      } catch {
        // A background sync failing is not worth interrupting her for; Settings shows why.
      } finally {
        running.current = false;
      }
    };

    const first = setTimeout(() => void sync(true), 4000);
    const timer = setInterval(() => void sync(true), Math.max(1, intervalMin) * 60_000);

    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [loaded, enabled, intervalMin, toast]);
}
