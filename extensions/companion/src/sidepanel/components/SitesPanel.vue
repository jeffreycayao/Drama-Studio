<script setup lang="ts">
import { IconExternalLink, IconWorld } from '@tabler/icons-vue';

import { t } from '../i18n';
import { SITE_CATALOG, kindsLabel } from '../site-catalog';

/** Opens a supported site in a new tab. The URLs come from AI_SITES only. */
async function openSite(url: string): Promise<void> {
  await chrome.tabs.create({ url });
}
</script>

<template>
  <section class="sites" aria-labelledby="sites-title">
    <h2 id="sites-title" class="sites__title">
      <IconWorld :size="17" aria-hidden="true" />
      {{ t('sitesTitle') }}
    </h2>
    <p class="sites__intro">{{ t('sitesIntro') }}</p>
    <ul class="sites__list">
      <li
        v-for="site in SITE_CATALOG"
        :key="site.id"
        class="sites__item"
        :data-site-id="site.id"
      >
        <div class="sites__head">
          <span class="sites__name">{{ site.label }}</span>
          <span class="sites__kinds">{{ kindsLabel(site.kinds) }}</span>
          <button
            class="button small sites__open"
            type="button"
            :aria-label="`Open ${site.label}`"
            @click="openSite(site.url)"
          >
            Open
            <IconExternalLink :size="13" aria-hidden="true" />
          </button>
        </div>
        <ul class="sites__features">
          <li v-for="feature in site.features" :key="feature">{{ feature }}</li>
        </ul>
      </li>
    </ul>
    <p class="sites__note">{{ t('sitesNote') }}</p>
  </section>
</template>

<style scoped>
.sites {
  display: grid;
  gap: 10px;
}
.sites__title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-family: var(--font-display);
  font-size: 15px;
}
.sites__intro,
.sites__note {
  margin: 0;
  color: var(--muted);
  font-size: 12.5px;
  line-height: 1.45;
}
.sites__note {
  color: var(--subtle);
}
.sites__list {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.sites__item {
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
}
.sites__head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.sites__name {
  font-weight: 600;
  font-size: 13px;
}
.sites__kinds {
  color: var(--subtle);
  font-family: var(--font-meta);
  font-size: 10.5px;
}
.sites__open {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
}
.sites__features {
  margin: 6px 0 0;
  padding-left: 16px;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.5;
}
</style>
