import React, { useState, useEffect, useCallback } from 'react';
import Sidebar from '../components/Sidebar';
import Editor from './Editor';
import Settings from './Settings';
import GraphView from '../components/GraphView';
import Chat from '../components/Chat';
import ShareModal from '../components/ShareModal';
import { motion, AnimatePresence } from 'framer-motion';
import { Network, Edit3, Eye, Search, X, Menu, RefreshCw, MessageSquare } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';
import { useSync } from '../contexts/SyncContext';
import { Capacitor } from '@capacitor/core';
import { dbApi } from '../lib/db';
import { api } from './client';
import SyncManager from '../components/SyncManager';
import { Note, Folder } from '../types';

(window as any).desktopApi = api;

export default function App() {
  const { t } = useLanguage();
  const [notes, setNotes] = useState<Note[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'edit' | 'preview' | 'graph'>('preview');
  const [showSettings, setShowSettings] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    return localStorage.getItem('theme') as 'light' | 'dark' || 'dark';
  });
  const [isLoading, setIsLoading] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [baseUrl, setBaseUrl] = useState<string>('');
  const [unlockedFolders, setUnlockedFolders] = useState<Set<string>>(new Set());

  // Share Modal State
  const [shareModal, setShareModal] = useState<{
    isOpen: boolean;
    type: 'note' | 'folder' | null;
    id: string | null;
    name: string | null;
  }>({ isOpen: false, type: null, id: null, name: null });

  const { status, progress } = useSync();

  const syncProgress = progress.total > 0 ? (progress.current / progress.total) * 100 : 0;

  useEffect(() => {
    api.getNormalizedUrl().then(url => {
      if (url) setBaseUrl(url);
    });
  }, []);

  const handleLogout = async () => {
    if (confirm('Are you sure you want to logout? This will clear all local data and sync settings.')) {
      await api.clearLocalData();
      setNotes([]);
      setFolders([]);
      setActiveNoteId(null);
      window.location.reload();
    }
  };

  const handleShare = (type: 'note' | 'folder', id: string) => {
    const name = type === 'note' 
      ? notes.find(n => n.id === id)?.title || '' 
      : folders.find(f => f.id === id)?.name || '';
    setShareModal({ isOpen: true, type, id, name });
  };

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  useEffect(() => {
    const handleCloseSidebar = () => setIsMobileMenuOpen(false);
    document.addEventListener('close-sidebar', handleCloseSidebar);
    return () => document.removeEventListener('close-sidebar', handleCloseSidebar);
  }, []);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [fetchedNotes, fetchedFolders] = await Promise.all([
        api.getNotes(),
        api.getFolders()
      ]);
      console.log(`[Data] Loaded ${fetchedNotes.length} notes and ${fetchedFolders.length} folders`);
      setNotes(fetchedNotes || []);
      setFolders(fetchedFolders || []);
    } catch (err) {
      console.error("Failed to fetch data", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSyncComplete = useCallback(() => {
    loadData();
    // Force editor refresh if active note was updated
    if (activeNoteId) {
      setActiveNoteId(prev => prev);
    }
  }, [loadData, activeNoteId]);

  const handleNoteSelect = (id: string, mode: 'edit' | 'preview' = 'preview') => {
    setActiveNoteId(id);
    setShowSettings(false);
    setViewMode(mode);
    setShowSearch(false);
    setIsMobileMenuOpen(false);
  };

  const activeNote = notes.find(n => n.id === activeNoteId);

  const updateNote = async (id: string, updates: Partial<Note>) => {
    const updated_at = new Date().toISOString();
    const finalUpdates = { ...updates, updated_at };
    setNotes(prev => prev.map(n => n.id === id ? { ...n, ...finalUpdates } : n));
    await api.updateNote(id, finalUpdates);
  };

  const addNote = async (newNote: Note) => {
    setNotes(prev => [...prev, newNote]);
    await api.createNote(newNote);
    setActiveNoteId(newNote.id);
    setViewMode('edit');
  };

  const addFolder = async (newFolder: Folder) => {
    setFolders(prev => [...prev, newFolder]);
    await api.createFolder(newFolder);
  };

  const deleteNote = async (id: string) => {
    setNotes(notes.filter(n => n.id !== id));
    if (activeNoteId === id) setActiveNoteId(null);
    await api.deleteNote(id);
  };

  const deleteFolder = async (id: string) => {
    const getSubfolders = (parentId: string): string[] => {
      const children = folders.filter(f => f.parentId === parentId);
      let ids = [parentId];
      for (const c of children) {
        ids = ids.concat(getSubfolders(c.id));
      }
      return ids;
    };
    
    const allIds = getSubfolders(id);
    
    setFolders(folders.filter(f => !allIds.includes(f.id)));
    setNotes(notes.filter(n => !n.folderId || !allIds.includes(n.folderId)));
    await api.deleteFolder(id);
  };

  const renameFolder = async (id: string, newName: string) => {
    const updated_at = new Date().toISOString();
    setFolders(folders.map(f => f.id === id ? { ...f, name: newName, updated_at } : f));
    await api.updateFolder(id, { name: newName, updated_at });
  };

  const handleWikilinkClick = (title: string) => {
    const note = notes.find(n => n.title.toLowerCase() === title.toLowerCase());
    if (note) {
      handleNoteSelect(note.id);
    } else {
      const newNote = { id: `n${Date.now()}`, title, content: `# ${title}\n\n` };
      addNote(newNote);
      handleNoteSelect(newNote.id);
    }
  };

  const handleCloseSettings = () => {
    setShowSettings(false);
    api.getNormalizedUrl().then(url => {
      if (url) setBaseUrl(url);
    });
  };

  const handleQuit = async () => {
    try {
      const config = await dbApi.getSyncConfig();
      if (config.server_url && config.username && config.password) {
        // Trigger sync and wait
        window.dispatchEvent(new CustomEvent('force-sync'));
        
        // Wait for sync-finished or timeout after 10 seconds
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(() => {
            console.log('Sync on quit timed out');
            resolve();
          }, 10000);
          
          window.addEventListener('sync-finished', () => {
            clearTimeout(timeout);
            resolve();
          }, { once: true });
        });
      }
    } catch (e) {
      console.error('Error during sync on quit', e);
    } finally {
      dbApi.quitApp();
    }
  };

  return (
    <div className="flex h-screen w-full font-sans overflow-hidden bg-background text-foreground">
      <SyncManager onSyncComplete={loadData} />
      
      <div className={`fixed inset-0 z-40 bg-black/50 backdrop-blur-sm transition-opacity md:hidden ${isMobileMenuOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`} onClick={() => setIsMobileMenuOpen(false)} />
      
      <div className={`flex ${isMobileMenuOpen ? 'fixed inset-y-0 left-0 z-50 shadow-2xl' : 'hidden md:flex'}`}>
        <Sidebar 
          notes={notes} 
          folders={folders} 
          unlockedFolders={unlockedFolders}
          setUnlockedFolders={setUnlockedFolders}
          activeNoteId={activeNoteId} 
          onSelectNote={handleNoteSelect}
          onOpenSettings={() => { setShowSettings(true); setShowChat(false); }}
          onOpenSearch={() => setShowSearch(true)}
          onLogout={handleLogout}
          onNotesChange={setNotes}
          onFoldersChange={setFolders}
          onAddNote={addNote}
          onAddFolder={addFolder}
          onDeleteNote={deleteNote}
          onDeleteFolder={deleteFolder}
          onRenameFolder={renameFolder}
          onShare={handleShare}
          onQuit={!Capacitor.isNativePlatform() ? handleQuit : undefined}
          onClose={() => setIsMobileMenuOpen(false)}
        />
      </div>
      
      <main className="flex-1 flex flex-col relative border-r min-w-0 border-border/50">
        <button 
          onClick={() => setIsMobileMenuOpen(true)}
          className="md:hidden absolute top-8 left-4 z-20 p-2 bg-background/80 backdrop-blur-sm border border-border/50 rounded-lg text-foreground shadow-lg"
        >
          <Menu size={20} />
        </button>

        {!showSettings && (
          <div className="absolute bottom-6 md:top-8 md:bottom-auto left-1/2 -translate-x-1/2 z-10 flex items-center space-x-2 rounded-xl border border-border/50 bg-background/80 backdrop-blur-sm p-1.5 shadow-xl">
            <div className="flex items-center px-2 mr-2 border-r border-border/50 space-x-2">
              <div className="relative flex items-center justify-center">
                {status === 'syncing' && <RefreshCw size={16} className="text-primary animate-spin" />}
                {status === 'success' && <RefreshCw size={16} className="text-accent" />}
                {status === 'error' && <RefreshCw size={16} className="text-destructive" />}
                {status === 'idle' && <RefreshCw size={16} className="text-muted-foreground opacity-30" />}
              </div>
              {status === 'syncing' && progress.total > 0 && (
                <div className="flex flex-col w-20">
                  <div className="w-full h-1 bg-secondary rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-primary transition-all duration-300" 
                      style={{ width: `${syncProgress}%` }}
                    />
                  </div>
                  <span className="text-[8px] text-muted-foreground mt-0.5 text-center font-mono">
                    {progress.current}/{progress.total}
                  </span>
                </div>
              )}
            </div>
            <button 
              onClick={() => {
                if (!activeNoteId) {
                  const newNote: Note = { id: `n${Date.now()}`, title: 'New Note', content: '', permission: 'owner' };
                  addNote(newNote);
                  handleNoteSelect(newNote.id, 'edit');
                } else {
                  setViewMode('edit');
                }
              }} 
              className={`p-2 rounded-lg ${viewMode === 'edit' ? 'bg-primary/20 text-primary' : 'text-muted-foreground'}`}
            >
              <Edit3 size={18} />
            </button>
            <button onClick={() => setViewMode('preview')} className={`p-2 rounded-lg ${viewMode === 'preview' ? 'bg-primary/20 text-primary' : 'text-muted-foreground'}`}><Eye size={18} /></button>
            <button onClick={() => setViewMode('graph')} className={`p-2 rounded-lg ${viewMode === 'graph' ? 'bg-primary/20 text-primary' : 'text-muted-foreground'}`}><Network size={18} /></button>
            <div className="w-px h-4 bg-border/50 mx-1" />
            <button 
              onClick={() => setShowChat(!showChat)} 
              className={`p-2 rounded-lg transition-colors ${showChat ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground'}`}
              title="AI Assistant"
            >
              <MessageSquare size={18} />
            </button>
          </div>
        )}

        <AnimatePresence mode="wait">
          {showSettings ? (
            <motion.div key="settings" className="h-full w-full">
              <Settings onClose={handleCloseSettings} theme={theme} setTheme={(t) => { setTheme(t); localStorage.setItem('theme', t); }} />
            </motion.div>
          ) : viewMode === 'graph' ? (
            <motion.div key="graph" className="h-full w-full">
              <GraphView notes={notes} activeNoteId={activeNoteId} onNodeClick={handleNoteSelect} />
            </motion.div>
          ) : activeNote ? (
            <motion.div key={`editor-${activeNote.id}`} className="h-full w-full">
              <Editor 
                note={activeNote} 
                allNotes={notes}
                onUpdate={updateNote} 
                onWikilinkClick={handleWikilinkClick}
                onTagClick={(tag) => { setSearchQuery(`#${tag}`); setShowSearch(true); }}
                isPreview={viewMode === 'preview'}
              />
            </motion.div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-muted-foreground">{t('editor.empty')}</div>
          )}
        </AnimatePresence>
      </main>

      <ShareModal 
        isOpen={shareModal.isOpen}
        onClose={() => setShareModal({ ...shareModal, isOpen: false })}
        resourceId={shareModal.id}
        resourceType={shareModal.type}
        resourceName={shareModal.name}
        baseUrl={baseUrl}
        onShareStatusChange={(isShared) => {
          if (shareModal.id) {
            if (shareModal.type === 'note') {
              updateNote(shareModal.id, { isSharedByMe: isShared });
            } else if (shareModal.type === 'folder') {
              setFolders(prev => prev.map(f => f.id === shareModal.id ? { ...f, isSharedByMe: isShared } : f));
              api.updateFolder(shareModal.id, { isSharedByMe: isShared });
            }
          }
        }}
      />

      <AnimatePresence>
        {showChat && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowChat(false)}
              className="fixed inset-0 bg-black/20 backdrop-blur-sm z-30 md:hidden"
            />
            <motion.div 
              initial={{ x: 320 }}
              animate={{ x: 0 }}
              exit={{ x: 320 }}
              className="fixed right-0 top-0 bottom-0 z-40 shadow-2xl"
            >
              <Chat notes={notes} folders={folders} unlockedFolders={unlockedFolders} activeNoteId={activeNoteId} onNoteClick={handleNoteSelect} api={api} />
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showSearch && (
          <div className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh] bg-black/60 backdrop-blur-sm px-4">
            <motion.div className="w-full max-w-2xl bg-card border border-border rounded-xl shadow-2xl overflow-hidden">
              <div className="flex items-center px-4 py-3 border-b border-border/50">
                <Search size={20} className="text-muted-foreground mr-3" />
                <input autoFocus type="text" placeholder={`${t('sidebar.search')}...`} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="flex-1 bg-transparent border-none outline-none text-lg text-foreground" />
                <button onClick={() => setShowSearch(false)} className="p-1 text-muted-foreground"><X size={20} /></button>
              </div>
              <div className="max-h-[60vh] overflow-y-auto p-2">
                {notes.filter(n => n.title.toLowerCase().includes(searchQuery.toLowerCase()) || n.content.toLowerCase().includes(searchQuery.toLowerCase())).map(note => (
                  <div key={note.id} onClick={() => handleNoteSelect(note.id)} className="px-4 py-3 rounded-lg cursor-pointer hover:bg-secondary">
                    <span className="text-primary font-medium">{note.title}</span>
                    <span className="text-sm text-muted-foreground line-clamp-1 mt-1">{note.content}</span>
                  </div>
                ))}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
