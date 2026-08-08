'use strict';
/**
 * The only bridge between the renderer and the filesystem.
 *
 * Deliberately narrow: a fixed list of operations, no generic "run this in main" escape hatch.
 * `src/platform/index.ts` detects `window.atheneum` and uses it; when it's absent (a plain
 * browser tab during development) it falls back to localStorage and IndexedDB.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('atheneum', {
  loadDb: () => ipcRenderer.invoke('db:load'),
  saveDb: (db) => ipcRenderer.invoke('db:save', db),
  saveImage: (bytes, ext) => ipcRenderer.invoke('image:save', bytes, ext),
  chooseFolder: () => ipcRenderer.invoke('app:chooseFolder'),
  lookupSearch: (categoryId, query, hints, keys, force) =>
    ipcRenderer.invoke('lookup:search', categoryId, query, hints, keys, force),
  lookupCover: (url) => ipcRenderer.invoke('lookup:cover', url),
  syncStatus: (configured) => ipcRenderer.invoke('sync:status', configured),
  syncNow: (db) => ipcRenderer.invoke('sync:now', db),
  dataDir: () => ipcRenderer.invoke('app:dataDir'),
});
