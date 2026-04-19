import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import '../index.css';
import { LanguageProvider } from '../contexts/LanguageContext';
import { SyncProvider } from '../contexts/SyncContext';
import { initDB } from '../lib/db';

initDB().catch(err => {
  console.error("Critical: initDB failed", err);
}).finally(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <LanguageProvider>
        <SyncProvider>
          <App />
        </SyncProvider>
      </LanguageProvider>
    </React.StrictMode>
  );
});
