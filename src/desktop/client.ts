const isElectron = !!(window as any).electronAPI;

export const api = {
  async getSettings() {
    const config = await (window as any).electronAPI.getSyncConfig();
    return { 
      server_url: config.server_url || '',
      username: config.username || '',
      password: config.password || ''
    };
  },
  
  async updateSettings(settings: any) {
    await (window as any).electronAPI.saveSyncConfig(settings);
    return { success: true, settings };
  },

  async createNote(note: any) {
    await (window as any).electronAPI.saveNote({ ...note, is_dirty: 1 });
    return note;
  },

  async getNotes() {
    const notes = await (window as any).electronAPI.getNotes();
    return notes.map((n: any) => ({
      ...n,
      isPinned: !!n.isPinned,
      isShared: !!n.isShared,
      isSharedByMe: !!n.isSharedByMe
    }));
  },
  
  async deleteNote(id: string) {
    await (window as any).electronAPI.deleteNote(id);
  },
  
  async updateNote(id: string, updates: any) {
    const notes = await (window as any).electronAPI.getNotes();
    const note = notes.find((n: any) => n.id === id);
    if (note) {
      await (window as any).electronAPI.saveNote({ ...note, ...updates, is_dirty: 1 });
    }
    return { success: true, ...updates };
  },
  
  async createFolder(folder: any) {
    await (window as any).electronAPI.saveFolder(folder);
    return folder;
  },
  
  async getFolders() {
    const folders = await (window as any).electronAPI.getFolders();
    return folders.map((f: any) => ({
      ...f,
      isShared: !!f.isShared,
      isSharedByMe: !!f.isSharedByMe
    }));
  },
  
  async deleteFolder(id: string) {
    await (window as any).electronAPI.deleteFolder(id);
  },
  
  async updateFolder(id: string, updates: any) {
    const folders = await (window as any).electronAPI.getFolders();
    const folder = folders.find((f: any) => f.id === id);
    if (folder) {
      await (window as any).electronAPI.saveFolder({ ...folder, ...updates });
    }
    return { success: true, ...updates };
  },

  async getNormalizedUrl() {
    const config = await (window as any).electronAPI.getSyncConfig();
    if (!config.server_url) return null;
    let url = config.server_url.trim().replace(/\/$/, '');
    if (url && !url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'http://' + url;
    }
    return url;
  },

  async getServerToken() {
    const baseUrl = await this.getNormalizedUrl();
    const config = await (window as any).electronAPI.getSyncConfig();
    if (!baseUrl || !config.username || !config.password) return null;
    
    try {
      const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: config.username, password: config.password })
      });
      if (!loginRes.ok) return null;
      const { access_token } = await loginRes.json();
      return access_token;
    } catch (e) {
      return null;
    }
  },

  async chat(message: string) {
    const baseUrl = await this.getNormalizedUrl();
    const token = await this.getServerToken();
    if (!token || !baseUrl) return { answer: 'Server not connected or AI not configured.', citations: [] };

    try {
      const res = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ message })
      });
      if (!res.ok) return { answer: 'AI request failed.', citations: [] };
      return await res.json();
    } catch (e) {
      return { answer: 'Network error.', citations: [] };
    }
  },

  async summarize(content: string) {
    const baseUrl = await this.getNormalizedUrl();
    const token = await this.getServerToken();
    if (!token || !baseUrl) return { summary: 'Server not connected.' };

    try {
      const res = await fetch(`${baseUrl}/api/ai/summarize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ content })
      });
      if (!res.ok) return { summary: 'Summarization failed.' };
      return await res.json();
    } catch (e) {
      return { summary: 'Network error.' };
    }
  },

  async getRemoteSettings() {
    const baseUrl = await this.getNormalizedUrl();
    const token = await this.getServerToken();
    if (!token || !baseUrl) return null;

    try {
      const res = await fetch(`${baseUrl}/api/settings`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      return null;
    }
  },

  async updateRemoteSettings(settings: any) {
    const baseUrl = await this.getNormalizedUrl();
    const token = await this.getServerToken();
    if (!token || !baseUrl) return { success: false };

    try {
      const res = await fetch(`${baseUrl}/api/settings`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(settings)
      });
      return { success: res.ok };
    } catch (e) {
      return { success: false };
    }
  },

  async uploadFile(formData: FormData) {
    const baseUrl = await this.getNormalizedUrl();
    const token = await this.getServerToken();
    if (!token || !baseUrl) throw new Error('Server not connected');

    const res = await fetch(`${baseUrl}/api/upload`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: formData
    });
    
    if (!res.ok) throw new Error('Upload failed');
    const data = await res.json();
    if (data.url && data.url.startsWith('/')) {
      data.url = `${baseUrl}${data.url}`;
    }
    return data;
  },

  async importNotes(formData: FormData) {
    const baseUrl = await this.getNormalizedUrl();
    const token = await this.getServerToken();
    if (!token || !baseUrl) throw new Error('Server not connected');

    const res = await fetch(`${baseUrl}/api/notes/import`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: formData
    });
    
    if (!res.ok) throw new Error('Import failed');
    return await res.json();
  },
  
  async getMe() {
    const baseUrl = await this.getNormalizedUrl();
    const token = await this.getServerToken();
    if (!token || !baseUrl) return null;
    try {
      const res = await fetch(`${baseUrl}/api/users/me`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      return null;
    }
  },

  async getUsers() {
    const baseUrl = await this.getNormalizedUrl();
    const token = await this.getServerToken();
    if (!token || !baseUrl) return [];
    try {
      const res = await fetch(`${baseUrl}/api/users`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) return [];
      return await res.json();
    } catch (e) {
      return [];
    }
  },

  async createUser(user: any) {
    const baseUrl = await this.getNormalizedUrl();
    const token = await this.getServerToken();
    if (!token || !baseUrl) throw new Error('Server not connected');
    const res = await fetch(`${baseUrl}/api/users`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(user)
    });
    if (!res.ok) throw new Error('Failed to create user');
    return await res.json();
  },

  async updateUser(id: string, user: any) {
    const baseUrl = await this.getNormalizedUrl();
    const token = await this.getServerToken();
    if (!token || !baseUrl) throw new Error('Server not connected');
    const res = await fetch(`${baseUrl}/api/users/${id}`, {
      method: 'PATCH',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(user)
    });
    if (!res.ok) throw new Error('Failed to update user');
    return await res.json();
  },

  async deleteUser(id: string) {
    const baseUrl = await this.getNormalizedUrl();
    const token = await this.getServerToken();
    if (!token || !baseUrl) throw new Error('Server not connected');
    const res = await fetch(`${baseUrl}/api/users/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) throw new Error('Failed to delete user');
    return true;
  },

  async getLogs() {
    const baseUrl = await this.getNormalizedUrl();
    const token = await this.getServerToken();
    if (!token || !baseUrl) return { logs: 'Server not connected' };
    try {
      const res = await fetch(`${baseUrl}/api/logs`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) return { logs: 'Failed to fetch logs' };
      return await res.json();
    } catch (e) {
      return { logs: 'Network error' };
    }
  },

  async getShares(resourceType: string, resourceId: string) {
    const baseUrl = await this.getNormalizedUrl();
    const token = await this.getServerToken();
    if (!token || !baseUrl) return [];
    try {
      const res = await fetch(`${baseUrl}/api/shares/${resourceType}/${resourceId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) return [];
      return await res.json();
    } catch (e) {
      return [];
    }
  },

  async createShare(resourceType: string, resourceId: string, shareData: any) {
    const baseUrl = await this.getNormalizedUrl();
    const token = await this.getServerToken();
    if (!token || !baseUrl) throw new Error('Server not connected');
    const res = await fetch(`${baseUrl}/api/shares/${resourceType}/${resourceId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(shareData)
    });
    if (!res.ok) throw new Error('Failed to create share');
    return await res.json();
  },

  async deleteShare(shareId: string) {
    const baseUrl = await this.getNormalizedUrl();
    const token = await this.getServerToken();
    if (!token || !baseUrl) throw new Error('Server not connected');
    const res = await fetch(`${baseUrl}/api/shares/${shareId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) throw new Error('Failed to delete share');
    return true;
  },

  async clearLocalData() {
    if (isElectron) {
      await (window as any).electronAPI.clearData();
    }
  }
};
