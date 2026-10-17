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
          <h2 id="tip-modal-title">Before you start</h2>
          <button type="button" aria-label="Close tips" @click="emit('close')">
            <IconX :size="21" aria-hidden="true" />
          </button>
        </header>

        <div class="tip-modal__body">
          <section class="plan-advisory">
            <strong>How batches work</strong>
            <ul>
              <li>
                <IconCircleCheck :size="18" aria-hidden="true" />
                Use your own signed-in Grok account in a tab you keep open.
              </li>
              <li>
                <IconCircleCheck :size="18" aria-hidden="true" />
                Prompts are sent one after another, with a pause between them.
              </li>
              <li>
                <IconCircleCheck :size="18" aria-hidden="true" />
                Results download to your Downloads folder as they finish.
              </li>
            </ul>
          </section>

          <section class="caution-advisory">
            <strong>When the batch stops</strong>
            <p>
              <IconAlertTriangle :size="18" aria-hidden="true" />
              A CAPTCHA, a usage limit, a moderation message or a sign-in page
              stops the whole batch at once, with no retry. The side panel says
              why.
            </p>
            <p>
              <IconAlertTriangle :size="18" aria-hidden="true" />
              The Companion never solves checks or works around limits. Follow
              Grok's terms and keep batches small.
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
            Got it, don't show again
          </button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>
