<script setup lang="ts">
import {
  IconAlertTriangle,
  IconCheck,
  IconCircleCheck,
  IconInfoCircle,
  IconX,
} from '@tabler/icons-vue';

defineProps<{ visible: boolean }>();
const emit = defineEmits<{ close: []; dismissForever: [] }>();

function onBackdrop(event: MouseEvent): void {
  if (event.currentTarget === event.target) emit('close');
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') emit('close');
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      class="tip-backdrop"
      @click="onBackdrop"
      @keydown="onKeydown"
    >
      <section
        class="tip-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tip-modal-title"
      >
        <header>
          <h2 id="tip-modal-title">Tips Before You Use</h2>
          <button type="button" aria-label="Close tips" @click="emit('close')">
            <IconX :size="21" aria-hidden="true" />
          </button>
        </header>

        <div class="tip-modal__body">
          <section class="plan-advisory">
            <strong>Make sure you have one of these Grok plans:</strong>
            <ul>
              <li>
                <IconCircleCheck :size="18" aria-hidden="true" /> Super Grok
                Lite
              </li>
              <li>
                <IconCircleCheck
                  class="recommended-check"
                  :size="18"
                  aria-hidden="true"
                />
                Super Grok (3-day free trial available)
                <span>Recommended</span>
              </li>
              <li>
                <IconCircleCheck :size="18" aria-hidden="true" /> Grok Heavy
              </li>
            </ul>
          </section>

          <section class="caution-advisory">
            <strong>Good to know:</strong>
            <p>
              <IconAlertTriangle :size="18" aria-hidden="true" />
              Grok strictly limits the number of 720p videos you can generate.
            </p>
            <p>
              <IconAlertTriangle :size="18" aria-hidden="true" />
              If automation does not work as expected, check that your internet
              is stable and that your prompts and images comply with Grok's
              policies.
            </p>
          </section>
        </div>

        <footer>
          <button class="tip-confirm" type="button" @click="emit('close')">
            <IconCheck :size="18" aria-hidden="true" />
            Got it
          </button>
          <button
            class="tip-dismiss"
            type="button"
            @click="emit('dismissForever')"
          >
            <IconInfoCircle :size="18" aria-hidden="true" />
            I understand, don't show again
          </button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>
