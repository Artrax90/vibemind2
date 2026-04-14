export interface ElectronAPI {
  getNotes: () => Promise<any[]>;
  getFolders: () => Promise<any[]>;
  saveNote: (note: any) => Promise<{ success: boolean }>;
  deleteNote: (id: string) => Promise<{ success: boolean }>;
  saveFolder: (folder: any) => Promise<{ success: boolean }>;
  deleteFolder: (id: string) => Promise<{ success: boolean }>;
  searchNotes: (query: string) => Promise<any[]>;
  getSyncConfig: () => Promise<Record<string, string>>;
  saveSyncConfig: (config: Record<string, string>) => Promise<{ success: boolean }>;
  isElectron: boolean;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
