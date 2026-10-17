import '@faceless-automations/brand/styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';

import { router } from './app/router';
import { PlatformSettingsProvider } from './platform/PlatformSettingsProvider';
import './styles/app.css';

const root = document.querySelector<HTMLElement>('#root');

if (!root) {
  throw new Error('Paks Tools Faceless automations root element is missing.');
}

createRoot(root).render(
  <StrictMode>
    <PlatformSettingsProvider>
      <RouterProvider router={router} />
    </PlatformSettingsProvider>
  </StrictMode>,
);
