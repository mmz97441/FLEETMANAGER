import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import ToastHost from './components/ToastHost';
import './index.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
    {/* Affichage global des messages + gardes window.onerror / unhandledrejection.
        Monté hors de <App/> pour rester actif même si l'ErrorBoundary bascule. */}
    <ToastHost />
  </React.StrictMode>
);