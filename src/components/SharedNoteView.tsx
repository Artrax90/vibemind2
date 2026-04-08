import React, { useState, useEffect } from 'react';
import { api } from '../api/client';
import Editor from './Editor';
import { Loader2, AlertCircle } from 'lucide-react';

export default function SharedNoteView({ shareId }: { shareId: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [shareData, setShareData] = useState<any>(null);

  useEffect(() => {
    const loadShare = async () => {
      try {
        const data = await api.getPublicShare(shareId);
        setShareData(data);
      } catch (e: any) {
        setError(e.message || 'Failed to load shared note');
      } finally {
        setLoading(false);
      }
    };
    loadShare();
  }, [shareId]);

  const handleUpdate = async (id: string, updates: any) => {
    if (shareData?.share?.permission !== 'write') return;
    
    // Optimistic update
    setShareData((prev: any) => ({
      ...prev,
      note: { ...prev.note, ...updates }
    }));

    try {
      await api.updatePublicShare(shareId, updates);
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
        <p className="text-muted-foreground">{error || 'Note not found'}</p>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-full bg-background text-foreground">
      <main className="flex-1 flex flex-col relative min-w-0">
        <div className="absolute top-4 right-4 z-10 px-3 py-1 bg-secondary text-secondary-foreground rounded-full text-xs font-medium">
          {shareData.share.permission === 'write' ? 'Public Edit Access' : 'Public Read-Only'}
        </div>
        <Editor 
          note={shareData.note} 
          allNotes={[]}
          onUpdate={handleUpdate} 
          onWikilinkClick={() => {}}
          onTagClick={() => {}}
          isPreview={shareData.share.permission !== 'write'}
        />
      </main>
    </div>
  );
}
