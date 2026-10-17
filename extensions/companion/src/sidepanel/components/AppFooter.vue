<script setup lang="ts">
defineProps<{
  version: string;
}>();
</script>

<template>
  <footer class="app-footer" aria-label="About the Companion">
    <span class="app-footer__version">Companion v{{ version }}</span>
    <p class="app-footer__legal">
      © {{ new Date().getFullYear() }} Drama Studio
    </p>
  </footer>
</template>
