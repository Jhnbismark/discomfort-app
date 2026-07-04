import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// self-hosted JetBrains Mono — the brand mono the CSS stack asks for
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/700.css';
import './index.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

// PWA: install-to-home-screen + cached shell (production only — the dev
// server must never be shadowed by a service worker)
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js');
  });
}
