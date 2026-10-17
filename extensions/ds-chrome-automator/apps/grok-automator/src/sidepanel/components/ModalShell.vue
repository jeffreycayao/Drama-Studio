<script setup lang="ts">
import { IconX } from '@tabler/icons-vue';

defineProps<{ title: string; visible: boolean; persistent?: boolean }>();
const emit = defineEmits<{ close: [] }>();

function onBackdrop(event: MouseEvent): void {
  if (!event.currentTarget || event.target !== event.currentTarget) return;
  emit('close');
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      class="modal-backdrop"
      @click="persistent ? undefined : onBackdrop($event)"
    >
      <section
        class="modal-card"
        role="dialog"
        aria-modal="true"
        :aria-label="title"
      >
        <header>
          <h2>{{ title }}</h2>
          <button
            v-if="!persistent"
            type="button"
            aria-label="Close"
            @click="emit('close')"
          >
            <IconX :size="20" aria-hidden="true" />
          </button>
        </header>
        <div class="modal-body"><slot /></div>
        <footer v-if="$slots.footer"><slot name="footer" /></footer>
      </section>
    </div>
  </Teleport>
</template>
