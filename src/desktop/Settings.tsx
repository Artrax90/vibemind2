import React, { useState, useEffect } from 'react';
import { X, Globe, Save, RefreshCw, Sun, Moon, CheckCircle, AlertCircle, Download, Upload, Cpu, MessageSquare, Plus, Trash2, Terminal } from 'lucide-react';
import { api } from './client';
import { useLanguage } from '../contexts/LanguageContext';
import { useSync } from '../contexts/SyncContext';

import JSZip from 'jszip';

type SettingsProps = {
  onClose: () => void;
  theme: 'dark' | 'light';
  setTheme: (theme: 'dark' | 'light') => void;
};

export default function Settings({ onClose, theme, setTheme }: SettingsProps) {
  const { language, setLanguage, t } = useLanguage();
  const { status, lastSync } = useSync();
  const [activeTab, setActiveTab] = useState<'sync' | 'general' | 'integrations' | 'bots' | 'logs'>('sync');
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [syncConfig, setSyncConfig] = useState({ server_url: '', username: '', password: '' });

  // AI & Proxy State
  const [botToken, setBotToken] = useState('');
  const [adminId, setAdminId] = useState('');
  const [botStatus, setBotStatus] = useState<any>({ status: 'disconnected' });
  const [proxyConfig, setProxyConfig] = useState({ protocol: 'HTTP', host: '', port: '', username: '', password: '' });
  const [providers, setProviders] = useState([
    { id: 'openai', label: 'OpenAI', provider: 'openai', apiKey: '', baseUrl: 'https://api.openai.com/v1', modelName: 'gpt-4o-mini', isActive: true, status: 'idle' },
    { id: 'gemini', label: 'Google Gemini', provider: 'gemini', apiKey: '', baseUrl: '', modelName: 'gemini-1.5-flash', isActive: false, status: 'idle' },
    { id: 'openrouter', label: 'OpenRouter', provider: 'openrouter', apiKey: '', baseUrl: 'https://openrouter.ai/api/v1', modelName: 'google/gemini-2.0-flash-001', isActive: false, status: 'idle' },
    { id: 'ollama', label: 'Ollama', provider: 'ollama', apiKey: '', baseUrl: 'http://localhost:11434/v1', modelName: 'llama3', isActive: false, status: 'idle' }
  ]);
  const [testingProviderId, setTestingProviderId] = useState<string | null>(null);

  const handleExport = async () => {
    try {
      const notes = await api.getNotes();
      const zip = new JSZip();
      
      notes.forEach((note: any) => {
        const safeTitle = note.title.replace(/[/\\?%*:|"<>]/g, '-') || 'untitled';
        zip.file(`${safeTitle}.md`, `# ${note.title}\n\n${note.content || ''}`);
      });
      
      const content = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(content);
      const a = document.createElement('a');
      a.href = url;
      a.download = `vibemind_export_${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Export failed', e);
      alert(t('settings.exportFailed'));
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      if (file.name.endsWith('.zip')) {
        const zip = await JSZip.loadAsync(file);
        for (const [path, zipEntry] of Object.entries(zip.files)) {
          if (!zipEntry.dir && path.endsWith('.md')) {
            const content = await zipEntry.async('string');
            const lines = content.split('\n');
            let title = path.replace('.md', '');
            let body = content;
            
            if (lines[0].startsWith('# ')) {
              title = lines[0].replace('# ', '').trim();
              body = lines.slice(1).join('\n').trim();
            }
            
            await api.createNote({
              id: `n${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
              title,
              content: body,
              is_dirty: 1
            });
          }
        }
      } else if (file.name.endsWith('.md')) {
        const content = await file.text();
        const lines = content.split('\n');
        let title = file.name.replace('.md', '');
        let body = content;
        
        if (lines[0].startsWith('# ')) {
          title = lines[0].replace('# ', '').trim();
          body = lines.slice(1).join('\n').trim();
        }
        
        await api.createNote({
          id: `n${Date.now()}`,
          title,
          content: body,
          is_dirty: 1
        });
      }
      
      alert(t('settings.importSuccess'));
      window.location.reload();
    } catch (err) {
      console.error('Import failed', err);
      alert(t('settings.importFailed'));
    }
  };

  useEffect(() => {
    api.getSettings().then((config: any) => {
      setSyncConfig({
        server_url: config.server_url || '',
        username: config.username || '',
        password: config.password || ''
      });
    });

    // Load remote settings if possible
    api.getRemoteSettings().then(config => {
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
    });
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await api.updateSettings(syncConfig);
      
      // Also try to save remote settings if connected
      await api.updateRemoteSettings({
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
      alert(t('settings.saveFailed'));
    } finally {
      setIsSaving(false);
    }
  };

  const updateProvider = (id: string, field: string, value: any) => {
    setProviders(providers.map(p => {
      if (p.id === id) {
        let updated = { ...p, [field]: value };
        if (field === 'provider') {
          if (value === 'openai') { updated.baseUrl = 'https://api.openai.com/v1'; updated.modelName = 'gpt-4o-mini'; }
          else if (value === 'gemini') { updated.baseUrl = ''; updated.modelName = 'gemini-1.5-flash'; }
          else if (value === 'openrouter') { updated.baseUrl = 'https://openrouter.ai/api/v1'; updated.modelName = 'google/gemini-2.0-flash-001'; }
          else if (value === 'ollama') { updated.baseUrl = 'http://localhost:11434/v1'; updated.modelName = 'llama3'; }
        }
        return updated;
      }
      if (field === 'isActive' && value === true) return { ...p, isActive: false };
      return p;
    }));
  };

  const handleTestProvider = async (provider: any) => {
    setTestingProviderId(provider.id);
    try {
      const config = await (window as any).electronAPI.getSyncConfig();
      const token = await api.getServerToken();
      if (!token || !config.server_url) {
        alert('Please connect to a server first.');
        return;
      }

      const response = await fetch(`${config.server_url.replace(/\/$/, '')}/api/integrations/test`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
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
      setProviders(providers.map(p => p.id === provider.id ? { ...p, status: 'error' } : p));
      alert(t('settings.connFailed'));
    } finally {
      setTestingProviderId(null);
    }
  };

  const handleTestBot = async () => {
    if (!botToken) {
      alert('Bot token is required');
      return;
    }
    setIsTesting(true);
    try {
      const config = await (window as any).electronAPI.getSyncConfig();
      const token = await api.getServerToken();
      if (!token || !config.server_url) {
        alert('Please connect to a server first.');
        return;
      }

      const response = await fetch(`${config.server_url.replace(/\/$/, '')}/api/bot/test`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ tg_token: botToken, proxy_config: proxyConfig })
      });

      const data = await response.json();
      if (response.ok) {
        setBotStatus({ status: 'connected' });
        alert(data.message || t('settings.connSuccess'));
      } else {
        setBotStatus({ status: 'error' });
        alert(`${t('settings.connFailed')}${data.detail || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Network Error:', error);
      setBotStatus({ status: 'error' });
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
      const config = await (window as any).electronAPI.getSyncConfig();
      const token = await api.getServerToken();
      if (!token || !config.server_url) {
        alert('Please connect to a server first.');
        return;
      }

      const response = await fetch(`${config.server_url.replace(/\/$/, '')}/api/proxy/test`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
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
        <div className="w-64 border-r border-border/50 p-4 space-y-2">
          <button onClick={() => setActiveTab('sync')} className={`w-full flex items-center px-4 py-3 rounded-lg transition-colors ${activeTab === 'sync' ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'}`}>
            <RefreshCw size={18} className="mr-3" /> {t('settings.sync')}
          </button>
          <button onClick={() => setActiveTab('integrations')} className={`w-full flex items-center px-4 py-3 rounded-lg transition-colors ${activeTab === 'integrations' ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'}`}>
            <Cpu size={18} className="mr-3" /> {t('settings.integrations')}
          </button>
          <button onClick={() => setActiveTab('bots')} className={`w-full flex items-center px-4 py-3 rounded-lg transition-colors ${activeTab === 'bots' ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'}`}>
            <MessageSquare size={18} className="mr-3" /> {t('settings.bots')}
          </button>
          <button onClick={() => setActiveTab('general')} className={`w-full flex items-center px-4 py-3 rounded-lg transition-colors ${activeTab === 'general' ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'}`}>
            <Globe size={18} className="mr-3" /> {t('settings.general')}
          </button>
          <button onClick={() => setActiveTab('logs')} className={`w-full flex items-center px-4 py-3 rounded-lg transition-colors ${activeTab === 'logs' ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'}`}>
            <Terminal size={18} className="mr-3" /> {t('settings.logs') || 'Logs'}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-8">
          <div className="max-w-3xl mx-auto space-y-8">
            {activeTab === 'sync' && (
              <section className="space-y-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-foreground">{t('settings.sync')}</h3>
                  <div className="flex items-center space-x-4">
                    <button 
                      onClick={() => window.dispatchEvent(new CustomEvent('force-sync'))}
                      className="flex items-center px-3 py-1.5 bg-secondary text-foreground hover:bg-secondary/80 rounded-lg border border-border/50 hover:border-primary transition-all text-xs"
                    >
                      <RefreshCw size={14} className="mr-2" /> {t('settings.syncNow') || 'Sync Now'}
                    </button>
                    <div className="flex items-center space-x-2 text-sm">
                      <span className="text-muted-foreground">{t('settings.syncStatus')}:</span>
                      {status === 'syncing' && <span className="flex items-center text-primary animate-pulse"><RefreshCw size={14} className="mr-1 animate-spin" /> {t('settings.syncing')}</span>}
                      {status === 'success' && <span className="flex items-center text-accent"><CheckCircle size={14} className="mr-1" /> {t('settings.syncSuccess')}</span>}
                      {status === 'error' && <span className="flex items-center text-destructive"><AlertCircle size={14} className="mr-1" /> {t('settings.syncError')}</span>}
                      {status === 'idle' && <span className="text-muted-foreground">{t('settings.syncIdle')}</span>}
                    </div>
                  </div>
                </div>

                <div className="bg-card p-6 rounded-lg border border-border/50 space-y-4">
                  <div>
                    <label className="block text-sm text-muted-foreground mb-1">{t('settings.serverUrl')}</label>
                    <input type="text" value={syncConfig.server_url} onChange={(e) => setSyncConfig({ ...syncConfig, server_url: e.target.value })} placeholder="https://your-server.com" className="w-full bg-background border border-border rounded-lg p-2 text-foreground outline-none" />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm text-muted-foreground mb-1">{t('settings.syncLogin')}</label>
                      <input type="text" value={syncConfig.username} onChange={(e) => setSyncConfig({ ...syncConfig, username: e.target.value })} placeholder="Username" className="w-full bg-background border border-border rounded-lg p-2 text-foreground outline-none" />
                    </div>
                    <div>
                      <label className="block text-sm text-muted-foreground mb-1">{t('settings.syncPassword')}</label>
                      <input type="password" value={syncConfig.password} onChange={(e) => setSyncConfig({ ...syncConfig, password: e.target.value })} placeholder="Password" className="w-full bg-background border border-border rounded-lg p-2 text-foreground outline-none" />
                    </div>
                  </div>

                  <div className="pt-4 flex items-center justify-between border-t border-border/50">
                    <div className="flex items-center space-x-2">
                      {testResult === 'success' && <span className="text-xs text-accent flex items-center"><CheckCircle size={12} className="mr-1" /> {t('settings.connSuccess')}</span>}
                      {testResult && testResult.startsWith('error') && (
                        <span className="text-xs text-destructive flex items-center">
                          <AlertCircle size={12} className="mr-1" /> 
                          {testResult.replace('error: ', '') || t('settings.connFailed')}
                        </span>
                      )}
                    </div>
                    <button 
                      onClick={async () => {
                        setIsTesting(true);
                        setTestResult(null);
                        const log = (msg: string) => {
                          const timestamp = new Date().toLocaleTimeString();
                          const formattedMsg = `[${timestamp}] [TestConn] ${msg}`;
                          if (!(window as any).syncLogs) (window as any).syncLogs = [];
                          (window as any).syncLogs.push(formattedMsg);
                        };
                        try {
                          let url = syncConfig.server_url.trim().replace(/\/$/, '');
                          if (url && !url.startsWith('http://') && !url.startsWith('https://')) {
                            url = 'http://' + url;
                          }
                          log(`Testing connection to ${url}...`);
                          const res = await fetch(`${url}/api/auth/login`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ username: syncConfig.username, password: syncConfig.password }),
                          });
                          if (res.ok) {
                            setTestResult('success');
                            log('Connection successful');
                          } else {
                            const data = await res.json().catch(() => ({}));
                            let err = `${res.status} ${data.detail || ''}`;
                            if (res.status === 502) {
                              err += ' (Bad Gateway - check if backend is running or proxy settings)';
                            }
                            setTestResult(`error: ${err}`);
                            log(`Connection failed: ${err}`);
                          }
                        } catch (e: any) {
                          const err = e.message || 'Network Error';
                          setTestResult(`error: ${err}`);
                          log(`Connection error: ${err}`);
                        } finally {
                          setIsTesting(false);
                        }
                      }}
                      disabled={isTesting}
                      className="px-4 py-2 bg-secondary text-foreground rounded-lg border border-border/50 hover:border-primary transition-all disabled:opacity-50 text-sm"
                    >
                      {isTesting ? t('settings.testing') : t('settings.testConnection')}
                    </button>
                  </div>
                </div>
                {lastSync && (
                  <p className="text-xs text-muted-foreground text-center italic">
                    {t('settings.lastSync')}: {lastSync.toLocaleString()}
                  </p>
                )}
              </section>
            )}

            {activeTab === 'integrations' && (
              <section className="space-y-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-foreground">{t('settings.llmProviders')}</h3>
                  <button 
                    onClick={() => setProviders([...providers, { id: Date.now().toString(), label: 'New Provider', provider: 'custom', apiKey: '', baseUrl: 'https://api.example.com/v1', modelName: 'default-model', isActive: false, status: 'idle' }])} 
                    className="flex items-center px-3 py-1.5 bg-secondary text-foreground hover:bg-secondary/80 rounded-lg border border-border/50 hover:border-primary transition-all"
                  >
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
                      <button onClick={() => setProviders(providers.filter(p => p.id !== provider.id))} className="text-muted-foreground hover:text-destructive transition-colors">
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
                          <input type="text" value={provider.label} onChange={(e) => updateProvider(provider.id, 'label', e.target.value)} placeholder="Label" className="w-full bg-background border border-border rounded-lg p-2 text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all" />
                        </div>
                        <div>
                          <label className="block text-sm text-muted-foreground mb-1">{t('settings.modelName')}</label>
                          <input type="text" value={provider.modelName} onChange={(e) => updateProvider(provider.id, 'modelName', e.target.value)} placeholder="Model" className="w-full bg-background border border-border rounded-lg p-2 text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all" />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm text-muted-foreground mb-1">{t('settings.baseUrl')}</label>
                          <input type="text" value={provider.baseUrl} onChange={(e) => updateProvider(provider.id, 'baseUrl', e.target.value)} placeholder="https://api.openai.com/v1" className="w-full bg-background border border-border rounded-lg p-2 text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all" />
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
                          className="px-4 py-2 bg-secondary text-foreground hover:bg-secondary/80 rounded-lg border border-border/50 hover:border-primary transition-all disabled:opacity-50 text-xs"
                        >
                          {testingProviderId === provider.id ? t('settings.testing') : t('settings.testConnection')}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </section>
            )}

            {activeTab === 'bots' && (
              <section className="space-y-8">
                <div className="space-y-6">
                  <h3 className="text-lg font-semibold text-foreground">{t('settings.botConfig')}</h3>
                  
                  <div className="bg-card p-6 rounded-lg border border-border/50 space-y-4">
                    <div>
                      <label className="block text-sm text-muted-foreground mb-1">{t('settings.botToken')}</label>
                      <input type="password" value={botToken} onChange={(e) => setBotToken(e.target.value)} placeholder="123456789:ABCDEF..." className="w-full bg-background border border-border rounded-lg p-2 text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all" />
                    </div>
                    <div>
                      <label className="block text-sm text-muted-foreground mb-1">{t('settings.adminId')}</label>
                      <input type="text" value={adminId} onChange={(e) => setAdminId(e.target.value)} placeholder={t('settings.phAdminId') || '123456789'} className="w-full bg-background border border-border rounded-lg p-2 text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all" />
                      <p className="text-[10px] text-muted-foreground mt-1">{t('settings.adminIdDesc') || 'Your Telegram User ID'}</p>
                    </div>
                    
                    <div className="flex items-center justify-between pt-2">
                      <div className="flex items-center space-x-2">
                        <span className="text-sm text-muted-foreground">{t('settings.status')}:</span>
                        <span className={botStatus.status === 'connected' ? 'text-accent' : 'text-muted-foreground'}>
                          {botStatus.status === 'connected' ? t('settings.live') : t('settings.offline')}
                        </span>
                      </div>
                      <button onClick={handleTestBot} disabled={isTesting} className="px-6 py-2 bg-secondary text-foreground hover:bg-secondary/80 rounded-lg border border-border/50 hover:border-primary transition-all">
                        {isTesting ? t('settings.testing') : t('settings.testBot')}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <h3 className="text-lg font-semibold text-foreground">{t('settings.proxy')}</h3>
                  <div className="bg-card p-6 rounded-lg border border-border/50 space-y-4">
                    <div className="grid grid-cols-3 gap-4">
                      <div>
                        <label className="block text-xs uppercase text-muted-foreground mb-1">{t('settings.protocol') || 'Protocol'}</label>
                        <select value={proxyConfig.protocol} onChange={(e) => setProxyConfig({ ...proxyConfig, protocol: e.target.value })} className="w-full bg-background border border-border rounded-lg p-2 text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all">
                          <option value="HTTP">HTTP</option>
                          <option value="HTTPS">HTTPS</option>
                          <option value="SOCKS4">SOCKS4</option>
                          <option value="SOCKS5">SOCKS5</option>
                        </select>
                      </div>
                      <div className="col-span-1">
                        <label className="block text-xs uppercase text-muted-foreground mb-1">{t('settings.host') || 'Host'}</label>
                        <input type="text" value={proxyConfig.host} onChange={(e) => setProxyConfig({ ...proxyConfig, host: e.target.value })} placeholder="127.0.0.1" className="w-full bg-background border border-border rounded-lg p-2 text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all" />
                      </div>
                      <div>
                        <label className="block text-xs uppercase text-muted-foreground mb-1">{t('settings.port') || 'Port'}</label>
                        <input type="text" value={proxyConfig.port} onChange={(e) => setProxyConfig({ ...proxyConfig, port: e.target.value })} placeholder="8080" className="w-full bg-background border border-border rounded-lg p-2 text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all" />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs uppercase text-muted-foreground mb-1">{t('settings.usernameOptional') || 'Username (Optional)'}</label>
                        <input type="text" value={proxyConfig.username} onChange={(e) => setProxyConfig({ ...proxyConfig, username: e.target.value })} placeholder="user" className="w-full bg-background border border-border rounded-lg p-2 text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all" />
                      </div>
                      <div>
                        <label className="block text-xs uppercase text-muted-foreground mb-1">{t('settings.passwordOptional') || 'Password (Optional)'}</label>
                        <input type="password" value={proxyConfig.password} onChange={(e) => setProxyConfig({ ...proxyConfig, password: e.target.value })} placeholder="••••" className="w-full bg-background border border-border rounded-lg p-2 text-foreground focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all" />
                      </div>
                    </div>
                    <div className="flex justify-end pt-2">
                      <button onClick={handleTestProxy} className="px-6 py-2 bg-secondary text-foreground hover:bg-secondary/80 rounded-lg border border-border/50 hover:border-primary transition-all">
                        {t('settings.testProxy') || 'Test Proxy'}
                      </button>
                    </div>
                  </div>
                </div>
              </section>
            )}

            {activeTab === 'general' && (
              <>
                <section className="space-y-4">
                  <h3 className="text-lg font-semibold text-foreground">{t('settings.language')}</h3>
                  <div className="flex items-center space-x-4 bg-card p-4 rounded-lg border border-border/50">
                    <button onClick={() => setLanguage('EN')} className={`px-4 py-2 rounded-lg ${language === 'EN' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary'}`}>English</button>
                    <button onClick={() => setLanguage('RU')} className={`px-4 py-2 rounded-lg ${language === 'RU' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary'}`}>Русский</button>
                  </div>
                </section>
                <section className="space-y-4">
                  <h3 className="text-lg font-semibold text-foreground">{t('settings.theme')}</h3>
                  <div className="flex items-center space-x-4 bg-card p-4 rounded-lg border border-border/50">
                    <button onClick={() => setTheme('light')} className={`flex items-center px-4 py-2 rounded-lg ${theme === 'light' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary'}`}><Sun size={16} className="mr-2" /> {t('settings.light')}</button>
                    <button onClick={() => setTheme('dark')} className={`flex items-center px-4 py-2 rounded-lg ${theme === 'dark' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary'}`}><Moon size={16} className="mr-2" /> {t('settings.dark')}</button>
                  </div>
                </section>

                <section className="space-y-4">
                  <h3 className="text-lg font-semibold text-foreground">{t('settings.dataManagement')}</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-card p-4 rounded-lg border border-border/50 space-y-3">
                      <div className="flex items-center text-foreground font-medium">
                        <Download size={18} className="mr-2 text-primary" /> {t('settings.export')}
                      </div>
                      <p className="text-xs text-muted-foreground">{t('settings.exportDesc')}</p>
                      <button 
                        onClick={handleExport}
                        className="w-full py-2 bg-secondary text-foreground rounded-lg border border-border/50 hover:border-primary transition-all text-sm"
                      >
                        {t('settings.exportZip')}
                      </button>
                    </div>
                    <div className="bg-card p-4 rounded-lg border border-border/50 space-y-3">
                      <div className="flex items-center text-foreground font-medium">
                        <Upload size={18} className="mr-2 text-primary" /> {t('settings.importNotes')}
                      </div>
                      <p className="text-xs text-muted-foreground">{t('settings.importDesc')}</p>
                      <label className="block w-full py-2 bg-secondary text-foreground rounded-lg border border-border/50 hover:border-primary transition-all text-sm text-center cursor-pointer">
                        {t('settings.importZip')}
                        <input 
                          type="file" 
                          accept=".zip,.md" 
                          className="hidden" 
                          onChange={handleImport}
                        />
                      </label>
                    </div>
                  </div>
                </section>
              </>
            )}

            {activeTab === 'logs' && (
              <section className="space-y-4 h-full flex flex-col">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-foreground">{t('settings.logs') || 'Sync Logs'}</h3>
                  <button 
                    onClick={() => { (window as any).syncLogs = []; window.location.reload(); }}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    Clear Logs
                  </button>
                </div>
                <div className="flex-1 bg-black/20 rounded-lg p-4 font-mono text-xs overflow-y-auto border border-border/50 min-h-[400px]">
                  {((window as any).syncLogs || []).length > 0 ? (
                    (window as any).syncLogs.map((log: string, i: number) => (
                      <div key={i} className={log.includes('error') || log.includes('failed') ? 'text-destructive' : 'text-muted-foreground'}>
                        {log}
                      </div>
                    ))
                  ) : (
                    <div className="text-muted-foreground italic">No logs available. Sync must run at least once.</div>
                  )}
                </div>
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
