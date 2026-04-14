import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import '../index.css';
import { LanguageProvider } from '../contexts/LanguageContext';
import { SyncProvider } from '../contexts/SyncContext';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <LanguageProvider>
      <SyncProvider>
        <App />
      </SyncProvider>
    </LanguageProvider>
  </React.StrictMode>
);
