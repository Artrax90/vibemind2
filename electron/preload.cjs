const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getNotes: () => ipcRenderer.invoke('db-get-notes'),
  getFolders: () => ipcRenderer.invoke('db-get-folders'),
  saveNote: (note) => ipcRenderer.invoke('db-save-note', note),
  deleteNote: (id) => ipcRenderer.invoke('db-delete-note', id),
  saveFolder: (folder) => ipcRenderer.invoke('db-save-folder', folder),
  deleteFolder: (id) => ipcRenderer.invoke('db-delete-folder', id),
  searchNotes: (query) => ipcRenderer.invoke('db-search-notes', query),
  getDeletedItems: () => ipcRenderer.invoke('db-get-deleted-items'),
  removeDeletedItem: (id) => ipcRenderer.invoke('db-remove-deleted-item', id),
  getSyncConfig: () => ipcRenderer.invoke('get-sync-config'),
  saveSyncConfig: (config) => ipcRenderer.invoke('save-sync-config', config),
  clearData: () => ipcRenderer.invoke('db-clear-data'),
  quitApp: () => ipcRenderer.invoke('quit-app'),
  isElectron: true
});
