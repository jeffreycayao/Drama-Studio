import { createApp } from 'vue';

import '@faceless-automations/brand/styles.css';

import App from '../../src/sidepanel/App.vue';
import { initializeLocale } from '../../src/sidepanel/i18n';
import '../../src/sidepanel/styles.css';

async function mountSidePanel(): Promise<void> {
  try {
    await initializeLocale();
  } finally {
    createApp(App).mount('#app');
  }
}

void mountSidePanel();
