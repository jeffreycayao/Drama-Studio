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
  <header class="reference-header">
    <div class="reference-header__identity">
      <h1>
        <img
          class="brand-mark"
          src="/brand/drama-studio-mark-64.png"
          alt=""
          width="22"
          height="22"
        />
        <span class="wordmark"
          >Drama Studio<sup class="wordmark__tm">™</sup></span
        >
        <span class="version-pill">v{{ version }}</span>
      </h1>
      <strong class="reference-header__owner">Companion</strong>
      <p>{{ description }}</p>
    </div>

    <div class="reference-header__tools">
      <button
        class="header-tool"
        type="button"
        aria-label="How the Companion works"
        @click="emit('help')"
      >
        <IconHelpCircle :size="18" aria-hidden="true" />
        <span>Help</span>
      </button>
      <button
        class="header-tool header-tool--icon"
        type="button"
        aria-label="Open the Drama Studio Discord"
        @click="emit('community')"
      >
        <IconBrandDiscord :size="19" aria-hidden="true" />
      </button>
    </div>
  </header>
</template>
