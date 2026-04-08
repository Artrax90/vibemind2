import React, { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import Editor from './components/Editor';
import Chat from './components/Chat';
import Settings from './components/Settings';
import GraphView from './components/GraphView';
import ShareModal from './components/ShareModal';
import SharedNoteView from './components/SharedNoteView';
import Login from './pages/Login';
import { motion, AnimatePresence } from 'framer-motion';
import { Network, Edit3, Eye, Search, X, Menu, Maximize2, Minimize2, Sun, Moon } from 'lucide-react';
import { useLanguage } from './contexts/LanguageContext';

import { api } from './api/client';

export type Note = {
  id: string;
  title: string;
  content: string;
  folderId?: string;
  isShared?: boolean;
  ownerUsername?: string;
  permission?: 'read' | 'write' | 'owner';
  isPinned?: boolean;
};

export type Folder = {
  id: string;
  name: string;
  parentId?: string;
  isShared?: boolean;
  ownerUsername?: string;
  permission?: 'read' | 'write' | 'owner';
};

export default function App() {
  const { t } = useLanguage();
  const [token, setToken] = useState<string | null>(localStorage.getItem('access_token'));
  const [notes, setNotes] = useState<Note[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  const [activeNoteId, setActiveNoteId] = useState<string | null>('1');
  const [showSettings, setShowSettings] = useState(false);
  const [viewMode, setViewMode] = useState<'edit' | 'preview' | 'graph'>('preview');
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Mobile & Focus Mode States
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isFocusMode, setIsFocusMode] = useState(false);
  
  // Share Modal State
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [shareResource, setShareResource] = useState<{ id: string, type: 'note' | 'folder', name: string } | null>(null);
  
  // Theme State
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const saved = localStorage.getItem('app_theme');
    return (saved as 'dark' | 'light') || 'dark';
  });

  const [sharedNoteId, setSharedNoteId] = useState<string | null>(null);

  useEffect(() => {
    const path = window.location.pathname;
    if (path.startsWith('/shared/')) {
      const id = path.split('/')[2];
      if (id) setSharedNoteId(id);
    }
  }, []);

  const handleSetTheme = (newTheme: 'dark' | 'light') => {
    setTheme(newTheme);
    localStorage.setItem('app_theme', newTheme);
  };

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  useEffect(() => {
    if (token) {
      setIsLoading(true);
      Promise.all([api.getNotes(), api.getFolders()]).then(([fetchedNotes, fetchedFolders]) => {
        // Only set default notes if we got an empty array AND it's likely a first-time load
        // For now, we'll trust the backend. If it's empty, it's empty.
        setNotes(fetchedNotes || []);
        setFolders(fetchedFolders || []);
        setIsLoading(false);
      }).catch(err => {
        console.error("Failed to fetch data", err);
        setIsLoading(false);
      });
    }
  }, [token]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'k') {
        e.preventDefault();
        setShowSearch(true);
      }
      if (e.key === 'Escape') {
        setShowSearch(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleNoteSelect = (id: string, mode: 'edit' | 'preview' = 'preview') => {
    setActiveNoteId(id);
    setShowSettings(false);
    setViewMode(mode);
    setShowSearch(false);
    setIsMobileMenuOpen(false); // Close mobile menu on select
  };

  const activeNote = notes.find(n => n.id === activeNoteId);

  const updateNote = (id: string, updates: Partial<Note>) => {
    setNotes(prev => {
      const newNotes = prev.map(n => n.id === id ? { ...n, ...updates } : n);
      const updatedNote = newNotes.find(n => n.id === id);
      if (updatedNote) api.createNote(updatedNote);
      return newNotes;
    });
  };

  const addNote = (newNote: Note) => {
    setNotes(prev => [...prev, newNote]);
    api.createNote(newNote);
    setViewMode('edit');
  };

  const addFolder = (newFolder: Folder) => {
    setFolders(prev => [...prev, newFolder]);
    api.createFolder(newFolder);
  };

  const deleteNote = (id: string) => {
    setNotes(notes.filter(n => n.id !== id));
    if (activeNoteId === id) setActiveNoteId(null);
    api.deleteNote(id);
  };

  const deleteFolder = (id: string) => {
    setFolders(folders.filter(f => f.id !== id));
    setNotes(notes.filter(n => n.folderId !== id));
    api.deleteFolder(id);
  };

  const renameFolder = (id: string, newName: string) => {
    setFolders(folders.map(f => {
      if (f.id === id) {
        const updated = { ...f, name: newName };
        api.createFolder(updated);
        return updated;
      }
      return f;
    }));
  };

  const handleWikilinkClick = (title: string) => {
    const note = notes.find(n => n.title.toLowerCase() === title.toLowerCase());
    if (note) {
      handleNoteSelect(note.id);
    } else {
      // Create new note if it doesn't exist
      const newNote = { id: `n${Date.now()}`, title, content: `# ${title}\n\n` };
      setNotes([...notes, newNote]);
      handleNoteSelect(newNote.id);
    }
  };

  const handleTagClick = (tag: string) => {
    setSearchQuery(`#${tag}`);
    setShowSearch(true);
  };

  const handleShare = (type: 'note' | 'folder', id: string) => {
    let name = '';
    if (type === 'note') {
      name = notes.find(n => n.id === id)?.title || '';
    } else {
      name = folders.find(f => f.id === id)?.name || '';
    }
    setShareResource({ id, type, name });
    setShareModalOpen(true);
  };

  const handleLogout = () => {
    localStorage.removeItem('access_token');
    setToken(null);
    setNotes([]);
    setFolders([]);
    setActiveNoteId(null);
  };

  if (sharedNoteId) {
    return <SharedNoteView shareId={sharedNoteId} />;
  }

  if (!token) {
    return <Login onLogin={(newToken) => setToken(newToken)} />;
  }

  return (
    <div className="flex h-screen w-full font-sans overflow-hidden bg-background text-foreground">
      
      {/* Mobile Menu Overlay */}
      {isMobileMenuOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar - Hidden in Focus Mode, Responsive on Mobile */}
      <div className={`
        ${isFocusMode ? 'hidden' : 'flex'} 
        ${isMobileMenuOpen ? 'fixed inset-y-0 left-0 z-50' : 'hidden md:flex'}
      `}>
        <Sidebar 
          notes={notes} 
          folders={folders} 
          activeNoteId={activeNoteId} 
          onSelectNote={handleNoteSelect}
          onOpenSettings={() => { setShowSettings(true); setIsMobileMenuOpen(false); }}
          onOpenSearch={() => { setShowSearch(true); setIsMobileMenuOpen(false); }}
          onLogout={() => {
            localStorage.removeItem('access_token');
            setToken(null);
          }}
          onNotesChange={setNotes}
          onFoldersChange={setFolders}
          onAddNote={addNote}
          onAddFolder={addFolder}
          onDeleteNote={deleteNote}
          onDeleteFolder={deleteFolder}
          onRenameFolder={renameFolder}
          onShare={handleShare}
          onClose={() => setIsMobileMenuOpen(false)}
        />
      </div>
      
      <main className="flex-1 flex flex-col relative border-r min-w-0 border-border/50">
        {/* Header Toggle & Mobile Controls - Moved to top center and slightly enlarged */}
        {!showSettings && (
          <div className="absolute top-8 left-1/2 -translate-x-1/2 z-10 flex items-center space-x-2 rounded-xl border border-border/50 bg-background/80 backdrop-blur-sm p-1.5 shadow-xl">
            <button 
              onClick={() => setViewMode('edit')}
              className={`p-2 rounded-lg flex items-center transition-all duration-200 ${viewMode === 'edit' ? 'bg-primary/20 text-primary shadow-inner' : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'}`}
              title="Edit Mode"
            >
              <Edit3 size={18} />
            </button>
            <button 
              onClick={() => setViewMode('preview')}
              className={`p-2 rounded-lg flex items-center transition-all duration-200 ${viewMode === 'preview' ? 'bg-primary/20 text-primary shadow-inner' : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'}`}
              title="Preview Mode"
            >
              <Eye size={18} />
            </button>
            <button 
              onClick={() => setViewMode('graph')}
              className={`p-2 rounded-lg flex items-center transition-all duration-200 ${viewMode === 'graph' ? 'bg-primary/20 text-primary shadow-inner' : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'}`}
              title="Graph View"
            >
              <Network size={18} />
            </button>
          </div>
        )}

        {/* Mobile Hamburger */}
        {!isFocusMode && (
          <button 
            onClick={() => setIsMobileMenuOpen(true)}
            className="md:hidden absolute top-4 left-4 z-10 p-2 border border-border/50 rounded-lg bg-background/80 backdrop-blur-sm text-muted-foreground hover:text-foreground"
          >
            <Menu size={20} />
          </button>
        )}

        <AnimatePresence mode="wait">
          {showSettings ? (
            <motion.div 
              key="settings"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="h-full w-full"
            >
              <Settings onClose={() => setShowSettings(false)} theme={theme} setTheme={handleSetTheme} />
            </motion.div>
          ) : viewMode === 'graph' ? (
            <motion.div 
              key="graph"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="h-full w-full"
            >
              <GraphView notes={notes} activeNoteId={activeNoteId} onNodeClick={handleNoteSelect} />
            </motion.div>
          ) : activeNote ? (
            <motion.div 
              key={`editor-${activeNote.id}`}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="h-full w-full"
            >
              <Editor 
                note={activeNote} 
                allNotes={notes}
                onUpdate={updateNote} 
                onWikilinkClick={handleWikilinkClick}
                onTagClick={handleTagClick}
                isPreview={viewMode === 'preview'}
                onShare={() => handleShare('note', activeNote.id)}
              />
            </motion.div>
          ) : (
            <div key="empty" className="flex-1 flex items-center justify-center text-muted-foreground">
              {t('editor.empty')}
            </div>
          )}
        </AnimatePresence>
      </main>

      {/* Chat - Hidden in Focus Mode and on Mobile (unless toggled) */}
      <div className={`${isFocusMode ? 'hidden' : 'hidden lg:flex'}`}>
        <Chat notes={notes} activeNoteId={activeNoteId} onNoteClick={handleNoteSelect} />
      </div>

      {/* Global Search Modal */}
      <AnimatePresence>
        {shareModalOpen && shareResource && (
          <ShareModal
            isOpen={shareModalOpen}
            onClose={() => setShareModalOpen(false)}
            resourceId={shareResource.id}
            resourceType={shareResource.type}
            resourceName={shareResource.name}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showSearch && (
          <div className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh] bg-black/60 backdrop-blur-sm px-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-2xl bg-card border border-border rounded-xl shadow-2xl overflow-hidden"
            >
              <div className="flex items-center px-4 py-3 border-b border-border/50">
                <Search size={20} className="text-muted-foreground mr-3" />
                <input 
                  autoFocus
                  type="text" 
                  placeholder={`${t('sidebar.search')}...`}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="flex-1 bg-transparent border-none outline-none text-lg text-foreground placeholder-muted-foreground"
                />
                <button onClick={() => setShowSearch(false)} className="p-1 text-muted-foreground hover:text-primary rounded transition-colors">
                  <X size={20} />
                </button>
              </div>
              <div className="max-h-[60vh] overflow-y-auto p-2 scrollbar-thin">
                {notes.filter(n => n.title.toLowerCase().includes(searchQuery.toLowerCase()) || n.content.toLowerCase().includes(searchQuery.toLowerCase())).map(note => (
                  <div 
                    key={note.id}
                    onClick={() => handleNoteSelect(note.id)}
                    className="px-4 py-3 rounded-lg cursor-pointer flex flex-col hover:bg-secondary transition-colors"
                  >
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
