import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SettingsPage } from '@/features/settings/settings-page';
import '@/features/theme/tokens.css';
import './style.css';

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root in options.html');

createRoot(container).render(
  <StrictMode>
    <SettingsPage />
  </StrictMode>,
);
