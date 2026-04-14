const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getNotes: () => ipcRenderer.invoke('db-get-notes'),
  getFolders: () => ipcRenderer.invoke('db-get-folders'),
  saveNote: (note) => ipcRenderer.invoke('db-save-note', note),
  deleteNote: (id) => ipcRenderer.invoke('db-delete-note', id),
  saveFolder: (folder) => ipcRenderer.invoke('db-save-folder', folder),
  deleteFolder: (id) => ipcRenderer.invoke('db-delete-folder', id),
  searchNotes: (query) => ipcRenderer.invoke('db-search-notes', query),
  getSyncConfig: () => ipcRenderer.invoke('get-sync-config'),
  saveSyncConfig: (config) => ipcRenderer.invoke('save-sync-config', config),
  quitApp: () => ipcRenderer.invoke('quit-app'),
  isElectron: true
});
