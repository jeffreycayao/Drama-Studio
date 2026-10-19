<script setup lang="ts">
import {
  IconAlertCircle,
  IconCircleX,
  IconHandStop,
  IconDownload,
  IconListDetails,
  IconRefresh,
  IconTrash,
} from '@tabler/icons-vue';
import { computed } from 'vue';
import type { DeepReadonly } from 'vue';

import type { GenerationProgress, PromptGroup } from '../types';

const props = withDefaults(
  defineProps<{
    groups: readonly DeepReadonly<PromptGroup>[];
    progress: Readonly<Record<string, GenerationProgress>>;
    minHeight?: number;
  }>(),
  { minHeight: 180 },
);

const emit = defineEmits<{ cancel: [groupId: string]; clear: [] }>();
const activeCount = computed(
  () =>
    props.groups.filter(
      (group) => group.status === 'queued' || group.status === 'running',
    ).length,
);

function statusFor(group: DeepReadonly<PromptGroup>, index: number): string {
  const result = group.results.find(
    (candidate) => (candidate.index ?? candidate.promptIndex - 1) === index,
  );
  if (result) {
    if (!result.success) return 'error';
    return result.downloadComplete || group.status === 'completed'
      ? 'completed'
      : 'submitted';
  }
  if (group.status === 'running' && group.currentPromptIndex === index)
    return 'running';
  if ((group.downloadRetryCountByIndex[String(index)] ?? 0) > 0)
    return 'retrying';
  return 'pending';
}

function percentFor(group: DeepReadonly<PromptGroup>, index: number): number {
  const promptIndex = group.promptIndices[index] ?? index + 1;
  return props.progress[`${group.id}:${promptIndex}`]?.percentage ?? 0;
}

function automationRetriesFor(
  group: DeepReadonly<PromptGroup>,
  index: number,
): number {
  return group.retryCountByIndex[String(index)] ?? 0;
}

function downloadRetriesFor(
  group: DeepReadonly<PromptGroup>,
  index: number,
): number {
  return group.downloadRetryCountByIndex[String(index)] ?? 0;
}

function retryTotal(values: Readonly<Record<string, number>>): number {
  return Object.values(values).reduce((total, count) => total + count, 0);
}

function errorFor(group: DeepReadonly<PromptGroup>, index: number): string {
  const result = group.results.find(
    (candidate) => (candidate.index ?? candidate.promptIndex - 1) === index,
  );
  return result && !result.success
    ? (result.error ?? 'This prompt failed without an error message.')
    : '';
}

function groupErrors(group: DeepReadonly<PromptGroup>): string[] {
  const errors = group.results
    .filter((result) => !result.success)
    .map((result) => result.error)
    .filter((message): message is string => Boolean(message));
  const unique = [...new Set(errors)];
  if (group.stop) return [];
  if (group.status === 'error' && unique.length === 0) {
    unique.push(
      'This batch stopped with an error. Review Debug Logs for details.',
    );
  }
  return unique;
}
</script>

<template>
  <section
    class="reference-queue"
    :style="groups.length > 0 ? { minHeight: `${minHeight}px` } : undefined"
  >
    <header>
      <h2>
        <IconListDetails :size="18" aria-hidden="true" />
        Prompt Queue
      </h2>
      <span>{{ activeCount }} active</span>
    </header>

    <div
      v-if="groups.length === 0"
      class="queue-empty"
      role="status"
      aria-label="No prompts queued yet"
    />

    <details
      v-for="group in groups"
      :key="group.id"
      class="reference-queue__group"
      :open="group.status === 'running' || group.status === 'queued'"
    >
      <summary>
        <span class="status-dot" :data-status="group.status" />
        <strong
          >{{ group.processedCount }}/{{ group.totalCount }} processed</strong
        >
        <span>{{ group.status }}</span>
      </summary>
      <div class="reference-queue__items">
        <div class="queue-group-diagnostics" aria-label="Batch retry counts">
          <span>
            <IconRefresh :size="13" aria-hidden="true" />
            {{ retryTotal(group.retryCountByIndex) }} prompt retries
          </span>
          <span>
            <IconDownload :size="13" aria-hidden="true" />
            {{ retryTotal(group.downloadRetryCountByIndex) }} download retries
          </span>
        </div>
        <div v-if="group.stop" class="queue-group-stop" role="alert">
          <IconHandStop :size="16" aria-hidden="true" />
          <div>
            <strong>Batch stopped</strong>
            <p>{{ group.stop.message }}</p>
          </div>
        </div>
        <div
          v-if="groupErrors(group).length"
          class="queue-group-errors"
          role="alert"
        >
          <IconAlertCircle :size="15" aria-hidden="true" />
          <div>
            <strong>Batch errors</strong>
            <p v-for="message in groupErrors(group)" :key="message">
              {{ message }}
            </p>
          </div>
        </div>
        <article
          v-for="(preview, index) in group.promptPreviews"
          :key="`${group.id}-${index}`"
        >
          <span class="queue-index">{{
            group.promptIndices[index] ?? index + 1
          }}</span>
          <span class="queue-preview" :title="preview">{{ preview }}</span>
          <span class="mini-status">{{ statusFor(group, index) }}</span>
          <div
            v-if="
              automationRetriesFor(group, index) > 0 ||
              downloadRetriesFor(group, index) > 0
            "
            class="queue-item-retries"
          >
            <span v-if="automationRetriesFor(group, index) > 0">
              <IconRefresh :size="12" aria-hidden="true" />
              Prompt retries: {{ automationRetriesFor(group, index) }}
            </span>
            <span v-if="downloadRetriesFor(group, index) > 0">
              <IconDownload :size="12" aria-hidden="true" />
              Download retries: {{ downloadRetriesFor(group, index) }}
            </span>
          </div>
          <p
            v-if="errorFor(group, index)"
            class="queue-item-error"
            role="alert"
          >
            <IconAlertCircle :size="13" aria-hidden="true" />
            {{ errorFor(group, index) }}
          </p>
          <div v-if="percentFor(group, index) > 0" class="progress-track">
            <span :style="{ width: `${percentFor(group, index)}%` }" />
          </div>
        </article>
        <p v-if="group.delayRemainingSeconds" class="queue-delay">
          Next prompt in {{ group.delayRemainingSeconds }}s
        </p>
        <button
          v-if="group.status === 'queued' || group.status === 'running'"
          class="queue-cancel"
          type="button"
          :disabled="group.isCancelling"
          @click="emit('cancel', group.id)"
        >
          <IconCircleX :size="15" aria-hidden="true" />
          {{ group.isCancelling ? 'Cancelling…' : 'Cancel batch' }}
        </button>
      </div>
    </details>

    <button
      v-if="groups.length"
      class="queue-clear"
      type="button"
      @click="emit('clear')"
    >
      <IconTrash :size="15" aria-hidden="true" />
      Clear completed
    </button>
  </section>
</template>
