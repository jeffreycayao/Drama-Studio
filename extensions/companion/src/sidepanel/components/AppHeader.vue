<script setup lang="ts">
import { IconBrandDiscord, IconHelpCircle } from '@tabler/icons-vue';

defineProps<{
  version: string;
  description: string;
}>();

const emit = defineEmits<{
  help: [];
  community: [];
}>();
</script>

<template>
  <header class="reference-header" :title="description">
    <h1 class="reference-header__identity">
      <img
        class="brand-mark"
        src="/brand/drama-studio-mark-64.png"
        alt=""
        width="20"
        height="20"
      />
      <span class="wordmark"
        >Drama Studio<sup class="wordmark__tm">™</sup></span
      >
      <strong class="reference-header__owner">Companion</strong>
    </h1>

    <div class="reference-header__tools">
      <span class="version-pill">v{{ version }}</span>
      <button
        class="header-tool header-tool--icon"
        type="button"
        aria-label="How the Companion works"
        title="How the Companion works"
        @click="emit('help')"
      >
        <IconHelpCircle :size="17" aria-hidden="true" />
      </button>
      <button
        class="header-tool header-tool--icon"
        type="button"
        aria-label="Open the Drama Studio Discord"
        title="Drama Studio Discord"
        @click="emit('community')"
      >
        <IconBrandDiscord :size="17" aria-hidden="true" />
      </button>
    </div>
    <p class="visually-hidden">{{ description }}</p>
  </header>
</template>
