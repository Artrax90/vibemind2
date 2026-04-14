import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Folder, FileText, Settings as SettingsIcon, Plus, MoreVertical, Search, ChevronRight, ChevronDown, FilePlus, FolderPlus, Edit2, Trash2, Share2, FolderInput, Sparkles, X, LogOut, Pin, PinOff, RefreshCw } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Note, Folder as FolderType } from '../App';
import CreateFolderModal from './modals/CreateFolderModal';
import ShareModal from './ShareModal';
import { api } from '../api/client';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent, useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

import { useLanguage } from '../contexts/LanguageContext';

type SidebarProps = {
  notes: Note[];
  folders: FolderType[];
  activeNoteId: string | null;
  isLoading?: boolean;
  onSelectNote: (id: string, mode?: 'edit' | 'preview') => void;
  onOpenSettings: () => void;
  onOpenSearch: () => void;
  onLogout: () => void;
  onNotesChange: (notes: Note[]) => void;
  onFoldersChange: (folders: FolderType[]) => void;
  onAddNote: (note: Note) => void;
  onAddFolder: (folder: FolderType) => void;
  onDeleteNote: (id: string) => void;
  onDeleteFolder: (id: string) => void;
  onRenameFolder: (id: string, newName: string) => void;
  onShare: (type: 'note' | 'folder', id: string) => void;
  onQuit?: () => void;
  onClose?: () => void;
};

// Sortable Note Item
function SortableNoteItem({ note, activeNoteId, onSelectNote, onContextMenu, t }: any) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ 
    id: note.id,
    data: { type: 'note', note }
  });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div 
      ref={setNodeRef} style={style} {...attributes} {...listeners}
      onClick={() => onSelectNote(note.id)}
      onContextMenu={(e) => onContextMenu(e, 'note', note.id)}
      className={`flex items-center justify-between px-2 py-1.5 rounded-md cursor-pointer group transition-colors duration-200 ${activeNoteId === note.id ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground'}`}
    >
      <div className="flex items-center overflow-hidden flex-1">
        <div className="flex items-center flex-shrink-0 mr-2 ml-[18px]">
          <FileText size={14} className={`opacity-70 ${activeNoteId === note.id ? 'text-primary' : 'text-muted-foreground'}`} />
          {note.isPinned && <Pin size={10} className="ml-1 text-primary fill-primary" />}
        </div>
        <div className="flex flex-col min-w-0">
          <div className="flex items-center">
            <span className="text-sm truncate">{note.title}</span>
            {note.isSharedByMe && <Share2 size={10} className="ml-1 text-primary opacity-70" />}
          </div>
          {note.isShared && (
            <span className="text-[10px] text-muted-foreground/60 truncate flex items-center">
              <Share2 size={8} className="mr-1" /> {note.ownerUsername} ({note.permission === 'owner' ? t('sidebar.owner') || 'Owner' : note.permission})
            </span>
          )}
        </div>
      </div>
      <button 
        onClick={(e) => { e.stopPropagation(); onContextMenu(e, 'note', note.id); }}
        className="opacity-0 group-hover:opacity-100 p-1 text-muted-foreground hover:text-foreground transition-opacity"
      >
        <MoreVertical size={14} />
      </button>
    </div>
  );
}

// Droppable Folder Item
function DroppableFolder({ folder, isExpanded, isSelected, isRenaming, renameValue, setRenameValue, handleRenameSubmit, toggleFolder, handleContextMenu, onDeleteFolder, onShare, t, children }: any) {
  const { isOver, setNodeRef } = useDroppable({
    id: folder.id,
    data: { type: 'folder', folder }
  });

  return (
    <div ref={setNodeRef}>
      <div 
        onClick={(e) => toggleFolder(folder.id, e)}
        onContextMenu={(e) => handleContextMenu(e, 'folder', folder.id)}
        className={`flex items-center justify-between px-2 py-1.5 rounded-md cursor-pointer group transition-colors duration-200 ${isOver ? 'bg-primary/20 ring-1 ring-primary' : isSelected ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground'}`}
      >
        <div className="flex items-center flex-1 overflow-hidden">
          {isExpanded ? <ChevronDown size={14} className="mr-1 flex-shrink-0"/> : <ChevronRight size={14} className="mr-1 flex-shrink-0"/>}
          <Folder size={14} className={`mr-2 opacity-70 flex-shrink-0 ${isSelected || isOver ? 'text-primary' : 'text-muted-foreground'}`} />
          {isRenaming ? (
            <form onSubmit={handleRenameSubmit} onClick={e => e.stopPropagation()} className="flex-1">
              <input 
                autoFocus
                value={renameValue}
                onChange={e => setRenameValue(e.target.value)}
                onBlur={handleRenameSubmit}
                className="w-full bg-background text-foreground border border-primary rounded px-1 text-sm outline-none"
              />
            </form>
          ) : (
            <div className="flex flex-col min-w-0">
              <div className="flex items-center">
                <span className="text-sm truncate">{folder.name}</span>
                {folder.isSharedByMe && <Share2 size={10} className="ml-1 text-primary opacity-70" />}
              </div>
              {folder.isShared && (
                <span className="text-[10px] text-muted-foreground/60 truncate flex items-center">
                  <Share2 size={8} className="mr-1" /> {folder.ownerUsername} ({folder.permission === 'owner' ? t('sidebar.owner') || 'Owner' : folder.permission})
                </span>
              )}
            </div>
          )}
        </div>
        {!isRenaming && (
          <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
            {folder.permission === 'owner' && (
              <>
                <button 
                  onClick={(e) => { e.stopPropagation(); onShare('folder', folder.id); }}
                  className="p-1 text-muted-foreground hover:text-primary transition-colors"
                  title={t('sidebar.share')}
                >
                  <Share2 size={14} />
                </button>
                <button 
                  onClick={(e) => { e.stopPropagation(); onDeleteFolder(folder.id); }}
                  className="p-1 text-muted-foreground hover:text-destructive transition-colors"
                  title={t('sidebar.delete')}
                >
                  <Trash2 size={14} />
                </button>
              </>
            )}
            <button 
              onClick={(e) => { e.stopPropagation(); handleContextMenu(e, 'folder', folder.id); }}
              className="p-1 text-muted-foreground hover:text-foreground transition-colors"
            >
              <MoreVertical size={14} />
            </button>
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

export default function Sidebar({ notes, folders, activeNoteId, isLoading = false, onSelectNote, onOpenSettings, onOpenSearch, onLogout, onNotesChange, onFoldersChange, onAddNote, onAddFolder, onDeleteNote, onDeleteFolder, onRenameFolder, onShare, onQuit, onClose }: SidebarProps) {
  const { t } = useLanguage();
  const [isCreateFolderOpen, setIsCreateFolderOpen] = useState(false);
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const [selectedFolderId, setSelectedFolderId] = useState<string | undefined>(undefined);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  
  // Context Menu State
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, type: 'note' | 'folder', id: string } | null>(null);
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [movingNoteId, setMovingNoteId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor)
  );

  useEffect(() => {
    const handleClickOutside = () => setContextMenu(null);
    window.addEventListener('click', handleClickOutside);
    return () => window.removeEventListener('click', handleClickOutside);
  }, []);

  const toggleFolder = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const next = new Set(expandedFolders);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpandedFolders(next);
    setSelectedFolderId(id);
  };

  const handleCreateFolder = async (name: string, parentId?: string) => {
    try {
      const newFolder: FolderType = { id: `f${Date.now()}`, name, parentId, permission: 'owner' };
      api.createFolder(newFolder).catch(console.error);
      onAddFolder(newFolder);
      if (parentId) {
        setExpandedFolders(new Set(expandedFolders).add(parentId));
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleCreateNote = async () => {
    setPlusMenuOpen(false);
    const newNote: Note = { id: `n${Date.now()}`, title: 'New Note', content: '', folderId: selectedFolderId, permission: 'owner' };
    try {
      api.createNote(newNote).catch(console.error);
      onAddNote(newNote);
      onSelectNote(newNote.id, 'edit');
      if (selectedFolderId) {
        setExpandedFolders(new Set(expandedFolders).add(selectedFolderId));
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;

    if (active.id !== over.id) {
      const overData = over.data.current;

      if (overData?.type === 'folder') {
        // Dropped a note onto a folder
        const updatedNotes = notes.map(n => n.id === active.id ? { ...n, folderId: over.id as string } : n);
        onNotesChange(updatedNotes);
        // Persist the change
        api.updateNote(active.id as string, { folderId: over.id as string }).catch(console.error);
      } else {
        // Basic reordering logic
        const oldIndex = notes.findIndex(n => n.id === active.id);
        const newIndex = notes.findIndex(n => n.id === over.id);
        if (oldIndex !== -1 && newIndex !== -1) {
          const newNotes = [...notes];
          const [moved] = newNotes.splice(oldIndex, 1);
          newNotes.splice(newIndex, 0, moved);
          onNotesChange(newNotes);
        }
      }
    }
  };

  const handleContextMenu = (e: React.MouseEvent, type: 'note' | 'folder', id: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, type, id });
  };

  const handleRenameSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (renamingFolderId && renameValue.trim()) {
      onRenameFolder(renamingFolderId, renameValue.trim());
    }
    setRenamingFolderId(null);
  };

  const handleMoveNote = (folderId: string | undefined) => {
    if (movingNoteId) {
      const updatedNotes = notes.map(n => n.id === movingNoteId ? { ...n, folderId } : n);
      onNotesChange(updatedNotes);
      // Persist the change
      api.updateNote(movingNoteId, { folderId }).catch(console.error);
      setMovingNoteId(null);
    }
  };

  const handleShareClick = (type: 'note' | 'folder', id: string) => {
    onShare(type, id);
    setContextMenu(null);
  };

  const handleTogglePin = (noteId: string) => {
    const note = notes.find(n => n.id === noteId);
    if (note) {
      const updatedNotes = notes.map(n => n.id === noteId ? { ...n, isPinned: !n.isPinned } : n);
      onNotesChange(updatedNotes);
      api.updateNote(noteId, { isPinned: !note.isPinned }).catch(console.error);
    }
    setContextMenu(null);
  };

  const renderTree = (parentId?: string, depth = 0) => {
    const childFolders = folders
      .filter(f => (f.parentId || undefined) === parentId)
      .sort((a, b) => a.name.localeCompare(b.name));
      
    const childNotes = notes
      .filter(n => (n.folderId || undefined) === parentId)
      .sort((a, b) => {
        // Pinned first
        if (a.isPinned && !b.isPinned) return -1;
        if (!a.isPinned && b.isPinned) return 1;
        // Then by title
        return a.title.localeCompare(b.title);
      });

    return (
      <div className="space-y-0.5" style={{ paddingLeft: depth > 0 ? '16px' : '0px' }}>
        {childFolders.map(folder => {
          const isExpanded = expandedFolders.has(folder.id);
          const isSelected = selectedFolderId === folder.id;
          const isRenaming = renamingFolderId === folder.id;
          
          return (
            <DroppableFolder 
              key={folder.id}
              folder={folder}
              isExpanded={isExpanded}
              isSelected={isSelected}
              isRenaming={isRenaming}
              renameValue={renameValue}
              setRenameValue={setRenameValue}
              handleRenameSubmit={handleRenameSubmit}
              toggleFolder={toggleFolder}
              handleContextMenu={handleContextMenu}
              onDeleteFolder={onDeleteFolder}
              onShare={onShare}
              t={t}
            >
              {isExpanded && renderTree(folder.id, depth + 1)}
            </DroppableFolder>
          );
        })}
        
        <SortableContext items={childNotes.map(n => n.id)} strategy={verticalListSortingStrategy}>
          {childNotes.map(note => (
            <SortableNoteItem 
              key={note.id} 
              note={note} 
              activeNoteId={activeNoteId} 
              onSelectNote={onSelectNote} 
              onContextMenu={handleContextMenu}
              t={t}
            />
          ))}
        </SortableContext>
      </div>
    );
  };

  return (
    <>
      <motion.div 
        initial={{ x: -250 }}
        animate={{ x: 0 }}
        className="w-64 bg-background/95 border-r border-border/50 flex flex-col h-full relative" 
        onClick={() => setSelectedFolderId(undefined)}
      >
        <div className="p-6 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="flex items-center justify-center p-1.5 bg-gradient-to-br from-amber-200 to-amber-500 rounded-lg shadow-lg shadow-amber-500/20">
              <Sparkles size={20} className="text-white" />
            </div>
            <h1 className="text-xl font-bold text-foreground tracking-tight">VibeMind</h1>
          </div>
          
          <div className="flex items-center space-x-1">
            <button 
              onClick={(e) => { e.stopPropagation(); handleCreateNote(); }}
              className="p-1.5 hover:bg-primary/10 rounded-lg text-muted-foreground hover:text-primary transition-all duration-300"
              title={t('sidebar.newNote')}
            >
              <FilePlus size={18} />
            </button>
            <button 
              onClick={(e) => { e.stopPropagation(); setIsCreateFolderOpen(true); }}
              className="p-1.5 hover:bg-primary/10 rounded-lg text-muted-foreground hover:text-primary transition-all duration-300"
              title={t('sidebar.newFolder')}
            >
              <FolderPlus size={18} />
            </button>
            {onClose && (
              <button 
                onClick={(e) => { e.stopPropagation(); onClose(); }}
                className="md:hidden p-1.5 hover:bg-secondary rounded-lg text-muted-foreground hover:text-foreground transition-all ml-1"
              >
                <X size={20} />
              </button>
            )}
          </div>
        </div>

        <div className="px-4 pb-4">
          <button 
            onClick={onOpenSearch}
            className="w-full flex items-center justify-between bg-secondary/50 border border-border rounded-lg px-3 py-1.5 text-sm text-muted-foreground hover:border-primary transition-colors"
          >
            <div className="flex items-center">
              <Search size={14} className="mr-2" />
              <span>{t('sidebar.searchPlaceholder')}</span>
            </div>
            <kbd className="text-[10px] bg-background px-1.5 py-0.5 rounded border border-border">⌘K</kbd>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-2 scrollbar-thin">
          {isLoading ? (
            <div className="space-y-2 p-2">
              {[1, 2, 3, 4, 5].map(i => (
                <div key={i} className="h-8 bg-secondary/30 rounded animate-pulse w-full"></div>
              ))}
            </div>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              {renderTree(undefined)}
            </DndContext>
          )}
        </div>

        <div className="p-4 border-t border-border/50 flex flex-col space-y-1">
          <button 
            onClick={onOpenSettings}
            className="flex items-center w-full px-2 py-2 text-muted-foreground hover:text-foreground hover:bg-secondary rounded-lg transition-colors"
          >
            <SettingsIcon size={18} className="mr-2" />
            <span className="text-sm">{t('sidebar.settings')}</span>
          </button>
          {((import.meta as any).env.VITE_APP_TARGET === 'desktop') && (
            <button 
              onClick={() => window.dispatchEvent(new CustomEvent('force-sync'))}
              className="flex items-center w-full px-2 py-2 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-lg transition-colors"
            >
              <RefreshCw size={18} className="mr-2" />
              <span className="text-sm">{t('settings.syncNow') || 'Sync Now'}</span>
            </button>
          )}
          <button 
            onClick={onLogout}
            className="flex items-center w-full px-2 py-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg transition-colors"
          >
            <LogOut size={18} className="mr-2" />
            <span className="text-sm">{t('sidebar.logout') || 'Logout'}</span>
          </button>
        </div>
        
        {/* Context Menu */}
        {contextMenu && createPortal(
          <div 
            className="fixed bg-popover border border-border rounded-lg shadow-xl z-[9999] py-1 min-w-[150px]"
            style={{ top: contextMenu.y, left: contextMenu.x }}
            onClick={(e) => e.stopPropagation()}
          >
            {contextMenu.type === 'note' && (
              <>
                  <button 
                    onClick={() => handleTogglePin(contextMenu.id)}
                    className="w-full flex items-center px-4 py-2 text-sm text-popover-foreground hover:bg-secondary hover:text-foreground transition-colors"
                  >
                    {notes.find(n => n.id === contextMenu.id)?.isPinned ? (
                      <><PinOff size={14} className="mr-2" /> {t('sidebar.unpin')}</>
                    ) : (
                      <><Pin size={14} className="mr-2" /> {t('sidebar.pin')}</>
                    )}
                  </button>
                  {(notes.find(n => n.id === contextMenu.id)?.permission !== 'read') && (
                    <button 
                      onClick={() => {
                        setMovingNoteId(contextMenu.id);
                        setContextMenu(null);
                      }}
                      className="w-full flex items-center px-4 py-2 text-sm text-popover-foreground hover:bg-secondary hover:text-foreground transition-colors"
                    >
                      <FolderInput size={14} className="mr-2" /> {t('sidebar.moveTo')}
                    </button>
                  )}
                  {(notes.find(n => n.id === contextMenu.id)?.permission === 'owner') && (
                    <button 
                      onClick={() => handleShareClick('note', contextMenu.id)}
                      className="w-full flex items-center px-4 py-2 text-sm text-popover-foreground hover:bg-secondary hover:text-foreground transition-colors"
                    >
                      <Share2 size={14} className="mr-2" /> {t('sidebar.share')}
                    </button>
                  )}
              </>
            )}
            {contextMenu.type === 'folder' && (
              <>
                  {(folders.find(f => f.id === contextMenu.id)?.permission !== 'read') && (
                    <button 
                      onClick={() => {
                        const folder = folders.find(f => f.id === contextMenu.id);
                        if (folder) {
                          setRenameValue(folder.name);
                          setRenamingFolderId(folder.id);
                        }
                        setContextMenu(null);
                      }}
                      className="w-full flex items-center px-4 py-2 text-sm text-popover-foreground hover:bg-secondary hover:text-foreground transition-colors"
                    >
                      <Edit2 size={14} className="mr-2" /> {t('sidebar.rename')}
                    </button>
                  )}
                  {(folders.find(f => f.id === contextMenu.id)?.permission === 'owner') && (
                    <button 
                      onClick={() => handleShareClick('folder', contextMenu.id)}
                      className="w-full flex items-center px-4 py-2 text-sm text-popover-foreground hover:bg-secondary hover:text-foreground transition-colors"
                    >
                      <Share2 size={14} className="mr-2" /> {t('sidebar.share')}
                    </button>
                  )}
              </>
            )}
            {((contextMenu.type === 'note' && notes.find(n => n.id === contextMenu.id)?.permission === 'owner') || 
              (contextMenu.type === 'folder' && folders.find(f => f.id === contextMenu.id)?.permission === 'owner')) && (
              <button 
                onClick={() => {
                  if (contextMenu.type === 'note') onDeleteNote(contextMenu.id);
                  else onDeleteFolder(contextMenu.id);
                  setContextMenu(null);
                }}
                className="w-full flex items-center px-4 py-2 text-sm text-destructive hover:bg-destructive/10 transition-colors"
              >
                <Trash2 size={14} className="mr-2" /> {t('sidebar.delete')}
              </button>
            )}
          </div>,
          document.body
        )}
      </motion.div>

      {/* Move Note Modal */}
      {movingNoteId && createPortal(
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-[9999] flex items-center justify-center">
          <div className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-border/50">
              <h2 className="text-lg font-bold text-foreground">{t('sidebar.moveNoteTitle')}</h2>
            </div>
            <div className="p-4 max-h-[300px] overflow-y-auto scrollbar-thin">
              <button 
                onClick={() => handleMoveNote(undefined)}
                className="w-full flex items-center px-4 py-2 text-sm text-foreground hover:bg-secondary rounded-lg transition-colors"
              >
                <Folder size={16} className="mr-2 text-muted-foreground" /> {t('sidebar.root')}
              </button>
              {folders.map(f => (
                <button 
                  key={f.id}
                  onClick={() => handleMoveNote(f.id)}
                  className="w-full flex items-center px-4 py-2 text-sm text-foreground hover:bg-secondary rounded-lg transition-colors mt-1"
                >
                  <Folder size={16} className="mr-2 text-primary" /> {f.name}
                </button>
              ))}
            </div>
            <div className="px-6 py-4 border-t border-border/50 flex justify-end">
              <button 
                onClick={() => setMovingNoteId(null)}
                className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                {t('sidebar.cancel')}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      <CreateFolderModal 
        isOpen={isCreateFolderOpen} 
        onClose={() => setIsCreateFolderOpen(false)} 
        onCreate={handleCreateFolder}
        parentId={selectedFolderId}
      />

      {/* Toast Notification */}
      <AnimatePresence>
        {toastMessage && createPortal(
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground px-4 py-2 rounded-full shadow-lg z-[9999] text-sm font-medium"
          >
            {toastMessage}
          </motion.div>,
          document.body
        )}
      </AnimatePresence>
    </>
  );
}
