import React, { useState, useEffect } from 'react';
import { Component, ErrorInfo, ReactNode } from 'react';
import Sidebar from './components/Sidebar';
import Editor from './components/Editor';
import Chat from './components/Chat';
import Settings from './components/Settings';
import GraphView from './components/GraphView';
import ShareModal from './components/ShareModal';
import SharedNoteView from './components/SharedNoteView';
import Login from './pages/Login';
import { motion, AnimatePresence } from 'framer-motion';
import { Network, Edit3, Eye, Search, X, Menu, Maximize2, Minimize2, Sun, Moon, AlertTriangle, Lock } from 'lucide-react';
import { useLanguage } from './contexts/LanguageContext';
import { Note, Folder } from './types';
import { api } from './api/client';

class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean, error: any }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="h-screen w-full flex flex-col items-center justify-center bg-background text-foreground p-6 text-center">
          <AlertTriangle className="h-12 w-12 text-destructive mb-4" />
          <h1 className="text-2xl font-bold mb-2">Something went wrong</h1>
          <p className="text-muted-foreground mb-4 max-w-md">The application crashed. This might be due to a loading error or data mismatch.</p>
          <pre className="p-4 bg-secondary/50 rounded-lg text-xs font-mono mb-4 max-w-full overflow-auto">
            {this.state.error?.toString()}
          </pre>
          <button 
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity"
          >
            Reload Page
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default function App() {
  const { t } = useLanguage();
  const [token, setToken] = useState<string | null>(() => {
    try {
      return localStorage.getItem('access_token');
    } catch (e) {
      return null;
    }
  });
  const [notes, setNotes] = useState<Note[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [unlockedFolders, setUnlockedFolders] = useState<Set<string>>(new Set());
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'edit' | 'preview' | 'graph'>('preview');
  const [showSettings, setShowSettings] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      if (typeof window !== 'undefined') {
        return localStorage.getItem('theme') as 'light' | 'dark' || 'dark';
      }
    } catch (e) {}
    return 'dark';
  });
  const [isLoading, setIsLoading] = useState(false);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [shareResource, setShareResource] = useState<{ id: string, type: 'note' | 'folder', name: string } | null>(null);

  // Robust check for shared resource in URL
  const sharedNoteId = (() => {
    try {
      const searchId = new URLSearchParams(window.location.search).get('share');
      if (searchId) return searchId;
      
      const pathMatch = window.location.pathname.match(/\/shared\/([^\/\?]+)/);
      return pathMatch ? pathMatch[1] : null;
    } catch (e) {
      console.error("Failed to parse share ID from URL", e);
      return null;
    }
  })();

  const handleSetTheme = (newTheme: 'light' | 'dark') => {
    setTheme(newTheme);
    try {
      localStorage.setItem('theme', newTheme);
    } catch (e) {}
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
    const note = notes.find(n => n.id === id);
    if (!note) return;
    
    if (note.folderId) {
      const folder = folders.find(f => f.id === note.folderId);
      if (folder?.isProtected && !unlockedFolders.has(folder.id)) {
        document.dispatchEvent(new CustomEvent('request-folder-unlock', { detail: { folderId: folder.id, noteId: id, mode } }));
        return;
      }
    }

    setActiveNoteId(id);
    setShowSettings(false);
    setViewMode(mode);
    setShowSearch(false);
    setIsMobileMenuOpen(false); // Close mobile menu on select
  };

  const availableNotes = React.useMemo(() => {
    return notes.filter(n => {
      if (!n.folderId) return true;
      const f = folders.find(f => f.id === n.folderId);
      if (f?.isProtected && !unlockedFolders.has(n.folderId)) return false;
      return true;
    });
  }, [notes, folders, unlockedFolders]);

  const activeNote = availableNotes.find(n => n.id === activeNoteId);

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
    api.createNote(newNote).catch(console.error);
    setActiveNoteId(newNote.id);
    setViewMode('edit');
    setShowSearch(false);
    setIsMobileMenuOpen(false);
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
    return (
      <ErrorBoundary>
        <div className="h-screen w-full flex flex-col bg-background">
          <SharedNoteView shareId={sharedNoteId} />
        </div>
      </ErrorBoundary>
    );
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
          unlockedFolders={unlockedFolders}
          setUnlockedFolders={setUnlockedFolders}
          activeNoteId={activeNoteId} 
          onSelectNote={handleNoteSelect}
          onOpenSettings={() => { setShowSettings(true); setIsMobileMenuOpen(false); }}
          onOpenSearch={() => { setShowSearch(true); setIsMobileMenuOpen(false); }}
          onLogout={handleLogout}
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
              <GraphView notes={availableNotes} activeNoteId={activeNoteId} onNodeClick={handleNoteSelect} />
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
                allNotes={availableNotes}
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
        <Chat notes={notes} folders={folders} unlockedFolders={unlockedFolders} activeNoteId={activeNoteId} onNoteClick={handleNoteSelect} api={api} />
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
            onShareStatusChange={(isShared) => {
              if (shareResource.id) {
                if (shareResource.type === 'note') {
                  setNotes(prev => prev.map(n => n.id === shareResource.id ? { ...n, isSharedByMe: isShared } : n));
                } else if (shareResource.type === 'folder') {
                  setFolders(prev => prev.map(f => f.id === shareResource.id ? { ...f, isSharedByMe: isShared } : f));
                }
              }
            }}
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
                {notes.filter(n => {
                  // Only match real text, don't match locked notes text
                  const f = folders.find(f => f.id === n.folderId);
                  const isLocked = f?.isProtected && !unlockedFolders.has(n.folderId!);
                  if (isLocked) {
                    // Do not search by content/title if locked, to prevent leaks
                    // But if the folder itself matches the query, MAYBE show it? 
                    // Let's just always show matching notes, BUT we don't want to leak content.
                    // If we don't match text, how can user find it?
                    // "в поиске заметка должна отображаться, но быть замазанной" indicates it SHOULD match.
                    // Okay, we will match the text normally.
                  }
                  return (n.title?.toLowerCase() || '').includes(searchQuery.toLowerCase()) || 
                         (n.content?.toLowerCase() || '').includes(searchQuery.toLowerCase());
                }).map(note => {
                  const isLocked = note.folderId && folders.find(f => f.id === note.folderId)?.isProtected && !unlockedFolders.has(note.folderId);
                  
                  return (
                  <div 
                    key={note.id}
                    onClick={() => handleNoteSelect(note.id)}
                    className="px-4 py-3 rounded-lg cursor-pointer flex flex-col hover:bg-secondary transition-colors relative"
                  >
                    <div className={isLocked ? 'blur-[4px] opacity-70 select-none' : ''}>
                      <span className="text-primary font-medium">{note.title || 'Untitled'}</span>
                      <span className="text-sm text-muted-foreground line-clamp-1 mt-1">{note.content || '...'}</span>
                    </div>
                    {isLocked && (
                      <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
                         <Lock size={20} className="text-foreground/50 drop-shadow-md" />
                      </div>
                    )}
                  </div>
                )})}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
