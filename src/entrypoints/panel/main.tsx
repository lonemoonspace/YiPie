import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { resolveLocale } from '@/domain/i18n/locale';
import { applyLocale } from '@/features/i18n/locale';
import { PanelApp } from '@/features/panel/panel-app';
import '@/features/theme/tokens.css';
import './style.css';

// The browser's language until the panel is attached and reads the settings,
// which may name another (features/panel/use-panel.ts).
applyLocale(resolveLocale('auto', navigator.language));

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root in panel.html');

createRoot(container).render(
  <StrictMode>
    <PanelApp />
  </StrictMode>,
);
