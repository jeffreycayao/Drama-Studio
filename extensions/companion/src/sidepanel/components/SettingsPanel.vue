<script setup lang="ts">
import {
  IconAdjustmentsHorizontal,
  IconCheck,
  IconDownload,
  IconInfoCircle,
  IconMinus,
  IconPhoto,
  IconPlus,
  IconRefresh,
  IconSettings,
  IconVideo,
  IconWand,
} from '@tabler/icons-vue';
import { reactive, watch } from 'vue';

import type { Settings } from '../types';

const props = defineProps<{
  settings: Settings;
  saving: boolean;
}>();

const emit = defineEmits<{
  save: [settings: Settings];
  reset: [];
  downloadSettings: [];
}>();

const draft = reactive<Settings>({ ...props.settings });

watch(
  () => props.settings,
  (settings) => Object.assign(draft, settings),
  { deep: true },
);

function changeRetries(delta: number): void {
  draft.maxRetries = Math.min(20, Math.max(1, draft.maxRetries + delta));
}
</script>

<template>
  <section class="reference-settings">
    <label class="setting-card">
      <span class="setting-card__label">
        <IconAdjustmentsHorizontal :size="17" aria-hidden="true" />
        Default Mode
      </span>
      <select v-model="draft.defaultMode">
        <option value="textToVideo">Text to Video</option>
        <option value="imageToVideo">Frame to Video</option>
        <option value="componentsToVideo">Ingredients to Video</option>
        <option value="textToImage">Text to Image</option>
        <option value="imageToImage">Image to Image</option>
      </select>
      <small>Default mode when creating a new automation.</small>
    </label>

    <label class="setting-card">
      <span class="setting-card__label">
        <IconWand :size="17" aria-hidden="true" />
        Image Model
      </span>
      <select v-model="draft.imageModel">
        <option value="quality">Quality</option>
        <option value="speed">Speed</option>
      </select>
      <small>Select the AI model to use for text-to-image generation.</small>
    </label>

    <label class="setting-card">
      <span class="setting-card__label">
        <IconPhoto :size="17" aria-hidden="true" />
        Default Aspect Ratio
      </span>
      <select v-model="draft.aspectRatio">
        <option value="16:9">16:9 (YouTube)</option>
        <option value="9:16">9:16 (Shorts / Reels)</option>
        <option value="1:1">1:1 (Square)</option>
        <option value="2:3">2:3 (Portrait)</option>
        <option value="3:2">3:2 (Landscape)</option>
      </select>
      <small>Video frame ratio for new prompts.</small>
    </label>

    <label class="setting-card">
      <span class="setting-card__label">
        <IconVideo :size="17" aria-hidden="true" />
        Default Video Option
      </span>
      <select v-model="draft.defaultVideoOption">
        <option value="6s">6 seconds</option>
        <option value="10s">10 seconds</option>
        <option value="15s">15 seconds</option>
        <option value="6s-concat">6 seconds + chain</option>
        <option value="10s-concat">10 seconds + chain</option>
        <option value="15s-concat">15 seconds + chain</option>
      </select>
      <small
        >Default duration for video prompts. The last prompt never
        chains.</small
      >
    </label>

    <label class="setting-card">
      <span class="setting-card__label">
        <IconPhoto :size="17" aria-hidden="true" />
        Default Image Mode Option
      </span>
      <select v-model="draft.defaultImageOption">
        <option value="new-image">New Image</option>
        <option value="new-image-concat">Edit Previous Image</option>
      </select>
      <small
        >Default input mode for image prompts. The last prompt uses New
        Image.</small
      >
    </label>

    <div class="setting-card">
      <span class="setting-card__label">
        <IconRefresh :size="17" aria-hidden="true" />
        Retries after a timeout
      </span>
      <div class="retry-stepper">
        <button
          type="button"
          aria-label="Decrease retries"
          :disabled="draft.maxRetries === 1"
          @click="changeRetries(-1)"
        >
          <IconMinus :size="18" aria-hidden="true" />
        </button>
        <output aria-label="Maximum retries">{{ draft.maxRetries }}</output>
        <button
          type="button"
          aria-label="Increase retries"
          :disabled="draft.maxRetries === 20"
          @click="changeRetries(1)"
        >
          <IconPlus :size="18" aria-hidden="true" />
        </button>
      </div>
      <small
        >How often a prompt is tried again after a timeout or network error
        (1–20). A CAPTCHA, usage limit, moderation message or sign-in page stops
        the whole batch instead, with no retry.</small
      >
    </div>

    <label class="setting-card">
      <span class="setting-card__label">
        <IconDownload :size="17" aria-hidden="true" />
        Auto Download Quality (Video)
      </span>
      <select v-model="draft.autoDownloadVideoQuality">
        <option value="no-download">Do not download</option>
        <option value="480p">480p</option>
        <option value="480p-upscale">480p (Upscale)</option>
        <option value="720p">720p</option>
        <option value="1080p">1080p</option>
      </select>
      <small>Select the video quality for automatic downloads.</small>
    </label>

    <label class="setting-card">
      <span class="setting-card__label">
        <IconDownload :size="17" aria-hidden="true" />
        Auto Download Quality (Image)
      </span>
      <select v-model="draft.autoDownloadImageQuality">
        <option value="no-download">Do not download</option>
        <option value="1k">1k</option>
      </select>
      <small>Select the image quality for automatic downloads.</small>
    </label>

    <button
      class="download-settings-card"
      type="button"
      @click="emit('downloadSettings')"
    >
      <IconDownload :size="18" aria-hidden="true" />
      <span>
        <strong>Download Settings</strong>
        <small
          >Files are saved to Chrome's Downloads folder in a folder per
          project.</small
        >
      </span>
      <IconSettings :size="17" aria-hidden="true" />
    </button>

    <div class="settings-actions">
      <button type="button" :disabled="saving" @click="emit('reset')">
        <IconRefresh :size="16" aria-hidden="true" />
        Reset Defaults
      </button>
      <button
        class="primary-action"
        type="button"
        :disabled="saving"
        @click="emit('save', { ...draft })"
      >
        <IconCheck :size="17" aria-hidden="true" />
        {{ saving ? 'Saving…' : 'Save Settings' }}
      </button>
    </div>

    <p class="sync-notice">
      <IconInfoCircle :size="17" aria-hidden="true" />
      Settings sync across every open Companion side panel.
    </p>
  </section>
</template>
