<script setup lang="ts">
import {
  IconClock,
  IconFlag,
  IconFolder,
  IconLibraryPhoto,
  IconListNumbers,
  IconPlayerPlay,
  IconRefresh,
  IconRepeat,
  IconToggleLeft,
} from '@tabler/icons-vue';
import { computed, reactive, ref, watch } from 'vue';

import {
  buildPromptPayloadsResult,
  isImageGenerationMode,
  isUploadMode,
  isVideoMode,
  parsePrompts,
  type PromptRange,
} from '../prompt-builder';
import type { SpreadsheetWorkbookModel } from '../spreadsheet-import';
import {
  IMAGE_OPTIONS,
  VIDEO_OPTIONS,
  type AutomationMode,
  type ImageOption,
  type PromptPayload,
  type Settings,
  type UploadedImage,
  type VideoOption,
} from '../types';
import PromptInput from './PromptInput.vue';
import PromptOptions from './PromptOptions.vue';
import SpreadsheetImportModal from './SpreadsheetImportModal.vue';
import UploadedImages from './UploadedImages.vue';
import { MAX_SPREADSHEET_FILE_BYTES } from '../spreadsheet-limits';

const props = defineProps<{
  mode: AutomationMode;
  modelValue: string;
  settings: Settings;
  uploadedImages: UploadedImage[];
  dailyCount: number;
  isPro: boolean;
  isBusy: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: string];
  'update:uploadedImages': [value: UploadedImage[]];
  'update:settings': [settings: Settings];
  queue: [payloads: PromptPayload[]];
  upgrade: [];
  error: [message: string];
  report: [];
  clear: [];
}>();

type PromptOption = VideoOption | ImageOption;

const optionOverrides = reactive<
  Partial<Record<AutomationMode, PromptOption[]>>
>({});
const rangeEnabled = ref(false);
const rangeStart = ref(1);
const rangeEnd = ref(1);
const spreadsheetWorkbook = ref<SpreadsheetWorkbookModel | null>(null);
const showSpreadsheetImport = ref(false);

const prompts = computed(() => parsePrompts(props.modelValue));
const promptCount = computed(() => prompts.value.length);
const uploadMode = computed(() => isUploadMode(props.mode));
const maxImagesForMode = computed(() => {
  if (props.mode === 'imageToVideo')
    return props.settings.imageToVideoMaxImagesPerPrompt;
  if (props.mode === 'componentsToVideo')
    return props.settings.componentsToVideoMaxImagesPerPrompt;
  if (props.mode === 'imageToImage')
    return props.settings.imageToImageMaxImagesPerPrompt;
  return 0;
});
const selectedOptions = computed(() => {
  const fallback = isVideoMode(props.mode)
    ? props.settings.defaultVideoOption
    : props.settings.defaultImageOption;
  const current = optionOverrides[props.mode] ?? [];
  return prompts.value.map((_, index) => current[index] ?? fallback);
});
const optionRecord = computed<Record<number, PromptOption>>(() =>
  Object.fromEntries(
    selectedOptions.value.map((option, index) => [index + 1, option]),
  ),
);
const selectedRange = computed<PromptRange | undefined>(() =>
  rangeEnabled.value
    ? {
        start: Math.max(1, Math.min(rangeStart.value, promptCount.value)),
        end: Math.max(
          Math.max(1, Math.min(rangeStart.value, promptCount.value)),
          Math.min(rangeEnd.value, promptCount.value),
        ),
      }
    : undefined,
);
const previewResult = computed(() =>
  buildPromptPayloadsResult({
    mode: props.mode,
    promptText: props.modelValue,
    images: props.uploadedImages,
    settings: props.settings,
    optionOverrides: optionRecord.value,
    ...(selectedRange.value === undefined
      ? {}
      : { range: selectedRange.value }),
  }),
);
const warningsByPrompt = computed<Record<number, string>>(() =>
  Object.fromEntries(
    previewResult.value.errors.flatMap((error) =>
      error.promptIndex === undefined
        ? []
        : [
            [
              previewResult.value.metadata.selectedPromptIndices.indexOf(
                error.promptIndex,
              ),
              error.message,
            ],
          ],
    ),
  ),
);
const hasConcat = computed(() => previewResult.value.metadata.hasConcat);
const runLabel = computed(() => {
  if (props.isBusy) return 'Preparing…';
  if (!rangeEnabled.value) return 'Run';
  return rangeStart.value === rangeEnd.value
    ? `Run (${rangeStart.value})`
    : `Run (${rangeStart.value}–${rangeEnd.value})`;
});
const isOverFreeLimit = computed(
  () =>
    !props.isPro &&
    props.dailyCount + previewResult.value.metadata.selectedPromptCount > 10,
);

watch(
  promptCount,
  (count) => {
    rangeStart.value = Math.min(
      Math.max(1, rangeStart.value),
      Math.max(1, count),
    );
    rangeEnd.value = Math.max(1, count);
  },
  { immediate: true },
);

function updateSetting<K extends keyof Settings>(
  key: K,
  value: Settings[K],
): void {
  emit('update:settings', { ...props.settings, [key]: value });
}

function setOption(index: number, option: PromptOption): void {
  const options = [...(optionOverrides[props.mode] ?? selectedOptions.value)];
  options[index] = option;
  optionOverrides[props.mode] = options;
}

async function importTextFile(file: File): Promise<void> {
  try {
    emit('update:modelValue', (await file.text()).trim());
  } catch {
    emit('error', 'Could not read the text prompt file.');
  }
}

async function importSpreadsheetFile(file: File): Promise<void> {
  if (file.size < 1) {
    emit('error', `${file.name} is empty.`);
    return;
  }
  if (file.size > MAX_SPREADSHEET_FILE_BYTES) {
    emit('error', `${file.name} exceeds the 10 MiB spreadsheet limit.`);
    return;
  }
  try {
    const [{ parseSpreadsheet }, data] = await Promise.all([
      import('../spreadsheet-import'),
      file.arrayBuffer(),
    ]);
    const result = parseSpreadsheet({
      fileName: file.name,
      data,
    });
    if (!result.valid || !result.workbook) {
      emit('error', result.errors[0]?.message ?? 'Could not read spreadsheet.');
      return;
    }
    spreadsheetWorkbook.value = result.workbook;
    showSpreadsheetImport.value = true;
  } catch (error) {
    emit(
      'error',
      error instanceof Error ? error.message : 'Could not read spreadsheet.',
    );
  }
}

function importSpreadsheetPrompts(value: string): void {
  emit('update:modelValue', value);
  showSpreadsheetImport.value = false;
}

function clearComposer(): void {
  emit('update:modelValue', '');
  emit('update:uploadedImages', []);
  optionOverrides[props.mode] = [];
  rangeEnabled.value = false;
  emit('clear');
}

function submit(): void {
  const result = previewResult.value;
  if (!result.valid) {
    emit(
      'error',
      result.errors.map((error) => error.message).join(' ') ||
        'Complete the prompt form before running.',
    );
    return;
  }
  if (isOverFreeLimit.value) {
    emit('upgrade');
    return;
  }
  emit('queue', result.payloads);
}
</script>

<template>
  <section class="reference-composer">
    <UploadedImages
      v-if="uploadMode"
      :model-value="uploadedImages"
      :disabled="isBusy"
      @update:model-value="emit('update:uploadedImages', $event)"
      @error="emit('error', $event)"
    />

    <label v-if="uploadMode" class="reference-card compact-control">
      <span class="compact-control__label">
        <IconLibraryPhoto :size="17" aria-hidden="true" />
        Max images per prompt
      </span>
      <select
        :value="maxImagesForMode"
        @change="
          updateSetting(
            mode === 'imageToVideo'
              ? 'imageToVideoMaxImagesPerPrompt'
              : mode === 'componentsToVideo'
                ? 'componentsToVideoMaxImagesPerPrompt'
                : 'imageToImageMaxImagesPerPrompt',
            Number(($event.target as HTMLSelectElement).value),
          )
        "
      >
        <option
          v-for="count in mode === 'imageToVideo' ? 2 : 7"
          :key="count"
          :value="count"
        >
          {{ count }} image{{ count === 1 ? '' : 's' }}
        </option>
      </select>
    </label>

    <label
      v-if="mode === 'componentsToVideo' || mode === 'imageToImage'"
      class="reference-card match-toggle"
    >
      <span>
        <IconToggleLeft :size="18" aria-hidden="true" />
        <strong>Match character images</strong>
        <small>Use image filenames mentioned in each prompt.</small>
      </span>
      <input
        :checked="settings.autoAddCharacterImages"
        type="checkbox"
        role="switch"
        @change="
          updateSetting(
            'autoAddCharacterImages',
            ($event.target as HTMLInputElement).checked,
          )
        "
      />
    </label>

    <div class="queue-controls">
      <label class="reference-card compact-control">
        <span class="compact-control__label">
          <IconRepeat :size="17" aria-hidden="true" />
          Concurrent Prompts
        </span>
        <select
          :value="hasConcat ? 1 : settings.concurrentPrompts"
          :disabled="hasConcat"
          @change="
            updateSetting(
              'concurrentPrompts',
              Number(($event.target as HTMLSelectElement).value),
            )
          "
        >
          <option v-for="count in 10" :key="count" :value="count">
            {{ count }} prompt{{ count === 1 ? '' : 's' }}
          </option>
        </select>
        <small>Number of prompts to process simultaneously.</small>
      </label>

      <div class="reference-card compact-control">
        <span class="compact-control__label">
          <IconClock :size="17" aria-hidden="true" />
          Random Delay
        </span>
        <div class="delay-inputs">
          <input
            :value="settings.promptDelaySecondsMin"
            type="number"
            min="0"
            max="300"
            aria-label="Minimum delay seconds"
            @change="
              updateSetting(
                'promptDelaySecondsMin',
                Math.min(
                  Number(($event.target as HTMLInputElement).value),
                  settings.promptDelaySecondsMax,
                ),
              )
            "
          />
          <IconRepeat :size="16" aria-hidden="true" />
          <input
            :value="settings.promptDelaySecondsMax"
            type="number"
            min="0"
            max="300"
            aria-label="Maximum delay seconds"
            @change="
              updateSetting(
                'promptDelaySecondsMax',
                Math.max(
                  Number(($event.target as HTMLInputElement).value),
                  settings.promptDelaySecondsMin,
                ),
              )
            "
          />
        </div>
        <small>Random wait before the next prompt.</small>
      </div>
    </div>

    <PromptInput
      :model-value="modelValue"
      :prompt-count="promptCount"
      @update:model-value="emit('update:modelValue', $event)"
      @text-file="importTextFile"
      @spreadsheet-file="importSpreadsheetFile"
    />

    <PromptOptions
      :mode="mode"
      :prompts="prompts"
      :images-by-prompt="previewResult.metadata.imagesByPrompt"
      :warnings-by-prompt="warningsByPrompt"
      :selected-options="selectedOptions"
      :video-options="VIDEO_OPTIONS"
      :image-options="IMAGE_OPTIONS"
      :requires-images="uploadMode"
      @update:video-option="setOption"
      @update:image-option="setOption"
    />

    <div class="output-controls">
      <label class="reference-card compact-control">
        <span class="compact-control__label">
          <IconListNumbers :size="17" aria-hidden="true" />
          Outputs per Prompt
        </span>
        <select
          :value="
            hasConcat
              ? 1
              : isImageGenerationMode(mode)
                ? settings.imageOutputCount
                : settings.outputCount
          "
          :disabled="hasConcat"
          @change="
            updateSetting(
              isImageGenerationMode(mode) ? 'imageOutputCount' : 'outputCount',
              Number(($event.target as HTMLSelectElement).value),
            )
          "
        >
          <option
            v-for="count in isImageGenerationMode(mode) ? 12 : 4"
            :key="count"
            :value="count"
          >
            {{ count }}
          </option>
        </select>
        <small>Images or videos to create per prompt.</small>
      </label>

      <label class="reference-card compact-control">
        <span class="compact-control__label">
          <IconFolder :size="17" aria-hidden="true" />
          Save to folder
        </span>
        <input
          :value="settings.folderName"
          maxlength="120"
          @input="
            updateSetting(
              'folderName',
              ($event.target as HTMLInputElement).value,
            )
          "
        />
        <small>Subfolder for downloaded files.</small>
      </label>
    </div>

    <label class="reference-card rename-toggle">
      <span>
        Customize aspect ratio, duration and quantity in Settings for more
        control.
        <strong>Auto change file name</strong>
      </span>
      <input
        :checked="settings.autoChangeFileName"
        type="checkbox"
        role="switch"
        @change="
          updateSetting(
            'autoChangeFileName',
            ($event.target as HTMLInputElement).checked,
          )
        "
      />
    </label>

    <div v-if="promptCount > 1" class="range-controls">
      <label>
        <input v-model="rangeEnabled" type="checkbox" />
        Run a prompt range
      </label>
      <div v-if="rangeEnabled">
        <input
          v-model.number="rangeStart"
          type="number"
          min="1"
          :max="promptCount"
          aria-label="Range start"
        />
        <span>to</span>
        <input
          v-model.number="rangeEnd"
          type="number"
          :min="rangeStart"
          :max="promptCount"
          aria-label="Range end"
        />
      </div>
    </div>

    <slot name="queue" />

    <div class="control-actions">
      <button type="button" @click="emit('report')">
        <IconFlag :size="17" aria-hidden="true" />
        Report Bug
      </button>
      <button type="button" :disabled="isBusy" @click="clearComposer">
        <IconRefresh :size="17" aria-hidden="true" />
        Clear
      </button>
      <button
        class="primary-action"
        type="button"
        :disabled="isBusy"
        @click="submit"
      >
        <IconPlayerPlay :size="17" aria-hidden="true" />
        {{ runLabel }}
      </button>
    </div>
  </section>

  <SpreadsheetImportModal
    :visible="showSpreadsheetImport"
    :workbook="spreadsheetWorkbook"
    @close="showSpreadsheetImport = false"
    @confirm="importSpreadsheetPrompts"
  />
</template>
