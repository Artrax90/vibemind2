import { Capacitor } from '@capacitor/core';

const BASE_URL = ''; // Relative to current host
const isLocalApp = !!(window as any).electronAPI || Capacitor.isNativePlatform();

// Helper to get token
const getAuthHeaders = () => {
  const token = localStorage.getItem('access_token');
  return token ? { 'Authorization': `Bearer ${token}` } : {};
};

// Helper to handle responses and fallback to mock data if backend is not running
async function handleResponse(res: Response, mockData: any) {
  if (res.status === 401) {
    console.warn('Unauthorized, clearing token');
    localStorage.removeItem('access_token');
  }
  if (!res.ok) {
    console.warn(`API call failed (${res.status}), returning mock data`);
    return mockData;
  }
  try {
    const text = await res.text();
    if (text.trim().startsWith('<')) {
      console.warn('API route not found (received HTML), returning mock data');
      return mockData;
    }
    return JSON.parse(text);
  } catch (e) {
    console.warn('Failed to parse API response, returning mock data', e);
    return mockData;
  }
}

export const api = {
  async updateSettings(settings: any) {
    try {
      const res = await fetch(`${BASE_URL}/api/settings`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          ...getAuthHeaders()
        },
        body: JSON.stringify(settings)
      });
      return await handleResponse(res, { success: true, settings });
    } catch (e) {
      console.warn('Network error, returning mock data');
      return { success: true, settings };
    }
  },
  
  async getSettings() {
    try {
      const res = await fetch(`${BASE_URL}/api/settings`, {
        headers: getAuthHeaders()
      });
      return await handleResponse(res, { 
        telegram_bot_token: '', 
        llm_providers: [], 
        proxy: { enabled: false, proxy_type: 'HTTP' }, 
        webhook_url: '' 
      });
    } catch (e) {
      return { telegram_bot_token: '', llm_providers: [], proxy: { enabled: false, proxy_type: 'HTTP' }, webhook_url: '' };
    }
  },
  
  async createUser(user: any) {
    if (isLocalApp && (window as any).desktopApi) {
      return await (window as any).desktopApi.createUser(user);
    }
    try {
      const res = await fetch(`${BASE_URL}/api/users`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          ...getAuthHeaders()
        },
        body: JSON.stringify(user)
      });
      return await handleResponse(res, { id: `u${Date.now()}`, ...user });
    } catch (e) {
      return { id: `u${Date.now()}`, ...user };
    }
  },
  
  async updateUser(id: string, user: any) {
    if (isLocalApp && (window as any).desktopApi) {
      return await (window as any).desktopApi.updateUser(id, user);
    }
    try {
      const res = await fetch(`${BASE_URL}/api/users/${id}`, {
        method: 'PATCH',
        headers: { 
          'Content-Type': 'application/json',
          ...getAuthHeaders()
        },
        body: JSON.stringify(user)
      });
      return await handleResponse(res, { id, ...user });
    } catch (e) {
      return { id, ...user };
    }
  },

  async deleteUser(id: string) {
    if (isLocalApp && (window as any).desktopApi) {
      return await (window as any).desktopApi.deleteUser(id);
    }
    try {
      const res = await fetch(`${BASE_URL}/api/users/${id}`, {
        method: 'DELETE',
        headers: getAuthHeaders()
      });
      if (!res.ok) throw new Error('Failed to delete user');
      return true;
    } catch (e) {
      throw e;
    }
  },

  async getMe() {
    if (isLocalApp && (window as any).desktopApi) {
      return await (window as any).desktopApi.getMe();
    }
    try {
      const res = await fetch(`${BASE_URL}/api/users/me`, {
        headers: getAuthHeaders()
      });
      if (!res.ok) throw new Error('Failed to fetch me');
      return await res.json();
    } catch (e) {
      return null;
    }
  },

  async getUsers() {
    if (isLocalApp && (window as any).desktopApi) {
      return await (window as any).desktopApi.getUsers();
    }
    try {
      const res = await fetch(`${BASE_URL}/api/users`, {
        headers: getAuthHeaders()
      });
      if (!res.ok) throw new Error('Failed to fetch users');
      return await res.json();
    } catch (e) {
      console.error(e);
      return [];
    }
  },

  async getLogs() {
    if (isLocalApp && (window as any).desktopApi) {
      return await (window as any).desktopApi.getLogs();
    }
    try {
      const res = await fetch(`${BASE_URL}/api/logs`, {
        headers: getAuthHeaders()
      });
      if (!res.ok) throw new Error('Failed to fetch logs');
      return await res.json();
    } catch (e) {
      console.error(e);
      return { logs: 'Failed to fetch logs' };
    }
  },

  async getExternalDbs() {
    try {
      const res = await fetch(`${BASE_URL}/api/external-db`, {
        headers: getAuthHeaders()
      });
      if (!res.ok) throw new Error('Failed to fetch external DBs');
      const data = await res.json();
      return data.dbs || [];
    } catch (e) {
      console.error(e);
      return [];
    }
  },

  async addExternalDb(dbData: any) {
    try {
      const res = await fetch(`${BASE_URL}/api/external-db`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders()
        },
        body: JSON.stringify(dbData)
      });
      if (!res.ok) throw new Error('Failed to add external DB');
      const data = await res.json();
      return data.dbs || [];
    } catch (e) {
      console.error(e);
      throw e;
    }
  },

  async deleteExternalDb(id: string) {
    try {
      const res = await fetch(`${BASE_URL}/api/external-db/${id}`, {
        method: 'DELETE',
        headers: getAuthHeaders()
      });
      if (!res.ok) throw new Error('Failed to delete external DB');
      const data = await res.json();
      return data.dbs || [];
    } catch (e) {
      console.error(e);
      throw e;
    }
  },

  async createNote(note: any) {
    try {
      const res = await fetch(`${BASE_URL}/api/notes`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          ...getAuthHeaders()
        },
        body: JSON.stringify(note)
      });
      return await handleResponse(res, note);
    } catch (e) {
      return note;
    }
  },
  
  async getShares(resourceType: string, resourceId: string) {
    if (isLocalApp && (window as any).desktopApi) {
      return await (window as any).desktopApi.getShares(resourceType, resourceId);
    }
    try {
      const res = await fetch(`${BASE_URL}/api/shares/${resourceType}/${resourceId}`, {
        headers: getAuthHeaders()
      });
      return await handleResponse(res, []);
    } catch (e) {
      return [];
    }
  },

  async createShare(resourceType: string, resourceId: string, shareData: any) {
    if (isLocalApp && (window as any).desktopApi) {
      return await (window as any).desktopApi.createShare(resourceType, resourceId, shareData);
    }
    try {
      const res = await fetch(`${BASE_URL}/api/shares/${resourceType}/${resourceId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders()
        },
        body: JSON.stringify(shareData)
      });
      return await res.json();
    } catch (e) {
      throw e;
    }
  },

  async deleteShare(shareId: string) {
    if (isLocalApp && (window as any).desktopApi) {
      return await (window as any).desktopApi.deleteShare(shareId);
    }
    try {
      const res = await fetch(`${BASE_URL}/api/shares/${shareId}`, {
        method: 'DELETE',
        headers: getAuthHeaders()
      });
      if (!res.ok) throw new Error('Failed to delete share');
      return true;
    } catch (e) {
      throw e;
    }
  },

  async getPublicShare(shareId: string) {
    try {
      const res = await fetch(`${BASE_URL}/api/public/shares/${shareId}`);
      return await handleResponse(res, null);
    } catch (e) {
      return null;
    }
  },

  async updatePublicShare(shareId: string, noteData: any) {
    try {
      const res = await fetch(`${BASE_URL}/api/public/shares/${shareId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(noteData)
      });
      return await handleResponse(res, { success: false });
    } catch (e) {
      return { success: false };
    }
  },

  async getNotes() {
    try {
      const res = await fetch(`${BASE_URL}/api/notes`, {
        headers: getAuthHeaders()
      });
      return await handleResponse(res, []);
    } catch (e) {
      return [];
    }
  },
  
  async deleteNote(id: string) {
    try {
      await fetch(`${BASE_URL}/api/notes/${id}`, { 
        method: 'DELETE',
        headers: getAuthHeaders()
      });
    } catch (e) {
      console.error(e);
    }
  },
  
  async updateNote(id: string, updates: any) {
    try {
      const res = await fetch(`${BASE_URL}/api/notes/${id}`, {
        method: 'PATCH',
        headers: { 
          'Content-Type': 'application/json',
          ...getAuthHeaders()
        },
        body: JSON.stringify(updates)
      });
      return await handleResponse(res, { success: true, ...updates });
    } catch (e) {
      return { success: true, ...updates };
    }
  },
  
  async createFolder(folder: any) {
    if (isLocalApp && (window as any).desktopApi) {
      await (window as any).desktopApi.updateFolder(folder.id, folder);
      return folder;
    }
    try {
      const res = await fetch(`${BASE_URL}/api/folders`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          ...getAuthHeaders()
        },
        body: JSON.stringify(folder)
      });
      return await handleResponse(res, folder);
    } catch (e) {
      return folder;
    }
  },
  
  async getFolders() {
    if (isLocalApp && (window as any).desktopApi) {
      return await (window as any).desktopApi.getFolders();
    }
    try {
      const res = await fetch(`${BASE_URL}/api/folders`, {
        headers: getAuthHeaders()
      });
      return await handleResponse(res, []);
    } catch (e) {
      return [];
    }
  },
  
  async deleteFolder(id: string) {
    if (isLocalApp && (window as any).desktopApi) {
      return await (window as any).desktopApi.deleteFolder(id);
    }
    try {
      await fetch(`${BASE_URL}/api/folders/${id}`, { 
        method: 'DELETE',
        headers: getAuthHeaders()
      });
    } catch (e) {
      console.error(e);
    }
  },
  
  async updateFolder(id: string, updates: any) {
    if (isLocalApp && (window as any).desktopApi) {
      return await (window as any).desktopApi.updateFolder(id, updates);
    }
    try {
      const res = await fetch(`${BASE_URL}/api/folders/${id}`, {
        method: 'PATCH',
        headers: { 
          'Content-Type': 'application/json',
          ...getAuthHeaders()
        },
        body: JSON.stringify(updates)
      });
      return await handleResponse(res, { success: true, ...updates });
    } catch (e) {
      return { success: true, ...updates };
    }
  },

  async verifyFolderPassword(id: string, password: string) {
    if (isLocalApp && (window as any).desktopApi) {
      return await (window as any).desktopApi.verifyFolderPassword(id, password);
    }
    try {
      const res = await fetch(`${BASE_URL}/api/folders/${id}/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders()
        },
        body: JSON.stringify({ password })
      });
      return await res.json();
    } catch (e) {
      return { success: false };
    }
  },

  async chat(message: string, notes?: any[]) {
    if (isLocalApp && (window as any).desktopApi) {
      return await (window as any).desktopApi.chat(message, notes);
    }
    try {
      const res = await fetch(`${BASE_URL}/api/chat`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          ...getAuthHeaders()
        },
        body: JSON.stringify({ message })
      });
      return await handleResponse(res, { answer: 'Error connecting to AI', citations: [] });
    } catch (e) {
      return { answer: 'Network error', citations: [] };
    }
  },
  
  async uploadFile(formData: FormData) {
    if (isLocalApp && (window as any).desktopApi) {
      return await (window as any).desktopApi.uploadFile(formData);
    }
    try {
      const res = await fetch(`${BASE_URL}/api/upload`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: formData
      });
      return await handleResponse(res, { url: '' });
    } catch (e) {
      console.error('Upload failed:', e);
      return { url: '' };
    }
  },
  
  async importNotes(formData: FormData) {
    if (isLocalApp && (window as any).desktopApi) {
      return await (window as any).desktopApi.importNotes(formData);
    }
    try {
      const res = await fetch(`${BASE_URL}/api/notes/import`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: formData
      });
      return await handleResponse(res, { message: 'Imported', count: 0 });
    } catch (e) {
      console.error('Import failed:', e);
      return { message: 'Failed', count: 0 };
    }
  },

  async summarize(content: string) {
    if (isLocalApp && (window as any).desktopApi) {
      return await (window as any).desktopApi.summarize(content);
    }
    try {
      const res = await fetch(`${BASE_URL}/api/ai/summarize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders()
        },
        body: JSON.stringify({ content })
      });
      return await handleResponse(res, { summary: 'Failed to generate summary' });
    } catch (e) {
      console.error('Summarization failed:', e);
      return { summary: 'Network error' };
    }
  }
};
