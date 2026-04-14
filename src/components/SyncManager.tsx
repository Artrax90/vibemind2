import React, { useEffect, useCallback } from 'react';
import { useSync } from '../contexts/SyncContext';

type SyncManagerProps = {
  onSyncComplete?: () => void;
};

export default function SyncManager({ onSyncComplete }: SyncManagerProps) {
  const isElectron = !!(window as any).electronAPI;
  const { setStatus, setLastSync, setProgress } = useSync();

  const log = (msg: string, isError = false) => {
    const timestamp = new Date().toLocaleTimeString();
    const formattedMsg = `[${timestamp}] ${msg}`;
    if (isError) console.error(formattedMsg);
    else console.log(formattedMsg);
    
    if (!(window as any).syncLogs) (window as any).syncLogs = [];
    (window as any).syncLogs.push(formattedMsg);
    if ((window as any).syncLogs.length > 100) (window as any).syncLogs.shift();
  };

  const performSync = useCallback(async () => {
    if (!isElectron) return;

    try {
      const config = await (window as any).electronAPI.getSyncConfig();
      if (!config.server_url || !config.username || !config.password) {
        log('Sync skipped: Missing configuration');
        return;
      }

      const baseUrl = config.server_url.replace(/\/$/, ''); // Remove trailing slash
      setStatus('syncing');
      setProgress(0, 0);
      log(`Authenticating for sync at ${baseUrl}...`);
      
      const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: config.username, password: config.password }),
      });

      if (!loginRes.ok) {
        const errorText = await loginRes.text();
        log(`Sync authentication failed: ${loginRes.status} ${errorText}`, true);
        setStatus('error');
        return;
      }

      const { access_token } = await loginRes.json();
      log('Starting background sync...');
      
      // 1. Get local notes that are dirty
      const localNotes = await (window as any).electronAPI.getNotes();
      const dirtyNotes = localNotes.filter((n: any) => n.is_dirty === 1);

      // 2. Pull updates from server to know total
      const res = await fetch(`${baseUrl}/api/notes`, {
        headers: { 'Authorization': `Bearer ${access_token}` }
      });
      
      if (!res.ok) throw new Error(`Failed to fetch remote notes: ${res.status}`);
      const remoteNotes = await res.json();

      const totalToSync = dirtyNotes.length + remoteNotes.length;
      let currentSynced = 0;
      setProgress(totalToSync, 0);

      // 3. Push dirty notes to server
      for (const note of dirtyNotes) {
        try {
          const res = await fetch(`${baseUrl}/api/notes/${note.id}`, {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${access_token}`
            },
            body: JSON.stringify({
              title: note.title,
              content: note.content,
              folderId: note.folderId,
              isPinned: note.isPinned === 1
            })
          });

          if (res.ok) {
            await (window as any).electronAPI.saveNote({ ...note, is_dirty: 0 });
            log(`Pushed note: ${note.title}`);
          } else {
            log(`Failed to push note ${note.title}: ${res.status}`, true);
          }
          currentSynced++;
          setProgress(totalToSync, currentSynced);
        } catch (e) {
          log(`Failed to push note ${note.id}: ${e}`, true);
        }
      }

      // 4. Pull updates from server
      let hasChanges = false;
      for (const remoteNote of remoteNotes) {
        const localNote = localNotes.find((n: any) => n.id === remoteNote.id);
        
        if (!localNote || (new Date(remoteNote.updated_at) > new Date(localNote.updated_at) && localNote.is_dirty === 0)) {
          await (window as any).electronAPI.saveNote({
            id: remoteNote.id,
            title: remoteNote.title,
            content: remoteNote.content,
            folderId: remoteNote.folderId,
            isPinned: remoteNote.isPinned ? 1 : 0,
            is_dirty: 0,
            updated_at: remoteNote.updated_at
          });
          log(`Pulled note: ${remoteNote.title}`);
          hasChanges = true;
        }
        currentSynced++;
        setProgress(totalToSync, currentSynced);
      }

      if (hasChanges && onSyncComplete) {
        onSyncComplete();
      }

      setStatus('success');
      setLastSync(new Date());
      log('Sync completed.');
      
      // Reset status to idle after 3 seconds
      setTimeout(() => setStatus('idle'), 3000);
    } catch (e) {
      log(`Sync error: ${e}`, true);
      setStatus('error');
    }
  }, [isElectron, onSyncComplete, setStatus, setLastSync, setProgress]);

  useEffect(() => {
    if (!isElectron) return;

    performSync();

    const handleForceSync = () => {
      log('Force sync requested');
      performSync();
    };

    window.addEventListener('force-sync', handleForceSync);

    const interval = setInterval(performSync, 5 * 60 * 1000);
    return () => {
      clearInterval(interval);
      window.removeEventListener('force-sync', handleForceSync);
    };
  }, [isElectron, performSync]);

  return null;
}
