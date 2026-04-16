import { dbApi } from '../lib/db';

let cachedToken: string | null = null;
let lastTokenFetch = 0;
const TOKEN_EXPIRY = 1000 * 60 * 60; // 1 hour

export const api = {
  async getSettings() {
    const config = await dbApi.getSyncConfig();
    return config;
  },
  
  async updateSettings(settings: any) {
    await dbApi.saveSyncConfig(settings);
    cachedToken = null; // Clear token on settings change
    return { success: true, settings };
  },

  async createNote(note: any) {
    await dbApi.saveNote({ ...note, is_dirty: 1 });
    return note;
  },

  async getNotes() {
    const notes = await dbApi.getNotes();
    return notes.map((n: any) => ({
      ...n,
      isPinned: !!n.isPinned,
      isShared: !!n.isShared,
      isSharedByMe: !!n.isSharedByMe
    }));
  },
  
  async deleteNote(id: string) {
    await dbApi.deleteNote(id);
  },
  
  async updateNote(id: string, updates: any) {
    const notes = await dbApi.getNotes();
    const note = notes.find((n: any) => n.id === id);
    if (note) {
      await dbApi.saveNote({ ...note, ...updates, is_dirty: 1 });
    }
    return { success: true, ...updates };
  },
  
  async createFolder(folder: any) {
    await dbApi.saveFolder(folder);
    return folder;
  },
  
  async getFolders() {
    const folders = await dbApi.getFolders();
    return folders.map((f: any) => ({
      ...f,
      isShared: !!f.isShared,
      isSharedByMe: !!f.isSharedByMe
    }));
  },
  
  async deleteFolder(id: string) {
    await dbApi.deleteFolder(id);
  },
  
  async updateFolder(id: string, updates: any) {
    const folders = await dbApi.getFolders();
    const folder = folders.find((f: any) => f.id === id);
    if (folder) {
      await dbApi.saveFolder({ ...folder, ...updates });
    }
    return { success: true, ...updates };
  },

  async getNormalizedUrl() {
    const config = await dbApi.getSyncConfig();
    if (!config.server_url) return null;
    let url = config.server_url.trim().replace(/\/$/, '');
    if (url && !url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'http://' + url;
    }
    return url;
  },

  async getServerToken() {
    if (cachedToken && (Date.now() - lastTokenFetch < TOKEN_EXPIRY)) {
      return cachedToken;
    }

    const baseUrl = await this.getNormalizedUrl();
    const config = await dbApi.getSyncConfig();
    if (!baseUrl || !config.username || !config.password) return null;
    
    try {
      const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: config.username, password: config.password })
      });
      if (!loginRes.ok) return null;
      const { access_token } = await loginRes.json();
      cachedToken = access_token;
      lastTokenFetch = Date.now();
      return access_token;
    } catch (e) {
      return null;
    }
  },

  async getActiveProvider() {
    const config = await this.getSettings();
    if (config.providers) {
      try {
        const providers = JSON.parse(config.providers);
        return providers.find((p: any) => p.isActive);
      } catch (e) {}
    }
    return null;
  },

  async chat(message: string, notes?: any[]) {
    const baseUrl = await this.getNormalizedUrl();
    const token = await this.getServerToken();
    
    const runLocalRag = async () => {
      const provider = await this.getActiveProvider();
      if (!provider) return { answer: 'AI not configured. Please set up an AI provider in Settings.', citations: [] };
      
      let prompt = message;
      let citations: any[] = [];
      
      if (notes && notes.length > 0) {
        // Simple offline RAG: keyword search
        const cleanMessage = message.toLowerCase().replace(/[^\w\sа-яё]/gi, ' ');
        const stopWords = new Set(['как', 'что', 'это', 'где', 'когда', 'почему', 'зачем', 'про', 'для', 'или', 'под', 'над', 'the', 'and', 'for', 'with', 'about', 'есть', 'нет', 'мне', 'нам', 'вам', 'какие', 'какой', 'какая', 'какого', 'каких', 'все', 'тут', 'там']);
        
        // Simple transliteration map for common tech terms
        const translit: Record<string, string> = {
          'докер': 'docker',
          'докера': 'docker',
          'питон': 'python',
          'джава': 'java',
          'рект': 'react',
          'реакт': 'react',
          'нода': 'node'
        };

        const getStem = (w: string) => {
          if (w.match(/^[a-z]+$/)) {
            if (w.length > 4) return w.replace(/(es|s|ing|ed)$/i, '');
            return w;
          }
          if (w.length <= 4) return w;
          return w.replace(/(ами|ями|ах|ях|ов|ев|ей|ой|ий|ый|ые|ие|ую|юю|его|ого|им|ым|их|ых|ом|ем|ам|ям|а|я|о|е|и|ы|у|ю)$/i, '');
        };
        
        const keywords = cleanMessage.split(/\s+/)
          .filter(w => w.length > 2 && !stopWords.has(w))
          .map(w => translit[w] || w)
          .map(getStem);
        
        const scoredNotes = notes.map(note => {
          let score = 0;
          const text = (note.title + ' ' + note.content).toLowerCase();
          keywords.forEach(kw => {
            if (text.includes(kw)) score++;
          });
          return { ...note, score };
        }).filter(n => n.score > 0).sort((a, b) => b.score - a.score).slice(0, 3);
        
        if (scoredNotes.length > 0) {
          const context = scoredNotes.map(n => `Title: ${n.title}\nContent: ${n.content}`).join('\n\n');
          prompt = `Context information is below.\n---------------------\n${context}\n---------------------\nGiven the context information and not prior knowledge, answer the query. Answer strictly in the language of the user's query. If the query is in Russian, answer in Russian (Русский), NOT Ukrainian.\nQuery: ${message}`;
          citations = scoredNotes.map(n => ({ id: n.id, title: n.title, snippet: n.content.substring(0, 100) + '...' }));
        } else {
          prompt = `The user is asking a question about their notes, but no relevant notes were found for the query: "${message}". Please politely inform the user that you couldn't find any notes matching their request, but you can still try to answer from your general knowledge if they want. Answer strictly in the language of the user's query. If the query is in Russian, answer in Russian (Русский), NOT Ukrainian.`;
        }
      }
      
      try {
        if (provider.provider === 'openai' || provider.provider === 'openrouter' || provider.provider === 'ollama') {
          const apiUrl = provider.baseUrl || (provider.provider === 'openai' ? 'https://api.openai.com/v1' : 'https://openrouter.ai/api/v1');
          const res = await fetch(`${apiUrl}/chat/completions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${provider.apiKey}`
            },
            body: JSON.stringify({
              model: provider.modelName,
              messages: [{ role: 'user', content: prompt }]
            })
          });
          if (!res.ok) throw new Error('API Error');
          const data = await res.json();
          return { answer: data.choices[0].message.content, citations };
        } else if (provider.provider === 'gemini') {
          const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${provider.modelName}:generateContent?key=${provider.apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
          });
          if (!res.ok) throw new Error('API Error');
          const data = await res.json();
          return { answer: data.candidates[0].content.parts[0].text, citations };
        }
      } catch (e) {
        return { answer: 'Local AI request failed. Check your API key and settings.', citations: [] };
      }
      return { answer: 'Unknown AI provider.', citations: [] };
    };
    
    if (!token || !baseUrl) {
      return await runLocalRag();
    }

    try {
      const res = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ message })
      });
      if (!res.ok) throw new Error('API Error');
      return await res.json();
    } catch (e) {
      // Fallback to local RAG if network fails
      return await runLocalRag();
    }
  },

  async summarize(content: string) {
    const baseUrl = await this.getNormalizedUrl();
    const token = await this.getServerToken();
    
    if (!token || !baseUrl) {
      const provider = await this.getActiveProvider();
      if (!provider) return { summary: 'AI not configured.' };
      
      const prompt = `Summarize the following text. Reply in the same language as the text:\n\n${content}`;
      try {
        if (provider.provider === 'openai' || provider.provider === 'openrouter' || provider.provider === 'ollama') {
          const apiUrl = provider.baseUrl || (provider.provider === 'openai' ? 'https://api.openai.com/v1' : 'https://openrouter.ai/api/v1');
          const res = await fetch(`${apiUrl}/chat/completions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${provider.apiKey}`
            },
            body: JSON.stringify({
              model: provider.modelName,
              messages: [{ role: 'user', content: prompt }]
            })
          });
          if (!res.ok) throw new Error('API Error');
          const data = await res.json();
          return { summary: data.choices[0].message.content };
        } else if (provider.provider === 'gemini') {
          const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${provider.modelName}:generateContent?key=${provider.apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
          });
          if (!res.ok) throw new Error('API Error');
          const data = await res.json();
          return { summary: data.candidates[0].content.parts[0].text };
        }
      } catch (e) {
        return { summary: 'Local AI request failed.' };
      }
    }

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
    await dbApi.clearData();
  }
};
