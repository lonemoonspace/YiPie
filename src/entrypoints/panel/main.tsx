import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PanelApp } from '@/features/panel/panel-app';
import '@/features/theme/tokens.css';
import './style.css';

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root in panel.html');

createRoot(container).render(
  <StrictMode>
    <PanelApp />
  </StrictMode>,
);
