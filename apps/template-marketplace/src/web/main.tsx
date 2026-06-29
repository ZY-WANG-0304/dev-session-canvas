import React from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import './styles.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Template marketplace root element is missing.');
}

createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
