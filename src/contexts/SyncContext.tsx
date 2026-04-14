import React, { createContext, useContext, useState, ReactNode } from 'react';

type SyncStatus = 'idle' | 'syncing' | 'success' | 'error';

interface SyncContextType {
  status: SyncStatus;
  setStatus: (status: SyncStatus) => void;
  lastSync: Date | null;
  setLastSync: (date: Date) => void;
  progress: { total: number; current: number };
  setProgress: (total: number, current: number) => void;
}

const SyncContext = createContext<SyncContextType | undefined>(undefined);

export const SyncProvider = ({ children }: { children: ReactNode }) => {
  const [status, setStatus] = useState<SyncStatus>('idle');
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [progress, setProgressState] = useState({ total: 0, current: 0 });

  const setProgress = (total: number, current: number) => {
    setProgressState({ total, current });
  };

  return (
    <SyncContext.Provider value={{ status, setStatus, lastSync, setLastSync, progress, setProgress }}>
      {children}
    </SyncContext.Provider>
  );
};

export const useSync = () => {
  const context = useContext(SyncContext);
  if (!context) {
    throw new Error('useSync must be used within a SyncProvider');
  }
  return context;
};
