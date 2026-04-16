import { Capacitor } from '@capacitor/core';
import { CapacitorSQLite, SQLiteConnection, SQLiteDBConnection } from '@capacitor-community/sqlite';

const isElectron = !!(window as any).electronAPI;
const isNative = Capacitor.isNativePlatform();

let sqlite: SQLiteConnection;
let db: SQLiteDBConnection;

export const initDB = async () => {
  if (isElectron) return; // Electron handles its own DB in main process
  
  if (isNative) {
    sqlite = new SQLiteConnection(CapacitorSQLite);
    try {
      const ret = await sqlite.checkConnectionsConsistency();
      const isConn = (await sqlite.isConnection("vibemind", false)).result;
      
      if (ret.result && isConn) {
        db = await sqlite.retrieveConnection("vibemind", false);
      } else {
        db = await sqlite.createConnection("vibemind", false, "no-encryption", 1, false);
      }
      
      await db.open();
      
      const query = `
        CREATE TABLE IF NOT EXISTS folders (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          parentId TEXT,
          permission TEXT,
          isShared INTEGER DEFAULT 0,
          isSharedByMe INTEGER DEFAULT 0,
          ownerUsername TEXT,
          is_dirty INTEGER DEFAULT 0,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        
        CREATE TABLE IF NOT EXISTS notes (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          content TEXT,
          folderId TEXT,
          isPinned INTEGER DEFAULT 0,
          permission TEXT,
          isShared INTEGER DEFAULT 0,
          isSharedByMe INTEGER DEFAULT 0,
          ownerUsername TEXT,
          is_dirty INTEGER DEFAULT 0,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(folderId) REFERENCES folders(id)
        );
        
        CREATE TABLE IF NOT EXISTS sync_config (
          key TEXT PRIMARY KEY,
          value TEXT
        );
      `;
      await db.execute(query);
    } catch (err) {
      console.error("SQLite init error", err);
    }
  } else {
    // Web fallback (IndexedDB or localStorage)
    // For now, we can use localStorage for basic web testing if needed,
    // but the app is primarily Electron/Android.
  }
};

export const dbApi = {
  async getSyncConfig() {
    if (isElectron) return (window as any).electronAPI.getSyncConfig();
    if (isNative && db) {
      const res = await db.query('SELECT * FROM sync_config');
      const config: any = {};
      res.values?.forEach(row => { config[row.key] = row.value; });
      return config;
    }
    return JSON.parse(localStorage.getItem('sync_config') || '{}');
  },

  async saveSyncConfig(config: any) {
    if (isElectron) return (window as any).electronAPI.saveSyncConfig(config);
    if (isNative && db) {
      for (const [key, value] of Object.entries(config)) {
        await db.run('INSERT OR REPLACE INTO sync_config (key, value) VALUES (?, ?)', [key, String(value)]);
      }
      return;
    }
    localStorage.setItem('sync_config', JSON.stringify(config));
  },

  async getNotes() {
    if (isElectron) return (window as any).electronAPI.getNotes();
    if (isNative && db) {
      const res = await db.query('SELECT * FROM notes');
      return res.values || [];
    }
    return JSON.parse(localStorage.getItem('notes') || '[]');
  },

  async saveNote(note: any) {
    if (isElectron) return (window as any).electronAPI.saveNote(note);
    if (isNative && db) {
      const isDirty = note.is_dirty !== undefined ? note.is_dirty : 1;
      const updatedAt = note.updated_at || new Date().toISOString();
      await db.run(
        'INSERT OR REPLACE INTO notes (id, title, content, folderId, isPinned, permission, isShared, isSharedByMe, ownerUsername, is_dirty, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [note.id, note.title, note.content, note.folderId, note.isPinned ? 1 : 0, note.permission, note.isShared ? 1 : 0, note.isSharedByMe ? 1 : 0, note.ownerUsername, isDirty, updatedAt]
      );
      return;
    }
    const notes = await this.getNotes();
    const idx = notes.findIndex((n: any) => n.id === note.id);
    if (idx >= 0) notes[idx] = note;
    else notes.push(note);
    localStorage.setItem('notes', JSON.stringify(notes));
  },

  async deleteNote(id: string) {
    if (isElectron) return (window as any).electronAPI.deleteNote(id);
    if (isNative && db) {
      await db.run('DELETE FROM notes WHERE id = ?', [id]);
      return;
    }
    const notes = await this.getNotes();
    localStorage.setItem('notes', JSON.stringify(notes.filter((n: any) => n.id !== id)));
  },

  async getFolders() {
    if (isElectron) return (window as any).electronAPI.getFolders();
    if (isNative && db) {
      const res = await db.query('SELECT * FROM folders');
      return res.values || [];
    }
    return JSON.parse(localStorage.getItem('folders') || '[]');
  },

  async saveFolder(folder: any) {
    if (isElectron) return (window as any).electronAPI.saveFolder(folder);
    if (isNative && db) {
      const isDirty = folder.is_dirty !== undefined ? folder.is_dirty : 1;
      const updatedAt = folder.updated_at || new Date().toISOString();
      await db.run(
        'INSERT OR REPLACE INTO folders (id, name, parentId, permission, isShared, isSharedByMe, ownerUsername, is_dirty, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [folder.id, folder.name, folder.parentId, folder.permission, folder.isShared ? 1 : 0, folder.isSharedByMe ? 1 : 0, folder.ownerUsername, isDirty, updatedAt]
      );
      return;
    }
    const folders = await this.getFolders();
    const idx = folders.findIndex((f: any) => f.id === folder.id);
    if (idx >= 0) folders[idx] = folder;
    else folders.push(folder);
    localStorage.setItem('folders', JSON.stringify(folders));
  },

  async deleteFolder(id: string) {
    if (isElectron) return (window as any).electronAPI.deleteFolder(id);
    if (isNative && db) {
      await db.run('DELETE FROM folders WHERE id = ?', [id]);
      return;
    }
    const folders = await this.getFolders();
    localStorage.setItem('folders', JSON.stringify(folders.filter((f: any) => f.id !== id)));
  },

  async clearData() {
    if (isElectron) return (window as any).electronAPI.clearData();
    if (isNative && db) {
      await db.run('DELETE FROM notes');
      await db.run('DELETE FROM folders');
      await db.run('DELETE FROM sync_config');
      return;
    }
    localStorage.clear();
  },
  
  quitApp() {
    if (isElectron) return (window as any).electronAPI.quitApp();
    if (isNative) {
      import('@capacitor/app').then(({ App }) => App.exitApp());
    }
  }
};
