import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { useUi } from '../ui';
import { platform } from '../platform';
import type { SyncStatus } from '../platform';
import { Switch } from './primitives';
import { IconSync } from './Icons';

export function SettingsView() {
  const db = useStore((s) => s.db);
  const updateSettings = useStore((s) => s.updateSettings);
  const updateCategory = useStore((s) => s.updateCategory);
  const replaceDb = useStore((s) => s.replaceDb);
  const toast = useUi((s) => s.toast);

  const [dataDir, setDataDir] = useState('…');
  const [sync, setSync] = useState<SyncStatus | null>(null);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    void platform.dataDir().then(setDataDir);
    void platform.syncStatus(db.settings.syncDir).then(setSync);
  }, [db.settings.syncDir]);

  const runSync = async () => {
    setSyncing(true);
    try {
      const result = await platform.syncNow(db);
      replaceDb(result.db);
      setSync(result.status);
      toast('Synced — merged, nothing removed.', 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Sync failed.', 'error');
    } finally {
      setSyncing(false);
    }
  };

  const counts = {
    entries: db.entries.filter((e) => !e.archived).length,
    archived: db.entries.filter((e) => e.archived).length,
    diary: db.diary.filter((d) => !d.archived).length,
    images: new Set(db.entries.flatMap((e) => e.images.map((i) => i.hash))).size,
  };

  return (
    <>
      <div className="topbar">
        <div className="topbar-title"><span>Settings</span></div>
      </div>

      <div className="content">
        <div className="content-pad" style={{ maxWidth: 620 }}>
          <Section title="Sync">
            {platform.kind === 'browser' ? (
              <p className="field-hint">
                Sync runs in the desktop app. You're currently looking at the development preview
                in a browser tab.
              </p>
            ) : (
              <>
                <Switch
                  checked={db.settings.syncEnabled}
                  onChange={(v) => updateSettings({ syncEnabled: v })}
                  label="Keep this computer in step with my other one"
                />
                <div className="field-row">
                  <span className="field-label">Sync folder</span>
                  <div className="row" style={{ gap: 8 }}>
                    <input
                      className="input"
                      value={db.settings.syncDir}
                      placeholder={sync?.detected ? `Auto-detected: ${sync.detected}` : 'No cloud folder found yet'}
                      onChange={(e) => updateSettings({ syncDir: e.target.value })}
                    />
                    <button
                      className="btn"
                      onClick={async () => {
                        const dir = await platform.chooseFolder();
                        if (dir) updateSettings({ syncDir: dir });
                      }}
                    >
                      Choose…
                    </button>
                  </div>
                  <span className="field-hint">
                    Leave empty to use whichever of Google Drive, Dropbox, OneDrive or iCloud is
                    running. Both computers must point at the same synced folder.
                  </span>
                </div>

                <div className="row" style={{ gap: 10 }}>
                  <button className="btn" onClick={runSync} disabled={syncing}>
                    <IconSync size={13} /> {syncing ? 'Merging…' : 'Sync now'}
                  </button>
                  {sync?.lastSync && <span className="field-hint">Last synced {new Date(sync.lastSync).toLocaleString()}</span>}
                </div>
                {sync?.lastError && <p className="field-hint" style={{ color: '#ff9b8f' }}>{sync.lastError}</p>}
              </>
            )}
            <p className="field-hint">
              A sync only ever adds. Edits made on either machine are kept, lists are combined
              rather than replaced, and nothing is removed from the other computer.
            </p>
          </Section>

          {db.categories.some((c) => c.hidden) && (
            <Section title="Hidden categories">
              <p className="field-hint">
                Hidden from the sidebar, but their entries are still here and still sync.
              </p>
              <div className="chips">
                {db.categories.filter((c) => c.hidden).map((c) => (
                  <button
                    key={c.id}
                    className="chip"
                    onClick={() => {
                      updateCategory(c.id, { hidden: false });
                      toast(`${c.pluralName} is back.`, 'success');
                    }}
                  >
                    <span>{c.glyph}</span> {c.pluralName}
                    <span className="muted">
                      {db.entries.filter((e) => e.categoryId === c.id && !e.archived).length}
                    </span>
                  </button>
                ))}
              </div>
            </Section>
          )}

          <Section title="Who">
            <p className="field-hint">
              The three choices on every entry, for marking who read, watched or played it.
              Renaming them here is safe — entries store which of the three, never the name.
            </p>
            <div className="row" style={{ gap: 10 }}>
              {(['both', 'a', 'b'] as const).map((key) => (
                <div className="field-row grow" key={key}>
                  <label className="field-label" htmlFor={`who-${key}`}>
                    {key === 'both' ? 'Together' : key === 'a' ? 'First person' : 'Second person'}
                  </label>
                  <input
                    id={`who-${key}`}
                    className="input"
                    value={db.settings.whoLabels[key]}
                    onChange={(e) =>
                      updateSettings({
                        whoLabels: { ...db.settings.whoLabels, [key]: e.target.value },
                      })
                    }
                  />
                </div>
              ))}
            </div>
          </Section>

          <Section title="Appearance">
            <Switch
              checked={db.settings.reduceMotion}
              onChange={(v) => updateSettings({ reduceMotion: v })}
              label="Reduce motion"
            />
          </Section>

          <Section title="Looking things up">
            <Switch
              checked={db.settings.onlineLookup}
              onChange={(v) => updateSettings({ onlineLookup: v })}
              label="Show the Fill details and Find cover buttons on entries"
            />
            <p className="field-hint">
              Nothing is ever fetched on its own — you press a button, pick from what comes back,
              and see exactly which empty fields would be filled before anything is written.
              Fields you've already filled are never touched.
            </p>

            <p className="field-hint">
              Books, manga, anime and board games work with no setup at all, through Open Library,
              Google Books, MyAnimeList and BoardGameGeek. The keys below are free, take about two
              minutes each and need no card — without them, films, TV and games come back thin.
            </p>

            <KeyField
              label="TMDB — film and TV posters"
              hint="themoviedb.org → Settings → API. Goodreads and IMDb have no free API; this is what everyone uses instead, and it also supplies the IMDb link."
              value={db.settings.tmdbKey}
              onChange={(v) => updateSettings({ tmdbKey: v })}
            />
            <KeyField
              label="OMDb — IMDb ratings"
              hint="omdbapi.com → free key. Adds the IMDb score to films and shows."
              value={db.settings.omdbKey}
              onChange={(v) => updateSettings({ omdbKey: v })}
            />
            <div className="row" style={{ gap: 10 }}>
              <KeyField
                label="IGDB client ID"
                hint="dev.twitch.tv → register an application"
                value={db.settings.igdbClientId}
                onChange={(v) => updateSettings({ igdbClientId: v })}
              />
              <KeyField
                label="IGDB client secret"
                hint="From the same Twitch application"
                value={db.settings.igdbClientSecret}
                onChange={(v) => updateSettings({ igdbClientSecret: v })}
              />
            </div>
          </Section>

          <Section title="This library">
            <dl className="stat-list">
              <Stat label="Entries" value={counts.entries} />
              <Stat label="Archived" value={counts.archived} />
              <Stat label="Diary days" value={counts.diary} />
              <Stat label="Images" value={counts.images} />
            </dl>
            <div className="field-row">
              <span className="field-label">Stored at</span>
              <code className="path selectable">{dataDir}</code>
            </div>
            <div className="field-row">
              <span className="field-label">This device</span>
              <span className="field-hint">{db.deviceName} · {db.deviceId}</span>
            </div>
          </Section>
        </div>
      </div>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="settings-section">
      <h2 className="settings-title">{title}</h2>
      <div className="settings-body">{children}</div>
    </section>
  );
}

/** An API key. Masked once set, so a shared screen doesn't leak it. */
function KeyField({
  label, hint, value, onChange,
}: { label: string; hint: string; value: string; onChange: (v: string) => void }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="field-row grow">
      <span className="field-label">{label}</span>
      <div className="row" style={{ gap: 8 }}>
        <input
          className="input"
          type={shown || !value ? 'text' : 'password'}
          value={value}
          placeholder="not set"
          spellCheck={false}
          onChange={(e) => onChange(e.target.value.trim())}
        />
        {value && (
          <button className="btn btn-sm" onClick={() => setShown((s) => !s)}>
            {shown ? 'Hide' : 'Show'}
          </button>
        )}
      </div>
      <span className="field-hint">{hint}</span>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="stat">
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}
