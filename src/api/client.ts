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
  
  async getUsers() {
    try {
      const res = await fetch(`${BASE_URL}/api/users`, {
        headers: getAuthHeaders()
      });
      return await handleResponse(res, [
        { id: '1', username: 'admin', email: 'admin@vibemind.local', role: 'Admin' }
      ]);
    } catch (e) {
      return [{ id: '1', username: 'admin', email: 'admin@vibemind.local', role: 'Admin' }];
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
  }
};
