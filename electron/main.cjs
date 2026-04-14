const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const Database = require('better-sqlite3');
const fs = require('fs');

let mainWindow;
let db;

function initDb() {
  const userDataPath = app.getPath('userData');
  const dbPath = path.join(userDataPath, 'vibemind.db');
  
  db = new Database(dbPath);
  
  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS folders (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      parentId TEXT,
      is_dirty INTEGER DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    
    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT,
      folderId TEXT,
      isPinned INTEGER DEFAULT 0,
      is_dirty INTEGER DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(folderId) REFERENCES folders(id)
    );
    
    CREATE TABLE IF NOT EXISTS sync_config (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: "VibeMind Desktop",
    autoHideMenuBar: true
  });

  // In development, load from vite server
  // In production, load from dist/index-desktop.html
  const isDev = process.env.NODE_ENV === 'development';
  if (isDev) {
    mainWindow.loadURL('http://localhost:3000/index-desktop.html');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index-desktop.html'));
  }
}

app.whenReady().then(() => {
  initDb();
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

// IPC Handlers for Database
ipcMain.handle('db-get-notes', async () => {
  return db.prepare('SELECT * FROM notes').all();
});

ipcMain.handle('db-get-folders', async () => {
  return db.prepare('SELECT * FROM folders').all();
});

ipcMain.handle('db-save-note', async (event, note) => {
  const isDirty = note.is_dirty !== undefined ? note.is_dirty : 1;
  const updatedAt = note.updated_at || new Date().toISOString();
  
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO notes (id, title, content, folderId, isPinned, is_dirty, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(note.id, note.title, note.content, note.folderId, note.isPinned ? 1 : 0, isDirty, updatedAt);
  return { success: true };
});

ipcMain.handle('db-delete-note', async (event, id) => {
  db.prepare('DELETE FROM notes WHERE id = ?').run(id);
  return { success: true };
});

ipcMain.handle('db-save-folder', async (event, folder) => {
  const isDirty = folder.is_dirty !== undefined ? folder.is_dirty : 1;
  const updatedAt = folder.updated_at || new Date().toISOString();

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO folders (id, name, parentId, is_dirty, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  stmt.run(folder.id, folder.name, folder.parentId, isDirty, updatedAt);
  return { success: true };
});

ipcMain.handle('db-delete-folder', async (event, id) => {
  db.prepare('DELETE FROM folders WHERE id = ?').run(id);
  return { success: true };
});

ipcMain.handle('db-search-notes', async (event, query) => {
  const stmt = db.prepare('SELECT * FROM notes WHERE title LIKE ? OR content LIKE ? LIMIT 20');
  return stmt.all(`%${query}%`, `%${query}%`);
});

ipcMain.handle('get-sync-config', async () => {
  const rows = db.prepare('SELECT * FROM sync_config').all();
  const config = {};
  rows.forEach(row => {
    config[row.key] = row.value;
  });
  return config;
});

ipcMain.handle('save-sync-config', async (event, config) => {
  const stmt = db.prepare('INSERT OR REPLACE INTO sync_config (key, value) VALUES (?, ?)');
  for (const [key, value] of Object.entries(config)) {
    stmt.run(key, value);
  }
  return { success: true };
});

ipcMain.handle('quit-app', () => {
  app.quit();
});
