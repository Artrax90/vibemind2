import React, { useState, useEffect } from 'react';
import { X, Globe, Shield, User, Download, Upload, Cpu, Webhook, MessageSquare, Plus, Save, Trash2, CheckCircle, AlertCircle, Database, Edit2, Server, Lock, Key, Sun, Moon } from 'lucide-react';
import CreateUserModal from './modals/CreateUserModal';
import AddDBModal from './modals/AddDBModal';
import { api } from '../api/client';
import { useLanguage } from '../contexts/LanguageContext';
import { updateSettings, getBotStatus, getSettings } from '../api/settings';

type SettingsProps = {
  onClose: () => void;
  theme: 'dark' | 'light';
  setTheme: (theme: 'dark' | 'light') => void;
};

export default function Settings({ onClose, theme, setTheme }: SettingsProps) {
  const { language, setLanguage, t } = useLanguage();
  const [activeTab, setActiveTab] = useState<'general' | 'integrations' | 'bots' | 'users' | 'profile'>('general');
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [newPassword, setNewPassword] = useState('');
  
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
    { id: 'openai', label: 'OpenAI', provider: 'openai', apiKey: '', baseUrl: 'https://api.openai.com/v1', modelName: 'gpt-4o-mini', isActive: true, status: 'idle' },
    { id: 'gemini', label: 'Google Gemini', provider: 'gemini', apiKey: '', baseUrl: '', modelName: 'gemini-1.5-flash', isActive: false, status: 'idle' },
    { id: 'openrouter', label: 'OpenRouter', provider: 'openrouter', apiKey: '', baseUrl: 'https://openrouter.ai/api/v1', modelName: 'google/gemini-2.0-flash-001', isActive: false, status: 'idle' },
    { id: 'ollama', label: 'Ollama', provider: 'ollama', apiKey: '', baseUrl: 'http://localhost:11434/v1', modelName: 'llama3', isActive: false, status: 'idle' }
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
  const [isReindexing, setIsReindexing] = useState(false);
  const [users, setUsers] = useState<any[]>([]);
  const [isCreateUserOpen, setIsCreateUserOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<any | null>(null);

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const me = await api.getMe();
        setCurrentUser(me);
        
        const config = await getSettings();
        if (config) {
          if (config.tg_token) setBotToken(config.tg_token);
          if (config.tg_admin_id) setAdminId(config.tg_admin_id);
          if (config.proxy_config) setProxyConfig(config.proxy_config);
          
          if (config.llm_provider) {
            setProviders(prev => prev.map(p => {
              if (p.provider === config.llm_provider) {
                return { 
                  ...p, 
                  isActive: true, 
                  apiKey: config.api_key || '', 
                  baseUrl: config.base_url || p.baseUrl,
                  modelName: config.model_name || p.modelName,
                  status: 'connected'
                };
              }
              return { ...p, isActive: false };
            }));
          }
        }
      } catch (e) {
        console.error('Failed to load settings', e);
      }
    };
    
    loadSettings();
  }, []);

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
      alert(t('settings.saved'));
    } catch (e) {
      console.error(e);
      alert(t('settings.saveFailed'));
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
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('access_token')}`
        },
        body: JSON.stringify({ tg_token: botToken, proxy_config: proxyConfig })
      });

      const data = await response.json();
      if (response.ok) {
        setBotStatus('connected');
        alert(data.message || t('settings.connSuccess'));
      } else {
        setBotStatus('error');
        alert(`${t('settings.connFailed')}${data.detail || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Network Error:', error);
      setBotStatus('error');
      alert(t('settings.apiFailed'));
    } finally {
      setIsTesting(false);
    }
  };

  const handleTestProxy = async () => {
    if (!proxyConfig.host) {
      alert(t('settings.proxyHostReq'));
      return;
    }
    try {
      const response = await fetch('/api/proxy/test', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('access_token')}`
        },
        body: JSON.stringify({ proxy_config: proxyConfig })
      });
      const data = await response.json();
      if (response.ok && data.status === 'success') {
        alert(t('settings.proxySuccess'));
      } else {
        alert(`${t('settings.proxyFailed')}${data.detail || 'Unknown error'}`);
      }
    } catch (e) {
      alert(t('settings.proxyReqFailed'));
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
        alert(t('settings.dbSuccess'));
      } else {
        alert(t('settings.dbFailed'));
      }
    } catch (e) {
      console.error(e);
      alert(t('settings.dbError'));
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
        alert(t('settings.connSuccess'));
      } else {
        setProviders(providers.map(p => p.id === provider.id ? { ...p, status: 'error' } : p));
        alert(`${t('settings.connFailed')}${data.detail || data.message || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Test Provider Error:', error);
      setProviders(providers.map(p => p.id === provider.id ? { ...p, status: 'error' } : p));
      alert(t('settings.connFailed'));
    } finally {
      setTestingProviderId(null);
    }
  };

  const handleCreateUser = async (user: any) => {
    try {
      if (editingUser) {
        const updatedUser = await api.updateUser(editingUser.id, user);
        setUsers(users.map(u => u.id === editingUser.id ? { ...u, ...updatedUser } : u));
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
            <Save size={16} className={`mr-2 ${isSaving ? 'animate-spin' : ''}`} /> {isSaving ? t('settings.saving') : t('settings.save')}
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
          <button onClick={() => setActiveTab('profile')} className={`w-full flex items-center px-4 py-3 rounded-lg transition-colors ${activeTab === 'profile' ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'}`}>
            <User size={18} className="mr-3" /> {t('settings.profile') || 'Profile'}
          </button>
          {currentUser?.role === 'admin' && (
            <button onClick={() => setActiveTab('users')} className={`w-full flex items-center px-4 py-3 rounded-lg transition-colors ${activeTab === 'users' ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'}`}>
              <Shield size={18} className="mr-3" /> {t('settings.users')}
            </button>
          )}
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto p-8 scrollbar-thin">
          <div className="max-w-3xl mx-auto space-y-8">
            
            {activeTab === 'general' && (
              <>
                <section className="space-y-4">
                  <h3 className="text-lg font-semibold text-foreground">{t('settings.systemStatus')}</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="bg-card p-4 rounded-lg border border-border/50 flex items-center justify-between">
                      <div className="flex items-center">
                        <Cpu size={18} className="mr-3 text-primary" />
                        <div>
                          <div className="text-xs text-muted-foreground">{t('settings.aiAssistant')}</div>
                          <div className="text-sm font-medium text-foreground">
                            {providers.find(p => p.isActive)?.status === 'connected' ? t('settings.connected') : t('settings.notConfigured')}
                          </div>
                        </div>
                      </div>
                      {providers.find(p => p.isActive)?.status === 'connected' ? (
                        <CheckCircle size={16} className="text-accent" />
                      ) : (
                        <AlertCircle size={16} className="text-muted-foreground" />
                      )}
                    </div>

                    <div className="bg-card p-4 rounded-lg border border-border/50 flex items-center justify-between">
                      <div className="flex items-center">
                        <MessageSquare size={18} className="mr-3 text-primary" />
                        <div>
                          <div className="text-xs text-muted-foreground">{t('settings.telegramBot')}</div>
                          <div className="text-sm font-medium text-foreground">
                            {botStatus === 'connected' ? t('settings.live') : t('settings.offline')}
                          </div>
                        </div>
                      </div>
                      {botStatus === 'connected' ? (
                        <CheckCircle size={16} className="text-accent" />
                      ) : (
                        <AlertCircle size={16} className="text-muted-foreground" />
                      )}
                    </div>

                    <div className="bg-card p-4 rounded-lg border border-border/50 flex items-center justify-between">
                      <div className="flex items-center">
                        <Server size={18} className="mr-3 text-primary" />
                        <div>
                          <div className="text-xs text-muted-foreground">{t('settings.proxyStatus')}</div>
                          <div className="text-sm font-medium text-foreground">
                            {proxyConfig.host ? t('settings.configured') : t('settings.direct')}
                          </div>
                        </div>
                      </div>
                      {proxyConfig.host ? (
                        <CheckCircle size={16} className="text-accent" />
                      ) : (
                        <div className="w-4 h-4 rounded-full border border-border/50" />
                      )}
                    </div>
                  </div>
                </section>

                <section className="space-y-4">
                  <h3 className="text-lg font-semibold text-foreground">{t('settings.language')}</h3>
                  <div className="flex items-center space-x-4 bg-card p-4 rounded-lg border border-border/50">
                    <button onClick={() => setLanguage('EN')} className={`px-4 py-2 rounded-lg transition-colors ${language === 'EN' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'}`}>English</button>
                    <button onClick={() => setLanguage('RU')} className={`px-4 py-2 rounded-lg transition-colors ${language === 'RU' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'}`}>Русский</button>
                  </div>
                </section>

                <section className="space-y-4">
                  <h3 className="text-lg font-semibold text-foreground">{t('settings.theme')}</h3>
                  <div className="flex items-center space-x-4 bg-card p-4 rounded-lg border border-border/50">
                    <button 
                      onClick={() => setTheme('light')} 
                      className={`flex items-center px-4 py-2 rounded-lg transition-colors ${theme === 'light' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'}`}
                    >
                      <Sun size={16} className="mr-2" /> {t('settings.light')}
                    </button>
                    <button 
                      onClick={() => setTheme('dark')} 
                      className={`flex items-center px-4 py-2 rounded-lg transition-colors ${theme === 'dark' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'}`}
                    >
                      <Moon size={16} className="mr-2" /> {t('settings.dark')}
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
                  <h3 className="text-lg font-semibold text-foreground">{t('settings.dataManagement')}</h3>
                  <div className="bg-card p-4 rounded-lg border border-border/50 flex justify-between items-center">
                    <div>
                      <div className="text-foreground font-medium">{t('settings.reindexSearch')}</div>
                      <div className="text-sm text-muted-foreground">{t('settings.reindexDesc')}</div>
                    </div>
                    <button 
                      onClick={async () => {
                        setIsReindexing(true);
                        try {
                          const res = await fetch('/api/notes/reindex', {
                            method: 'POST',
                            headers: { 
                              'Authorization': `Bearer ${localStorage.getItem('access_token')}`,
                              'Content-Type': 'application/json'
                            }
                          });
                          const data = await res.json();
                          if (res.ok) {
                            alert(data.message || t('settings.reindexSuccess'));
                          } else {
                            alert(`Error: ${data.detail || t('settings.reindexFailed')}`);
                          }
                        } catch (e) {
                          console.error(e);
                          alert(t('settings.reindexFailed'));
                        } finally {
                          setIsReindexing(false);
                        }
                      }}
                      disabled={isReindexing}
                      className="px-4 py-2 bg-primary/10 text-primary hover:bg-primary/20 rounded-lg transition-colors flex items-center disabled:opacity-50"
                    >
                      <Database size={16} className={`mr-2 ${isReindexing ? 'animate-spin' : ''}`} /> {isReindexing ? t('settings.reindexing') : t('settings.reindex')}
                    </button>
                  </div>
                </section>

                <section className="space-y-4">
                  <h3 className="text-lg font-semibold text-foreground">{t('settings.export')}</h3>
                  <div className="bg-card p-4 rounded-lg border border-border/50 flex justify-between items-center">
                    <div>
                      <div className="text-foreground font-medium">{t('settings.markdownExport')}</div>
                      <div className="text-sm text-muted-foreground">{t('settings.exportDesc')}</div>
                    </div>
                    <button 
                      onClick={async () => {
                        try {
                          const res = await fetch('/api/notes/export', {
                            headers: { 'Authorization': `Bearer ${localStorage.getItem('access_token')}` }
                          });
                          if (res.ok) {
                            const blob = await res.blob();
                            const url = window.URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = `notes_export_${new Date().toISOString().slice(0,10)}.zip`;
                            a.style.display = 'none';
                            document.body.appendChild(a);
                            a.click();
                            setTimeout(() => {
                              window.URL.revokeObjectURL(url);
                              document.body.removeChild(a);
                            }, 1000);
                          } else {
                            alert(t('settings.exportFailed'));
                          }
                        } catch (e) {
                          console.error(e);
                          alert(t('settings.exportError'));
                        }
                      }}
                      className="px-4 py-2 bg-primary/10 text-primary hover:bg-primary/20 rounded-lg transition-colors flex items-center"
                    >
                      <Download size={16} className="mr-2" /> {t('settings.exportZip')}
                    </button>
                  </div>
                  
                  <div className="flex items-center justify-between p-4 bg-card rounded-lg border border-border/50">
                    <div>
                      <div className="text-foreground font-medium">{t('settings.importNotes')}</div>
                      <div className="text-sm text-muted-foreground">{t('settings.importDesc')}</div>
                    </div>
                    <label className="px-4 py-2 bg-secondary text-foreground hover:bg-secondary/80 rounded-lg border border-border/50 hover:border-primary transition-all flex items-center cursor-pointer">
                      <Upload size={16} className="mr-2" /> {t('settings.importZip')}
                      <input 
                        type="file" 
                        accept=".zip" 
                        className="hidden" 
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          
                          const formData = new FormData();
                          formData.append('file', file);
                          
                          const res = await api.importNotes(formData);
                          if (res.count > 0) {
                            alert(`${t('settings.importSuccess')} (${res.count})`);
                            // Optionally trigger a re-fetch of notes here if needed
                          } else {
                            alert(t('settings.importFailed'));
                          }
                          
                          // Reset input
                          e.target.value = '';
                        }}
                      />
                    </label>
                  </div>
                </section>
              </>
            )}

            {activeTab === 'integrations' && (
              <div className="space-y-8">
                <section className="space-y-6">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-foreground">{t('settings.llmProviders')}</h3>
                    <button onClick={addProvider} className="flex items-center px-3 py-1.5 bg-secondary text-foreground hover:bg-secondary/80 rounded-lg border border-border/50 hover:border-primary transition-all">
                      <Plus size={16} className="mr-2" /> {t('settings.addProvider')}
                    </button>
                  </div>

                  {providers.map(provider => (
                    <div key={provider.id} className={`bg-card p-5 rounded-lg border ${provider.isActive ? 'border-primary' : 'border-border/50'} relative transition-all`}>
                      <div className="absolute top-4 right-4 flex items-center space-x-4">
                        <label className="flex items-center space-x-2 cursor-pointer text-sm text-muted-foreground">
                          <input type="radio" checked={provider.isActive} onChange={() => updateProvider(provider.id, 'isActive', true)} className="form-radio text-primary bg-background border-border" />
                          <span>{t('settings.active')}</span>
                        </label>
                        <button onClick={() => removeProvider(provider.id)} className="text-muted-foreground hover:text-destructive transition-colors">
                          <Trash2 size={16} />
                        </button>
                      </div>

                      <div className="space-y-4 mt-2">
                        <div className="grid grid-cols-3 gap-4">
                          <div>
                            <label className="block text-sm text-muted-foreground mb-1">{t('settings.providerType')}</label>
                            <select 
                              value={provider.provider} 
                              onChange={(e) => updateProvider(provider.id, 'provider', e.target.value)} 
                              className="w-full bg-background border border-border rounded-lg p-2 text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
                            >
                              <option value="openai">{t('settings.optOpenAI')}</option>
                              <option value="gemini">{t('settings.optGemini')}</option>
                              <option value="openrouter">{t('settings.optOpenRouter')}</option>
                              <option value="ollama">{t('settings.optOllama')}</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-sm text-muted-foreground mb-1">{t('settings.label')}</label>
                            <input type="text" value={provider.label} onChange={(e) => updateProvider(provider.id, 'label', e.target.value)} placeholder={t('settings.phDeepSeek')} className="w-full bg-background border border-border rounded-lg p-2 text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all" />
                          </div>
                          <div>
                            <label className="block text-sm text-muted-foreground mb-1">{t('settings.modelName')}</label>
                            <input type="text" value={provider.modelName} onChange={(e) => updateProvider(provider.id, 'modelName', e.target.value)} placeholder={t('settings.phModel')} className="w-full bg-background border border-border rounded-lg p-2 text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all" />
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="block text-sm text-muted-foreground mb-1">{t('settings.baseUrl')}</label>
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
                            <label className="block text-sm text-muted-foreground mb-1">{t('settings.apiKey')}</label>
                            <input type="password" value={provider.apiKey} onChange={(e) => updateProvider(provider.id, 'apiKey', e.target.value)} placeholder="sk-..." className="w-full bg-background border border-border rounded-lg p-2 text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all" />
                          </div>
                        </div>
                        <div className="flex items-center justify-between mt-2">
                          <div className="flex items-center space-x-2">
                            <span className="text-xs text-muted-foreground">{t('settings.status')}</span>
                            {provider.status === 'connected' && <span className="flex items-center text-accent text-xs"><CheckCircle size={14} className="mr-1" /> {t('settings.connected')}</span>}
                            {provider.status === 'error' && <span className="flex items-center text-destructive text-xs"><AlertCircle size={14} className="mr-1" /> {t('settings.error')}</span>}
                            {provider.status === 'idle' && <span className="text-muted-foreground text-xs">{t('settings.notTested')}</span>}
                          </div>
                          <button 
                            onClick={() => handleTestProvider(provider)}
                            disabled={testingProviderId === provider.id}
                            className="px-4 py-2 bg-secondary text-foreground hover:bg-secondary/80 rounded-lg border border-border/50 hover:border-primary transition-all disabled:opacity-50"
                          >
                            {testingProviderId === provider.id ? t('settings.testing') : t('settings.testConnection')}
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </section>

                <section className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-lg font-semibold text-foreground">{t('settings.externalDatabases')}</h3>
                      <p className="text-xs text-muted-foreground mt-1">
                        {t('settings.externalDbDesc')}
                      </p>
                    </div>
                    <button 
                      onClick={() => setIsAddDBOpen(true)}
                      className="flex items-center px-3 py-1.5 bg-secondary text-foreground hover:bg-secondary/80 rounded-lg border border-border/50 hover:border-primary transition-all"
                    >
                      <Plus size={16} className="mr-2" /> {t('settings.addDb')}
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
                        <p>{t('settings.noExternalDbs')}</p>
                      </div>
                    )}
                  </div>
                </section>
              </div>
            )}

            {activeTab === 'bots' && (
              <div className="space-y-6">
                <h3 className="text-lg font-semibold text-foreground">{t('settings.botConfig')}</h3>
                <div className="bg-card p-6 rounded-lg border border-border/50 space-y-6">
                  <div>
                    <label className="block text-sm text-muted-foreground mb-1">{t('settings.botToken')}</label>
                    <input type="password" value={botToken} onChange={(e) => setBotToken(e.target.value)} placeholder="123456789:ABCdefGHIjklMNOpqrSTUvwxYZ" className="w-full bg-background border border-border rounded-lg p-2 text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all" />
                  </div>
                  <div>
                    <label className="block text-sm text-muted-foreground mb-1">{t('settings.adminId')}</label>
                    <input type="text" value={adminId} onChange={(e) => setAdminId(e.target.value)} placeholder={t('settings.phAdminId')} className="w-full bg-background border border-border rounded-lg p-2 text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all" />
                    <p className="text-xs text-muted-foreground mt-1">{t('settings.adminIdDesc')}</p>
                  </div>
                  
                  <div className="pt-4 border-t border-border/50 flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <span className="text-sm text-muted-foreground">{t('settings.status')}</span>
                      {botStatus === 'connected' && <span className="flex items-center text-accent text-sm"><CheckCircle size={16} className="mr-1" /> {t('settings.live')}</span>}
                      {botStatus === 'error' && <span className="flex items-center text-destructive text-sm"><AlertCircle size={16} className="mr-1" /> {t('settings.error')}</span>}
                      {botStatus === 'disconnected' && <span className="text-muted-foreground text-sm">{t('settings.disconnected')}</span>}
                    </div>
                    <button onClick={handleTestBot} disabled={isTesting} className="px-4 py-2 bg-secondary text-foreground hover:bg-secondary/80 rounded-lg border border-border/50 hover:border-primary transition-all disabled:opacity-50">
                      {isTesting ? t('settings.testing') : t('settings.testConnection')}
                    </button>
                  </div>
                </div>

                <section className="space-y-4">
                  <h3 className="text-lg font-semibold text-foreground">{t('settings.proxy')}</h3>
                  <div className="bg-card p-6 rounded-lg border border-border/50 space-y-6">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-mono uppercase tracking-wider text-muted-foreground mb-2">{t('settings.protocol')}</label>
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
                          <label className="block text-xs font-mono uppercase tracking-wider text-muted-foreground mb-2">{t('settings.host')}</label>
                          <input 
                            type="text" 
                            placeholder="127.0.0.1" 
                            value={proxyConfig.host}
                            onChange={(e) => setProxyConfig({...proxyConfig, host: e.target.value})}
                            className="w-full bg-background border border-border rounded-lg p-2 text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all" 
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-mono uppercase tracking-wider text-muted-foreground mb-2">{t('settings.port')}</label>
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
                        <label className="block text-xs font-mono uppercase tracking-wider text-muted-foreground mb-2">{t('settings.usernameOptional')}</label>
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
                        <label className="block text-xs font-mono uppercase tracking-wider text-muted-foreground mb-2">{t('settings.passwordOptional')}</label>
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
                        {t('settings.testProxy')}
                      </button>
                    </div>
                  </div>
                </section>
              </div>
            )}

            {activeTab === 'profile' && (
              <div className="space-y-6">
                <h3 className="text-lg font-semibold text-foreground">{t('settings.profile') || 'Profile'}</h3>
                <div className="bg-card p-6 rounded-lg border border-border/50 space-y-4">
                  <div>
                    <label className="block text-sm text-muted-foreground mb-1">{t('settings.username') || 'Username'}</label>
                    <input type="text" value={currentUser?.username || ''} disabled className="w-full bg-secondary/50 border border-border rounded-lg p-2 text-muted-foreground outline-none cursor-not-allowed" />
                  </div>
                  <div>
                    <label className="block text-sm text-muted-foreground mb-1">{t('settings.newPassword') || 'New Password'}</label>
                    <div className="relative">
                      <Key className="absolute left-3 top-2.5 w-4 h-4 text-muted-foreground" />
                      <input 
                        type="password" 
                        placeholder="••••••••" 
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        className="w-full bg-background border border-border rounded-lg p-2 pl-10 text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all" 
                      />
                    </div>
                  </div>
                  <div className="pt-4 flex justify-end">
                    <button 
                      onClick={async () => {
                        if (!newPassword) return;
                        try {
                          await api.updateUser(currentUser.id, { password: newPassword });
                          alert(t('settings.passwordUpdated') || 'Password updated successfully');
                          setNewPassword('');
                        } catch (e) {
                          console.error(e);
                          alert(t('settings.passwordUpdateFailed') || 'Failed to update password');
                        }
                      }}
                      className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
                    >
                      {t('settings.updatePassword') || 'Update Password'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'users' && (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-foreground">{t('settings.userManagement')}</h3>
                  <button onClick={() => { setEditingUser(null); setIsCreateUserOpen(true); }} className="flex items-center px-3 py-1.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors">
                    <Plus size={16} className="mr-2" /> {t('settings.addUser')}
                  </button>
                </div>

                <div className="bg-card rounded-lg border border-border/50 overflow-hidden">
                  <table className="w-full text-left text-sm text-muted-foreground">
                    <thead className="bg-secondary/50 text-foreground uppercase text-xs">
                      <tr>
                        <th className="px-6 py-3">{t('settings.username')}</th>
                        <th className="px-6 py-3">{t('settings.email')}</th>
                        <th className="px-6 py-3">{t('settings.status')}</th>
                        <th className="px-6 py-3">{t('settings.action')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.length === 0 ? (
                        <tr className="border-t border-border/50">
                          <td colSpan={4} className="px-6 py-4 text-center text-muted-foreground">{t('settings.noUsers')}</td>
                        </tr>
                      ) : (
                        users.map((u, i) => (
                          <tr key={i} className="border-t border-border/50 hover:bg-secondary/50 transition-colors">
                            <td className="px-6 py-4 font-medium text-foreground">{u.username}</td>
                            <td className="px-6 py-4">{u.email}</td>
                            <td className="px-6 py-4"><span className="px-2 py-1 bg-accent/10 text-accent rounded text-xs">{t('settings.active')}</span></td>
                            <td className="px-6 py-4 flex space-x-3">
                              <button 
                                onClick={() => { setEditingUser(u); setIsCreateUserOpen(true); }}
                                className="text-primary hover:text-primary/80 transition-colors"
                              >
                                <Edit2 size={16} />
                              </button>
                              <button 
                                onClick={async () => {
                                  try {
                                    await api.deleteUser(u.id);
                                    setUsers(users.filter(user => user.id !== u.id));
                                  } catch (e) {
                                    console.error('Failed to delete user', e);
                                  }
                                }}
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
