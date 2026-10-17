<script setup lang="ts">
defineProps<{
  version: string;
}>();

const badgePath = '/badges/version.svg';
</script>

<template>
  <footer class="app-footer" aria-label="Application information">
    <img
      class="app-footer__badge"
      :src="badgePath"
      :alt="`Grok Automator™ version ${version}`"
      width="90"
      height="20"
      decoding="async"
    />
    <p class="app-footer__legal">© 2026 PAKS LLC. ALL RIGHTS RESERVED.</p>
  </footer>
</template>
