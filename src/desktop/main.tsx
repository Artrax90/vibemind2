import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import '../index.css';
import { LanguageProvider } from '../contexts/LanguageContext';
import { SyncProvider } from '../contexts/SyncContext';
import { initDB } from '../lib/db';

console.log("Desktop renderer process starting...");

let rendered = false;
const timer = setTimeout(() => {
  if (!rendered) {
    const rootEl = document.getElementById('root');
    if (rootEl) {
      rootEl.innerHTML = '<div style="padding: 20px; color: red;"><h1>Hanging Detected</h1><p>The app is taking too long to initialize. Check the console for errors.</p></div>';
    }
  }
}, 2000);

initDB().then(() => {
  console.log("initDB completed successfully");
}).catch(err => {
  console.error("Critical: initDB failed", err);
}).finally(() => {
  console.log("Rendering application...");
  const rootEl = document.getElementById('root');
  if (!rootEl) {
    console.error("Fatal: #root element not found!");
    return;
  }
  
  try {
    ReactDOM.createRoot(rootEl).render(
      <React.StrictMode>
        <LanguageProvider>
          <SyncProvider>
            <App />
          </SyncProvider>
        </LanguageProvider>
      </React.StrictMode>
    );
    rendered = true;
    clearTimeout(timer);
    console.log("Application rendered.");
  } catch (renderError) {
    console.error("Fatal render error:", renderError);
    rootEl.innerHTML = `<div style="padding: 20px; color: red;"><h1>Render Error</h1><pre>${renderError}</pre></div>`;
  }
});
