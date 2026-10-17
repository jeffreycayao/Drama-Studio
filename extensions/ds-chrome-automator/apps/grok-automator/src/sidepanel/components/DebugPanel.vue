<script setup lang="ts">
import { IconCopy, IconTrash } from '@tabler/icons-vue';
import { nextTick, ref, watch } from 'vue';

import type { LogEntry } from '../types';

const props = defineProps<{ logs: readonly LogEntry[] }>();
const emit = defineEmits<{ clear: [] }>();
const autoScroll = ref(true);
const copied = ref(false);
const logViewport = ref<HTMLElement | null>(null);

watch(
  () => props.logs.length,
  async () => {
    if (!autoScroll.value) return;
    await nextTick();
    logViewport.value?.scrollTo({ top: logViewport.value.scrollHeight });
  },
);

async function copyLogs(): Promise<void> {
  if (!props.logs.length) return;
  const text = props.logs
    .map(
      (entry) =>
        `[${new Date(entry.timestamp).toISOString()}] ${entry.level.toUpperCase()} ${entry.message}`,
    )
    .join('\n');
  await navigator.clipboard.writeText(text);
  copied.value = true;
  window.setTimeout(() => (copied.value = false), 1500);
}
</script>

<template>
  <section class="reference-debug">
    <div class="debug-toolbar">
      <span
        >{{ logs.length }} {{ logs.length === 1 ? 'entry' : 'entries' }}</span
      >
      <label class="switch-label">
        Auto-scroll
        <input v-model="autoScroll" type="checkbox" role="switch" />
      </label>
      <button type="button" :disabled="logs.length === 0" @click="copyLogs">
        <IconCopy :size="16" aria-hidden="true" />
        {{ copied ? 'Copied' : 'Copy' }}
      </button>
      <button
        type="button"
        :disabled="logs.length === 0"
        @click="emit('clear')"
      >
        <IconTrash :size="16" aria-hidden="true" />
        Clear
      </button>
    </div>

    <div
      ref="logViewport"
      class="reference-log-list"
      role="log"
      aria-live="polite"
    >
      <p v-if="logs.length === 0" class="reference-empty-state">
        No logs yet. Start an automation to see activity here.
      </p>
      <article
        v-for="(entry, index) in logs"
        :key="`${entry.timestamp}-${index}`"
        class="reference-log-entry"
        :data-level="entry.level"
      >
        <time>{{ new Date(entry.timestamp).toLocaleTimeString() }}</time>
        <strong>{{ entry.level }}</strong>
        <span>{{ entry.message }}</span>
      </article>
    </div>
  </section>
</template>
