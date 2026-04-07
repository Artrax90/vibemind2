import React, { useState, useEffect } from 'react';
import { X, Globe, Shield, User, Download, Cpu, Webhook, MessageSquare, Plus, Save, Trash2, CheckCircle, AlertCircle, Database, Edit2, Server, Lock, Key, Sun, Moon } from 'lucide-react';
import CreateUserModal from './modals/CreateUserModal';
import AddDBModal from './modals/AddDBModal';
import { api } from '../api/client';
import { useLanguage } from '../contexts/LanguageContext';
import { updateSettings, getBotStatus } from '../api/settings';

type SettingsProps = {
  onClose: () => void;
  theme: 'dark' | 'light';
  setTheme: (theme: 'dark' | 'light') => void;
};

export default function Settings({ onClose, theme, setTheme }: SettingsProps) {
  const { language, setLanguage, t } = useLanguage();
  const [activeTab, setActiveTab] = useState<'general' | 'integrations' | 'bots' | 'users'>('general');
  
  // Proxy State
  const [proxyConfig, setProxyConfig] = useState({
    protocol: 'HTTP',
    host: '',
    port: '',
    username: '',
    password: ''
  });
  
  const [webhookUrl, setWebhookUrl] = useState('');

  // AI & LLM State
  const [providers, setProviders] = useState([
    { id: '1', label: 'OpenAI', provider: 'openai', apiKey: '', baseUrl: 'https://api.openai.com/v1', modelName: 'gpt-4-turbo', isActive: true, status: 'idle' }
  ]);

  // External DB State
  const [externalDbs, setExternalDbs] = useState<any[]>([]);
  const [isAddDBOpen, setIsAddDBOpen] = useState(false);

  // Telegram State
  const [botToken, setBotToken] = useState('');
  const [adminId, setAdminId] = useState('');
  const [botStatus, setBotStatus] = useState<'disconnected' | 'connected' | 'error'>('disconnected');
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testingProviderId, setTestingProviderId] = useState<string | null>(null);

  // Users State
  const [users, setUsers] = useState<any[]>([]);
  const [isCreateUserOpen, setIsCreateUserOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<any | null>(null);

  useEffect(() => {
    if (activeTab === 'users') {
      api.getUsers().then(setUsers).catch(console.error);
    }
    if (activeTab === 'integrations') {
      fetch('/api/external-db')
        .then(res => res.json())
        .then(data => setExternalDbs(data.dbs))
        .catch(console.error);
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
        proxy_config: proxyConfig,
        llm_provider: providers.find(p => p.isActive)?.provider,
        api_key: providers.find(p => p.isActive)?.apiKey,
        base_url: providers.find(p => p.isActive)?.baseUrl,
        model_name: providers.find(p => p.isActive)?.modelName
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
    if (!botToken) {
      setBotStatus('error');
      return;
    }
    
    setIsTesting(true);
    try {
      const response = await fetch('/api/bot/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tg_token: botToken, proxy_config: proxyConfig })
      });

      const data = await response.json();
      if (response.ok) {
        setBotStatus('connected');
        alert(data.message || '✅ Connection Successful!');
      } else {
        setBotStatus('error');
        alert(`❌ Failed: ${data.detail || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Network Error:', error);
      setBotStatus('error');
      alert('Failed to connect to VibeMind API.');
    } finally {
      setIsTesting(false);
    }
  };

  const handleTestProxy = async () => {
    if (!proxyConfig.host) {
      alert('Please enter a proxy host first.');
      return;
    }
    try {
      const response = await fetch('/api/proxy/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proxy_config: proxyConfig })
      });
      const data = await response.json();
      if (response.ok && data.status === 'success') {
        alert('✅ Proxy connection successful!');
      } else {
        alert(`❌ Proxy test failed: ${data.detail || 'Unknown error'}`);
      }
    } catch (e) {
      alert('❌ Proxy test request failed.');
    }
  };

  const handleAddExternalDB = async (dbData: any) => {
    try {
      const response = await fetch('/api/external-db', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dbData)
      });
      
      if (response.ok) {
        const data = await response.json();
        setExternalDbs(data.dbs);
        alert('External Database connected successfully!');
      } else {
        alert('Failed to connect external database.');
      }
    } catch (e) {
      console.error(e);
      alert('Error connecting to external database.');
    }
  };

  const handleTestProvider = async (provider: any) => {
    setTestingProviderId(provider.id);
    try {
      const response = await fetch('/api/integrations/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('access_token')}`
        },
        body: JSON.stringify({
          provider: provider.provider,
          api_key: provider.apiKey,
          base_url: provider.baseUrl,
          model_name: provider.modelName
        })
      });
      const data = await response.json();
      if (response.ok && data.status === 'success') {
        setProviders(providers.map(p => p.id === provider.id ? { ...p, status: 'connected' } : p));
        alert('✅ Connection Successful!');
      } else {
        setProviders(providers.map(p => p.id === provider.id ? { ...p, status: 'error' } : p));
        alert(`❌ Failed: ${data.detail || data.message || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Test Provider Error:', error);
      setProviders(providers.map(p => p.id === provider.id ? { ...p, status: 'error' } : p));
      alert('❌ Failed to test connection.');
    } finally {
      setTestingProviderId(null);
    }
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
    setProviders([...providers, { id: Date.now().toString(), label: 'New Provider', provider: 'custom', apiKey: '', baseUrl: 'https://api.example.com/v1', modelName: 'default-model', isActive: false, status: 'idle' }]);
  };

  const updateProvider = (id: string, field: string, value: any) => {
    setProviders(providers.map(p => {
      if (p.id === id) {
        let updated = { ...p, [field]: value };
        
        // Set defaults when provider type changes
        if (field === 'provider') {
          if (value === 'openai') {
            updated.baseUrl = 'https://api.openai.com/v1';
            updated.modelName = 'gpt-4o-mini';
          } else if (value === 'gemini') {
            updated.baseUrl = '';
            updated.modelName = 'gemini-1.5-flash';
          } else if (value === 'openrouter') {
            updated.baseUrl = 'https://openrouter.ai/api/v1';
            updated.modelName = 'google/gemini-2.0-flash-001';
          } else if (value === 'ollama') {
            updated.baseUrl = 'http://localhost:11434/v1';
            updated.modelName = 'llama3';
          }
        }

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
          <button onClick={handleSave} disabled={isSaving} className="flex items-center px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50">
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
          <button onClick={() => setActiveTab('general')} className={`w-full flex items-center px-4 py-3 rounded-lg transition-colors ${activeTab === 'general' ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'}`}>
            <Globe size={18} className="mr-3" /> {t('settings.general')}
          </button>
          <button onClick={() => setActiveTab('integrations')} className={`w-full flex items-center px-4 py-3 rounded-lg transition-colors ${activeTab === 'integrations' ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'}`}>
            <Cpu size={18} className="mr-3" /> {t('settings.integrations')}
          </button>
          <button onClick={() => setActiveTab('bots')} className={`w-full flex items-center px-4 py-3 rounded-lg transition-colors ${activeTab === 'bots' ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'}`}>
            <MessageSquare size={18} className="mr-3" /> {t('settings.bots')}
          </button>
          <button onClick={() => setActiveTab('users')} className={`w-full flex items-center px-4 py-3 rounded-lg transition-colors ${activeTab === 'users' ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'}`}>
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
                  <div className="flex items-center space-x-4 bg-card p-4 rounded-lg border border-border/50">
                    <button onClick={() => setLanguage('EN')} className={`px-4 py-2 rounded-lg transition-colors ${language === 'EN' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'}`}>English</button>
                    <button onClick={() => setLanguage('RU')} className={`px-4 py-2 rounded-lg transition-colors ${language === 'RU' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'}`}>Русский</button>
                  </div>
                </section>

                <section className="space-y-4">
                  <h3 className="text-lg font-semibold text-foreground">Theme</h3>
                  <div className="flex items-center space-x-4 bg-card p-4 rounded-lg border border-border/50">
                    <button 
                      onClick={() => setTheme('light')} 
                      className={`flex items-center px-4 py-2 rounded-lg transition-colors ${theme === 'light' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'}`}
                    >
                      <Sun size={16} className="mr-2" /> Light
                    </button>
                    <button 
                      onClick={() => setTheme('dark')} 
                      className={`flex items-center px-4 py-2 rounded-lg transition-colors ${theme === 'dark' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'}`}
                    >
                      <Moon size={16} className="mr-2" /> Dark
                    </button>
                  </div>
                </section>

                <section className="space-y-4">
                  <h3 className="text-lg font-semibold text-foreground">{t('settings.webhooks')}</h3>
                  <div className="bg-card p-4 rounded-lg border border-border/50">
                    <input type="text" value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} placeholder="http://homeassistant.local:8123/api/webhook/vibemind" className="w-full bg-background border border-border rounded-lg p-2 text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all" />
                  </div>
                </section>

                <section className="space-y-4">
                  <h3 className="text-lg font-semibold text-foreground">{t('settings.export')}</h3>
                  <div className="bg-card p-4 rounded-lg border border-border/50 flex justify-between items-center">
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
                    <button onClick={addProvider} className="flex items-center px-3 py-1.5 bg-secondary text-foreground hover:bg-secondary/80 rounded-lg border border-border/50 hover:border-primary transition-all">
                      <Plus size={16} className="mr-2" /> Add Provider
                    </button>
                  </div>

                  {providers.map(provider => (
                    <div key={provider.id} className={`bg-card p-5 rounded-lg border ${provider.isActive ? 'border-primary' : 'border-border/50'} relative transition-all`}>
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
                        <div className="grid grid-cols-3 gap-4">
                          <div>
                            <label className="block text-sm text-muted-foreground mb-1">Provider Type</label>
                            <select 
                              value={provider.provider} 
                              onChange={(e) => updateProvider(provider.id, 'provider', e.target.value)} 
                              className="w-full bg-background border border-border rounded-lg p-2 text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
                            >
                              <option value="openai">OpenAI / Compatible</option>
                              <option value="gemini">Google Gemini</option>
                              <option value="openrouter">OpenRouter</option>
                              <option value="ollama">Ollama (Local)</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-sm text-muted-foreground mb-1">Label</label>
                            <input type="text" value={provider.label} onChange={(e) => updateProvider(provider.id, 'label', e.target.value)} placeholder="e.g., DeepSeek, Groq, Local" className="w-full bg-background border border-border rounded-lg p-2 text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all" />
                          </div>
                          <div>
                            <label className="block text-sm text-muted-foreground mb-1">Model Name</label>
                            <input type="text" value={provider.modelName} onChange={(e) => updateProvider(provider.id, 'modelName', e.target.value)} placeholder="e.g., gpt-4o-mini" className="w-full bg-background border border-border rounded-lg p-2 text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all" />
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="block text-sm text-muted-foreground mb-1">Base URL (OpenAI/Ollama only)</label>
                            <input 
                              type="text" 
                              value={provider.baseUrl} 
                              onChange={(e) => updateProvider(provider.id, 'baseUrl', e.target.value)} 
                              placeholder="https://api.openai.com/v1" 
                              disabled={provider.provider === 'gemini'}
                              className="w-full bg-background border border-border rounded-lg p-2 text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all disabled:opacity-50" 
                            />
                          </div>
                          <div>
                            <label className="block text-sm text-muted-foreground mb-1">API Key (Encrypted in DB)</label>
                            <input type="password" value={provider.apiKey} onChange={(e) => updateProvider(provider.id, 'apiKey', e.target.value)} placeholder="sk-..." className="w-full bg-background border border-border rounded-lg p-2 text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all" />
                          </div>
                        </div>
                        <div className="flex items-center justify-between mt-2">
                          <div className="flex items-center space-x-2">
                            <span className="text-xs text-muted-foreground">Status:</span>
                            {provider.status === 'connected' && <span className="flex items-center text-accent text-xs"><CheckCircle size={14} className="mr-1" /> Connected</span>}
                            {provider.status === 'error' && <span className="flex items-center text-destructive text-xs"><AlertCircle size={14} className="mr-1" /> Error</span>}
                            {provider.status === 'idle' && <span className="text-muted-foreground text-xs">Not Tested</span>}
                          </div>
                          <button 
                            onClick={() => handleTestProvider(provider)}
                            disabled={testingProviderId === provider.id}
                            className="px-4 py-2 bg-secondary text-foreground hover:bg-secondary/80 rounded-lg border border-border/50 hover:border-primary transition-all disabled:opacity-50"
                          >
                            {testingProviderId === provider.id ? 'Testing...' : 'Test Connection'}
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </section>

                <section className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-lg font-semibold text-foreground">External Databases</h3>
                      <p className="text-xs text-muted-foreground mt-1">
                        Your system database is managed automatically. Add external DBs here to index them for AI RAG analysis.
                      </p>
                    </div>
                    <button 
                      onClick={() => setIsAddDBOpen(true)}
                      className="flex items-center px-3 py-1.5 bg-secondary text-foreground hover:bg-secondary/80 rounded-lg border border-border/50 hover:border-primary transition-all"
                    >
                      <Plus size={16} className="mr-2" /> Add DB
                    </button>
                  </div>
                  
                  <div className="space-y-3">
                    {externalDbs.length > 0 ? (
                      externalDbs.map((db, idx) => (
                        <div key={idx} className="bg-card p-4 rounded-lg border border-border/50 flex items-center justify-between">
                          <div className="flex items-center space-x-3">
                            <div className="p-2 bg-primary/10 rounded-lg">
                              <Database className="text-primary w-5 h-5" />
                            </div>
                            <div>
                              <div className="text-foreground font-medium">{db.name}</div>
                              <div className="text-xs text-muted-foreground font-mono">{db.type.toUpperCase()} // {db.connection_string.split('@')[1] || 'Local'}</div>
                            </div>
                          </div>
                          <button 
                            onClick={() => setExternalDbs(externalDbs.filter((_, i) => i !== idx))}
                            className="p-2 text-muted-foreground hover:text-destructive transition-colors"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      ))
                    ) : (
                      <div className="bg-card p-6 rounded-lg border border-border/50 text-center text-muted-foreground">
                        <Database size={32} className="mx-auto mb-2 opacity-50" />
                        <p>No external databases connected.</p>
                      </div>
                    )}
                  </div>
                </section>
              </div>
            )}

            {activeTab === 'bots' && (
              <div className="space-y-6">
                <h3 className="text-lg font-semibold text-foreground">Telegram Bot Configuration</h3>
                <div className="bg-card p-6 rounded-lg border border-border/50 space-y-6">
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
                    <button onClick={handleTestBot} disabled={isTesting} className="px-4 py-2 bg-secondary text-foreground hover:bg-secondary/80 rounded-lg border border-border/50 hover:border-primary transition-all disabled:opacity-50">
                      {isTesting ? 'Testing...' : 'Test Connection'}
                    </button>
                  </div>
                </div>

                <section className="space-y-4">
                  <h3 className="text-lg font-semibold text-foreground">{t('settings.proxy')}</h3>
                  <div className="bg-card p-6 rounded-lg border border-border/50 space-y-6">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-mono uppercase tracking-wider text-muted-foreground mb-2">Protocol</label>
                        <select 
                          value={proxyConfig.protocol} 
                          onChange={(e) => setProxyConfig({...proxyConfig, protocol: e.target.value})} 
                          className="w-full bg-background border border-border rounded-lg p-2.5 text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
                        >
                          <option value="HTTP">HTTP</option>
                          <option value="SOCKS4">SOCKS4</option>
                          <option value="SOCKS5">SOCKS5</option>
                        </select>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div className="col-span-2">
                          <label className="block text-xs font-mono uppercase tracking-wider text-muted-foreground mb-2">Host</label>
                          <input 
                            type="text" 
                            placeholder="127.0.0.1" 
                            value={proxyConfig.host}
                            onChange={(e) => setProxyConfig({...proxyConfig, host: e.target.value})}
                            className="w-full bg-background border border-border rounded-lg p-2 text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all" 
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-mono uppercase tracking-wider text-muted-foreground mb-2">Port</label>
                          <input 
                            type="text" 
                            placeholder="8080" 
                            value={proxyConfig.port}
                            onChange={(e) => setProxyConfig({...proxyConfig, port: e.target.value})}
                            className="w-full bg-background border border-border rounded-lg p-2 text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all" 
                          />
                        </div>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-mono uppercase tracking-wider text-muted-foreground mb-2">Username (Optional)</label>
                        <div className="relative">
                          <User className="absolute left-3 top-2.5 w-4 h-4 text-muted-foreground" />
                          <input 
                            type="text" 
                            placeholder="user" 
                            value={proxyConfig.username}
                            onChange={(e) => setProxyConfig({...proxyConfig, username: e.target.value})}
                            className="w-full bg-background border border-border rounded-lg p-2 pl-10 text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all" 
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-mono uppercase tracking-wider text-muted-foreground mb-2">Password (Optional)</label>
                        <div className="relative">
                          <Lock className="absolute left-3 top-2.5 w-4 h-4 text-muted-foreground" />
                          <input 
                            type="password" 
                            placeholder="••••" 
                            value={proxyConfig.password}
                            onChange={(e) => setProxyConfig({...proxyConfig, password: e.target.value})}
                            className="w-full bg-background border border-border rounded-lg p-2 pl-10 text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all" 
                          />
                        </div>
                      </div>
                    </div>
                    <div className="mt-4 flex justify-end">
                      <button 
                        onClick={handleTestProxy}
                        className="px-4 py-2 bg-secondary text-secondary-foreground rounded-lg hover:bg-secondary/80 transition-colors"
                      >
                        Test Proxy Connection
                      </button>
                    </div>
                  </div>
                </section>
              </div>
            )}

            {activeTab === 'users' && (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-foreground">User Management</h3>
                  <button onClick={() => { setEditingUser(null); setIsCreateUserOpen(true); }} className="flex items-center px-3 py-1.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors">
                    <Plus size={16} className="mr-2" /> Add User
                  </button>
                </div>

                <div className="bg-card rounded-lg border border-border/50 overflow-hidden">
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
                  {/* Logout button removed as requested by reverting design */}
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

      <AddDBModal
        isOpen={isAddDBOpen}
        onClose={() => setIsAddDBOpen(false)}
        onConnect={handleAddExternalDB}
      />
    </div>
  );
}
