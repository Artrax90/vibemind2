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

  const isSyncingRef = React.useRef(false);

  const performSync = useCallback(async () => {
    if (!isElectron || isSyncingRef.current) return;

    try {
      isSyncingRef.current = true;
      const config = await (window as any).electronAPI.getSyncConfig();
      if (!config.server_url || !config.username || !config.password) {
        log('Sync skipped: Missing configuration');
        return;
      }

      let baseUrl = config.server_url.trim().replace(/\/$/, '');
      if (baseUrl && !baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
        baseUrl = 'http://' + baseUrl;
      }
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
      log('Authentication successful. Starting background sync...');
      
      // 1. Get local data
      const [localNotes, localFolders] = await Promise.all([
        (window as any).electronAPI.getNotes(),
        (window as any).electronAPI.getFolders()
      ]);
      
      const dirtyNotes = localNotes.filter((n: any) => n.is_dirty === 1);
      const dirtyFolders = localFolders.filter((f: any) => f.is_dirty === 1);
      log(`Found ${dirtyNotes.length} notes and ${dirtyFolders.length} folders to push.`);

      // 2. Pull updates from server
      log('Fetching remote data...');
      const [notesRes, foldersRes] = await Promise.all([
        fetch(`${baseUrl}/api/notes`, { headers: { 'Authorization': `Bearer ${access_token}` } }),
        fetch(`${baseUrl}/api/folders`, { headers: { 'Authorization': `Bearer ${access_token}` } })
      ]);
      
      if (!notesRes.ok) throw new Error(`Failed to fetch remote notes: ${notesRes.status}`);
      if (!foldersRes.ok) throw new Error(`Failed to fetch remote folders: ${foldersRes.status}`);
      
      const remoteNotes = await notesRes.json();
      const remoteFolders = await foldersRes.json();

      const totalToSync = dirtyNotes.length + dirtyFolders.length + remoteNotes.length + remoteFolders.length;
      let currentSynced = 0;
      setProgress(totalToSync, 0);

      // 3. Push dirty folders first
      for (const folder of dirtyFolders) {
        try {
          const res = await fetch(`${baseUrl}/api/folders`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${access_token}`
            },
            body: JSON.stringify({
              id: folder.id,
              name: folder.name,
              parentId: folder.parentId,
              updated_at: folder.updated_at
            })
          });

          if (res.ok) {
            await (window as any).electronAPI.saveFolder({ ...folder, is_dirty: 0 });
            log(`Pushed folder: ${folder.name}`);
          }
          currentSynced++;
          setProgress(totalToSync, currentSynced);
        } catch (e) {
          log(`Failed to push folder ${folder.id}: ${e}`, true);
        }
      }

      // 4. Push dirty notes
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
              isPinned: note.isPinned === 1,
              updated_at: note.updated_at
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

      // 5. Pull updates from server
      let hasChanges = false;

      // Pull folders first
      for (const remoteFolder of remoteFolders) {
        const localFolder = localFolders.find((f: any) => f.id === remoteFolder.id);
        const remoteDate = remoteFolder.updated_at ? new Date(remoteFolder.updated_at) : new Date(0);
        const localDate = localFolder?.updated_at ? new Date(localFolder.updated_at) : new Date(0);

        if (!localFolder || (remoteDate > localDate && localFolder.is_dirty === 0)) {
          await (window as any).electronAPI.saveFolder({
            id: remoteFolder.id,
            name: remoteFolder.name,
            parentId: remoteFolder.parentId,
            is_dirty: 0,
            updated_at: remoteFolder.updated_at || new Date().toISOString()
          });
          log(`Pulled folder: ${remoteFolder.name}`);
          hasChanges = true;
        }
        currentSynced++;
        setProgress(totalToSync, currentSynced);
      }

      // Pull notes
      for (const remoteNote of remoteNotes) {
        const localNote = localNotes.find((n: any) => n.id === remoteNote.id);
        
        const remoteDate = remoteNote.updated_at ? new Date(remoteNote.updated_at) : new Date(0);
        const localDate = localNote?.updated_at ? new Date(localNote.updated_at) : new Date(0);

        if (!localNote || (remoteDate > localDate && localNote.is_dirty === 0)) {
          await (window as any).electronAPI.saveNote({
            id: remoteNote.id,
            title: remoteNote.title,
            content: remoteNote.content,
            folderId: remoteNote.folderId,
            isPinned: remoteNote.isPinned ? 1 : 0,
            is_dirty: 0,
            updated_at: remoteNote.updated_at || new Date().toISOString()
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
    } finally {
      isSyncingRef.current = false;
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
