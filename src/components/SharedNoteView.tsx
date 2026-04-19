import React, { useState, useEffect } from 'react';
import { api } from '../api/client';
import Editor from './Editor';
import { Loader2, AlertCircle, FileText, Folder as FolderIcon, ChevronRight } from 'lucide-react';
import { Note } from '../types';

export default function SharedNoteView({ shareId }: { shareId: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [shareData, setShareData] = useState<any>(null);
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);

  useEffect(() => {
    const loadShare = async () => {
      try {
        const data = await api.getPublicShare(shareId);
        setShareData(data);
        if (data.share.resource_type === 'note') {
          setActiveNoteId(data.note.id);
        } else if (data.share.resource_type === 'folder' && data.notes.length > 0) {
          setActiveNoteId(data.notes[0].id);
        }
      } catch (e: any) {
        setError(e.message || 'Failed to load shared resource');
      } finally {
        setLoading(false);
      }
    };
    loadShare();
  }, [shareId]);

  const handleUpdate = async (id: string, updates: any) => {
    if (shareData?.share?.permission !== 'write') return;
    
    if (shareData.share.resource_type === 'note') {
      setShareData((prev: any) => ({
        ...prev,
        note: { ...prev.note, ...updates }
      }));
    } else {
      setShareData((prev: any) => ({
        ...prev,
        notes: prev.notes.map((n: any) => n.id === id ? { ...n, ...updates } : n)
      }));
    }

    try {
      await api.updatePublicShare(shareId, { ...updates, id });
    } catch (e) {
      console.error('Failed to update shared note', e);
    }
  };

  if (loading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background text-foreground">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !shareData) {
    return (
      <div className="flex h-screen w-full flex-col items-center justify-center bg-background text-foreground space-y-4">
        <AlertCircle className="h-12 w-12 text-destructive" />
        <h2 className="text-xl font-semibold">Error</h2>
        <p className="text-muted-foreground">{error || 'Resource not found'}</p>
      </div>
    );
  }

  const activeNote = shareData.share.resource_type === 'note' 
    ? shareData.note 
    : shareData.notes.find((n: any) => n.id === activeNoteId);

  return (
    <div className="flex h-screen w-full bg-background text-foreground overflow-hidden">
      {shareData.share.resource_type === 'folder' && (
        <aside className="w-64 border-r border-border/50 flex flex-col bg-secondary/10">
          <div className="p-4 border-b border-border/50 flex items-center gap-2">
            <FolderIcon size={18} className="text-primary" />
            <h2 className="font-semibold truncate">{shareData.folder.name}</h2>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {shareData.notes.map((note: any) => (
              <button
                key={note.id}
                onClick={() => setActiveNoteId(note.id)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors flex items-center gap-2 ${
                  activeNoteId === note.id 
                    ? 'bg-primary/10 text-primary' 
                    : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground'
                }`}
              >
                <FileText size={14} />
                <span className="truncate">{note.title}</span>
              </button>
            ))}
            {shareData.notes.length === 0 && (
              <div className="p-4 text-center text-xs text-muted-foreground italic">
                No notes in this folder
              </div>
            )}
          </div>
        </aside>
      )}

      <main className="flex-1 flex flex-col relative min-w-0">
        <div className="absolute top-4 right-4 z-10 px-3 py-1 bg-secondary/80 backdrop-blur-sm text-secondary-foreground rounded-full text-[10px] font-medium border border-border/50">
          {shareData.share.permission === 'write' ? 'Public Edit Access' : 'Public Read-Only'}
        </div>
        
        {activeNote ? (
          <Editor 
            note={activeNote} 
            allNotes={shareData.share.resource_type === 'folder' ? shareData.notes : []}
            onUpdate={handleUpdate} 
            onWikilinkClick={(title) => {
              if (shareData.share.resource_type === 'folder') {
                const target = shareData.notes.find((n: any) => n.title.toLowerCase() === title.toLowerCase());
                if (target) setActiveNoteId(target.id);
              }
            }}
            onTagClick={() => {}}
            isPreview={shareData.share.permission !== 'write'}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            Select a note to view
          </div>
        )}
      </main>
    </div>
  );
}
