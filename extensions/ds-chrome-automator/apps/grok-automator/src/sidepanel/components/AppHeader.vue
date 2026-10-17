<script setup lang="ts">
import { IconBook2, IconLanguage, IconMessageCircle } from '@tabler/icons-vue';

defineProps<{
  title?: string;
  version: string;
  description?: string;
  locale: string;
  locales: readonly string[];
}>();

const emit = defineEmits<{
  'update:locale': [locale: string];
  guide: [];
  community: [];
}>();

function changeLocale(event: Event): void {
  emit('update:locale', (event.target as HTMLSelectElement).value);
}
</script>

<template>
  <header class="reference-header">
    <div class="reference-header__identity">
      <h1>
        {{ title ?? 'Grok Automator™' }}
        <span class="version-pill">v{{ version }}</span>
      </h1>
      <p>{{ description ?? 'Batch automation for Grok Imagine.' }}</p>
      <strong class="reference-header__owner"
        >Paks Tools Faceless automations</strong
      >
    </div>

    <div class="reference-header__tools">
      <button
        class="header-tool"
        type="button"
        aria-label="Open user guide"
        @click="emit('guide')"
      >
        <IconBook2 :size="18" aria-hidden="true" />
        <span>User<br />Guide</span>
      </button>
      <button
        class="header-tool header-tool--icon"
        type="button"
        aria-label="Open Paks Tools Faceless automations community"
        @click="emit('community')"
      >
        <IconMessageCircle :size="19" aria-hidden="true" />
      </button>
      <label class="locale-select">
        <IconLanguage :size="16" aria-hidden="true" />
        <span class="visually-hidden">Language</span>
        <select :value="locale" @change="changeLocale">
          <option v-for="item in locales" :key="item" :value="item">
            {{ item === 'en' ? 'English' : item.toUpperCase() }}
          </option>
        </select>
      </label>
    </div>
  </header>
</template>
