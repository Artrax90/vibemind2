const BASE_URL = ''; // Relative to current host

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
    // We don't reload here to avoid infinite loops, but the app should react to token change
  }
  if (!res.ok) {
    console.warn(`API call failed (${res.status}), returning mock data`);
    return mockData;
  }
  try {
    const text = await res.text();
    // If Vite returns index.html for a missing API route
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
    try {
      const res = await fetch(`${BASE_URL}/api/users`, {
        headers: getAuthHeaders()
      });
      return await handleResponse(res, [
        { id: '1', username: 'admin', email: 'admin@vibemind.local', role: 'admin' }
      ]);
    } catch (e) {
      return [{ id: '1', username: 'admin', email: 'admin@vibemind.local', role: 'admin' }];
    }
  },

  async getLogs(lines: number = 100) {
    try {
      const res = await fetch(`${BASE_URL}/api/admin/logs?lines=${lines}`, {
        headers: getAuthHeaders()
      });
      return await handleResponse(res, { logs: 'Failed to fetch logs' });
    } catch (e) {
      return { logs: 'Network error' };
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
    try {
      const res = await fetch(`${BASE_URL}/api/shares/${resourceType}/${resourceId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders()
        },
        body: JSON.stringify(shareData)
      });
      return await handleResponse(res, null);
    } catch (e) {
      throw e;
    }
  },

  async deleteShare(shareId: string) {
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
      if (!res.ok) throw new Error('Failed to load public share');
      return await res.json();
    } catch (e) {
      throw e;
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
      if (!res.ok) throw new Error('Failed to update public share');
      return await res.json();
    } catch (e) {
      throw e;
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

  async chat(message: string) {
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
  }
};
