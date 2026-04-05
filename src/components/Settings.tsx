import React, { useState, useEffect } from 'react';
import { X, Globe, Shield, User, Download, Cpu, Webhook, MessageSquare, Plus, Save, Trash2, CheckCircle, AlertCircle, Database, Edit2 } from 'lucide-react';
import CreateUserModal from './modals/CreateUserModal';
import { api } from '../api/client';
import { useLanguage } from '../contexts/LanguageContext';
import { updateSettings, getBotStatus } from '../api/settings';

type SettingsProps = {
  onClose: () => void;
};

export default function Settings({ onClose }: SettingsProps) {
  const { language, setLanguage, t } = useLanguage();
  const [activeTab, setActiveTab] = useState<'general' | 'integrations' | 'bots' | 'users'>('general');
  const [proxyType, setProxyType] = useState<'HTTP' | 'SOCKS5'>('HTTP');
  const [proxyUrl, setProxyUrl] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');

  // AI & LLM State
  const [providers, setProviders] = useState([
    { id: '1', provider: 'openai', apiKey: '', baseUrl: '', modelName: 'gpt-4-turbo', isActive: true }
  ]);

  // Telegram State
  const [botToken, setBotToken] = useState('');
  const [adminId, setAdminId] = useState('');
  const [botStatus, setBotStatus] = useState<'disconnected' | 'connected' | 'error'>('disconnected');
  const [isSaving, setIsSaving] = useState(false);

  // Users State
  const [users, setUsers] = useState<any[]>([]);
  const [isCreateUserOpen, setIsCreateUserOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<any | null>(null);

  useEffect(() => {
    if (activeTab === 'users') {
      api.getUsers().then(setUsers).catch(console.error);
    }
  }, [activeTab]);

  // Poll bot status
  useEffect(() => {
    const checkStatus = async () => {
      try {
        const data = await getBotStatus();
        setBotStatus(data.status);
      } catch (e) {
        setBotStatus('error');
      }
    };
    
    checkStatus();
    const interval = setInterval(checkStatus, 5000); // Poll every 5 seconds
    return () => clearInterval(interval);
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      // Call the new Python backend API
      await updateSettings({
        tg_token: botToken,
        tg_admin_id: adminId,
        proxy_url: proxyUrl,
        llm_provider: providers[0]?.provider,
        api_key: providers[0]?.apiKey
      });
      alert('Settings saved! The backend bot is restarting with the new configuration.');
    } catch (e) {
      console.error(e);
      alert('Failed to save settings to the backend.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleTestBot = async () => {
    if (!botToken || !adminId) {
      setBotStatus('error');
      return;
    }
    
    try {
      const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chat_id: adminId,
          text: '✅ Test message from VibeMind! Your bot is successfully connected.',
        }),
      });

      if (response.ok) {
        setBotStatus('connected');
        alert(`Test message successfully sent to Telegram ID: ${adminId}`);
      } else {
        const data = await response.json();
        console.error('Telegram API Error:', data);
        setBotStatus('error');
        alert(`Failed to send message: ${data.description || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Network Error:', error);
      setBotStatus('error');
      alert('Failed to connect to Telegram API. Check your network or token.');
    }
    
    setTimeout(() => setBotStatus('disconnected'), 5000);
  };

  const handleCreateUser = async (user: any) => {
    try {
      if (editingUser) {
        // Mock update
        setUsers(users.map(u => u.username === editingUser.username ? { ...u, ...user } : u));
        setEditingUser(null);
      } else {
        const newUser = await api.createUser(user);
        setUsers([...users, newUser]);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const addProvider = () => {
    setProviders([...providers, { id: Date.now().toString(), provider: 'ollama', apiKey: '', baseUrl: 'http://host.docker.internal:11434', modelName: 'llama3', isActive: false }]);
  };

  const updateProvider = (id: string, field: string, value: any) => {
    setProviders(providers.map(p => {
      if (p.id === id) {
        const updated = { ...p, [field]: value };
        if (field === 'isActive' && value === true) {
          // Deactivate others
          return updated;
        }
        return updated;
      }
      if (field === 'isActive' && value === true) return { ...p, isActive: false };
      return p;
    }));
  };

  const removeProvider = (id: string) => {
    setProviders(providers.filter(p => p.id !== id));
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-background">
      <div className="px-8 py-6 border-b border-border/50 flex items-center justify-between">
        <h2 className="text-2xl font-bold text-foreground">{t('settings.title')}</h2>
        <div className="flex items-center space-x-4">
          <button onClick={handleSave} disabled={isSaving} className="flex items-center px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors glow-primary disabled:opacity-50">
            <Save size={16} className={`mr-2 ${isSaving ? 'animate-spin' : ''}`} /> {isSaving ? 'Saving...' : t('settings.save')}
          </button>
          <button onClick={onClose} className="p-2 text-muted-foreground hover:text-foreground rounded-lg hover:bg-secondary transition-colors">
            <X size={20} />
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar Tabs */}
        <div className="w-64 border-r border-border/50 p-4 space-y-2 overflow-y-auto scrollbar-thin">
          <button onClick={() => setActiveTab('general')} className={`w-full flex items-center px-4 py-3 rounded-lg transition-colors ${activeTab === 'general' ? 'bg-primary/20 text-primary glow-primary' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'}`}>
            <Globe size={18} className="mr-3" /> {t('settings.general')}
          </button>
          <button onClick={() => setActiveTab('integrations')} className={`w-full flex items-center px-4 py-3 rounded-lg transition-colors ${activeTab === 'integrations' ? 'bg-primary/20 text-primary glow-primary' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'}`}>
            <Cpu size={18} className="mr-3" /> {t('settings.integrations')}
          </button>
          <button onClick={() => setActiveTab('bots')} className={`w-full flex items-center px-4 py-3 rounded-lg transition-colors ${activeTab === 'bots' ? 'bg-primary/20 text-primary glow-primary' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'}`}>
            <MessageSquare size={18} className="mr-3" /> {t('settings.bots')}
          </button>
          <button onClick={() => setActiveTab('users')} className={`w-full flex items-center px-4 py-3 rounded-lg transition-colors ${activeTab === 'users' ? 'bg-primary/20 text-primary glow-primary' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'}`}>
            <User size={18} className="mr-3" /> {t('settings.users')}
          </button>
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto p-8 scrollbar-thin">
          <div className="max-w-3xl mx-auto space-y-8">
            
            {activeTab === 'general' && (
              <>
                <section className="space-y-4">
                  <h3 className="text-lg font-semibold text-foreground">{t('settings.language')}</h3>
                  <div className="flex items-center space-x-4 bg-card p-4 rounded-lg border border-border/50 glass">
                    <button onClick={() => setLanguage('EN')} className={`px-4 py-2 rounded-lg transition-colors ${language === 'EN' ? 'bg-primary text-primary-foreground glow-primary' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'}`}>English</button>
                    <button onClick={() => setLanguage('RU')} className={`px-4 py-2 rounded-lg transition-colors ${language === 'RU' ? 'bg-primary text-primary-foreground glow-primary' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'}`}>Русский</button>
                  </div>
                </section>

                <section className="space-y-4">
                  <h3 className="text-lg font-semibold text-foreground">{t('settings.proxy')}</h3>
                  <div className="bg-card p-4 rounded-lg border border-border/50 space-y-4 glass">
                    <select value={proxyType} onChange={(e) => setProxyType(e.target.value as 'HTTP' | 'SOCKS5')} className="w-full bg-background border border-border rounded-lg p-2 text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all">
                      <option value="HTTP">HTTP Proxy</option>
                      <option value="SOCKS5">SOCKS5 Proxy</option>
                    </select>
                    <input 
                      type="text" 
                      placeholder="http://user:pass@proxy:port" 
                      value={proxyUrl}
                      onChange={(e) => setProxyUrl(e.target.value)}
                      className="w-full bg-background border border-border rounded-lg p-2 text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all" 
                    />
                  </div>
                </section>

                <section className="space-y-4">
                  <h3 className="text-lg font-semibold text-foreground">{t('settings.webhooks')}</h3>
                  <div className="bg-card p-4 rounded-lg border border-border/50 glass">
                    <input type="text" value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} placeholder="http://homeassistant.local:8123/api/webhook/vibemind" className="w-full bg-background border border-border rounded-lg p-2 text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all" />
                  </div>
                </section>

                <section className="space-y-4">
                  <h3 className="text-lg font-semibold text-foreground">{t('settings.export')}</h3>
                  <div className="bg-card p-4 rounded-lg border border-border/50 flex justify-between items-center glass">
                    <div>
                      <div className="text-foreground font-medium">Markdown Export</div>
                      <div className="text-sm text-muted-foreground">Download all notes as a ZIP archive</div>
                    </div>
                    <button className="px-4 py-2 bg-primary/10 text-primary hover:bg-primary/20 rounded-lg transition-colors flex items-center">
                      <Download size={16} className="mr-2" /> Export ZIP
                    </button>
                  </div>
                </section>
              </>
            )}

            {activeTab === 'integrations' && (
              <div className="space-y-8">
                <section className="space-y-6">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-foreground">LLM Providers</h3>
                    <button onClick={addProvider} className="flex items-center px-3 py-1.5 bg-secondary text-foreground hover:bg-secondary/80 rounded-lg border border-border/50 hover:border-primary hover:glow-border transition-all">
                      <Plus size={16} className="mr-2" /> Add Provider
                    </button>
                  </div>

                  {providers.map(provider => (
                    <div key={provider.id} className={`bg-card p-5 rounded-lg border glass ${provider.isActive ? 'border-primary glow-border' : 'border-border/50'} relative transition-all`}>
                      <div className="absolute top-4 right-4 flex items-center space-x-4">
                        <label className="flex items-center space-x-2 cursor-pointer text-sm text-muted-foreground">
                          <input type="radio" checked={provider.isActive} onChange={() => updateProvider(provider.id, 'isActive', true)} className="form-radio text-primary bg-background border-border" />
                          <span>Active</span>
                        </label>
                        <button onClick={() => removeProvider(provider.id)} className="text-muted-foreground hover:text-destructive transition-colors">
                          <Trash2 size={16} />
                        </button>
                      </div>

                      <div className="space-y-4 mt-2">
                        <div>
                          <label className="block text-sm text-muted-foreground mb-1">Provider Type</label>
                          <select value={provider.provider} onChange={(e) => updateProvider(provider.id, 'provider', e.target.value)} className="w-full max-w-xs bg-background border border-border rounded-lg p-2 text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all">
                            <option value="openai">OpenAI</option>
                            <option value="gemini">Google Gemini</option>
                            <option value="ollama">Local Ollama</option>
                          </select>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          {provider.provider === 'ollama' ? (
                            <div>
                              <label className="block text-sm text-muted-foreground mb-1">Base URL</label>
                              <input type="text" value={provider.baseUrl} onChange={(e) => updateProvider(provider.id, 'baseUrl', e.target.value)} placeholder="http://host.docker.internal:11434" className="w-full bg-background border border-border rounded-lg p-2 text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all" />
                            </div>
                          ) : (
                            <div>
                              <label className="block text-sm text-muted-foreground mb-1">API Key (Encrypted)</label>
                              <input type="password" value={provider.apiKey} onChange={(e) => updateProvider(provider.id, 'apiKey', e.target.value)} placeholder="sk-..." className="w-full bg-background border border-border rounded-lg p-2 text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all" />
                            </div>
                          )}
                          <div>
                            <label className="block text-sm text-muted-foreground mb-1">Model Name</label>
                            <input type="text" value={provider.modelName} onChange={(e) => updateProvider(provider.id, 'modelName', e.target.value)} placeholder="e.g., gpt-4, llama3" className="w-full bg-background border border-border rounded-lg p-2 text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all" />
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </section>

                <section className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-foreground">External Databases</h3>
                    <button className="flex items-center px-3 py-1.5 bg-secondary text-foreground hover:bg-secondary/80 rounded-lg border border-border/50 hover:border-primary hover:glow-border transition-all">
                      <Plus size={16} className="mr-2" /> Add DB
                    </button>
                  </div>
                  <div className="bg-card p-6 rounded-lg border border-border/50 text-center text-muted-foreground glass">
                    <Database size={32} className="mx-auto mb-2 opacity-50" />
                    <p>Connect external PostgreSQL or MongoDB databases for RAG.</p>
                  </div>
                </section>
              </div>
            )}

            {activeTab === 'bots' && (
              <div className="space-y-6">
                <h3 className="text-lg font-semibold text-foreground">Telegram Bot Configuration</h3>
                <div className="bg-card p-6 rounded-lg border border-border/50 space-y-6 glass">
                  <div>
                    <label className="block text-sm text-muted-foreground mb-1">Bot Token</label>
                    <input type="password" value={botToken} onChange={(e) => setBotToken(e.target.value)} placeholder="123456789:ABCdefGHIjklMNOpqrSTUvwxYZ" className="w-full bg-background border border-border rounded-lg p-2 text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all" />
                  </div>
                  <div>
                    <label className="block text-sm text-muted-foreground mb-1">Admin Telegram ID</label>
                    <input type="text" value={adminId} onChange={(e) => setAdminId(e.target.value)} placeholder="e.g., 12345678" className="w-full bg-background border border-border rounded-lg p-2 text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all" />
                    <p className="text-xs text-muted-foreground mt-1">Only this user will be able to interact with the bot.</p>
                  </div>
                  
                  <div className="pt-4 border-t border-border/50 flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <span className="text-sm text-muted-foreground">Status:</span>
                      {botStatus === 'connected' && <span className="flex items-center text-accent text-sm"><CheckCircle size={16} className="mr-1" /> Live</span>}
                      {botStatus === 'error' && <span className="flex items-center text-destructive text-sm"><AlertCircle size={16} className="mr-1" /> Error</span>}
                      {botStatus === 'disconnected' && <span className="text-muted-foreground text-sm">Disconnected</span>}
                    </div>
                    <button onClick={handleTestBot} className="px-4 py-2 bg-secondary text-foreground hover:bg-secondary/80 rounded-lg border border-border/50 hover:border-primary hover:glow-border transition-all">
                      Test Connection
                    </button>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'users' && (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-foreground">User Management</h3>
                  <button onClick={() => { setEditingUser(null); setIsCreateUserOpen(true); }} className="flex items-center px-3 py-1.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors glow-primary">
                    <Plus size={16} className="mr-2" /> Add User
                  </button>
                </div>

                <div className="bg-card rounded-lg border border-border/50 overflow-hidden glass">
                  <table className="w-full text-left text-sm text-muted-foreground">
                    <thead className="bg-secondary/50 text-foreground uppercase text-xs">
                      <tr>
                        <th className="px-6 py-3">Username</th>
                        <th className="px-6 py-3">Email</th>
                        <th className="px-6 py-3">Status</th>
                        <th className="px-6 py-3">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.length === 0 ? (
                        <tr className="border-t border-border/50">
                          <td colSpan={4} className="px-6 py-4 text-center text-muted-foreground">No users found. (Mock mode active)</td>
                        </tr>
                      ) : (
                        users.map((u, i) => (
                          <tr key={i} className="border-t border-border/50 hover:bg-secondary/50 transition-colors">
                            <td className="px-6 py-4 font-medium text-foreground">{u.username}</td>
                            <td className="px-6 py-4">{u.email}</td>
                            <td className="px-6 py-4"><span className="px-2 py-1 bg-accent/10 text-accent rounded text-xs">Active</span></td>
                            <td className="px-6 py-4 flex space-x-3">
                              <button 
                                onClick={() => { setEditingUser(u); setIsCreateUserOpen(true); }}
                                className="text-primary hover:text-primary/80 transition-colors"
                              >
                                <Edit2 size={16} />
                              </button>
                              <button 
                                onClick={() => setUsers(users.filter(user => user.username !== u.username))}
                                className="text-destructive hover:text-destructive/80 transition-colors"
                              >
                                <Trash2 size={16} />
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="pt-8 flex justify-end">
                  <button className="px-4 py-2 bg-destructive/10 text-destructive hover:bg-destructive/20 rounded-lg transition-colors">
                    Logout Current Session
                  </button>
                </div>
              </div>
            )}

          </div>
        </div>
      </div>

      <CreateUserModal 
        isOpen={isCreateUserOpen} 
        onClose={() => { setIsCreateUserOpen(false); setEditingUser(null); }} 
        onCreate={handleCreateUser} 
        initialData={editingUser}
      />
    </div>
  );
}
