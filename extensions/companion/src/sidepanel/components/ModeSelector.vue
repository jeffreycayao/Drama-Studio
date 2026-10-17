<script setup lang="ts">
import {
  IconLibraryPhoto,
  IconPhoto,
  IconPhotoPlus,
  IconPhotoVideo,
  IconVideo,
} from '@tabler/icons-vue';
import type { Component } from 'vue';

import type { AutomationMode } from '../types';

defineProps<{ modelValue: AutomationMode }>();
const emit = defineEmits<{ 'update:modelValue': [mode: AutomationMode] }>();

const modes: Array<{
  value: AutomationMode;
  label: string;
  icon: Component;
}> = [
  { value: 'textToVideo', label: 'Text to Video', icon: IconVideo },
  { value: 'imageToVideo', label: 'Frame to Video', icon: IconPhotoVideo },
  {
    value: 'componentsToVideo',
    label: 'Ingredients to Video',
    icon: IconLibraryPhoto,
  },
  { value: 'textToImage', label: 'Text to Image', icon: IconPhoto },
  { value: 'imageToImage', label: 'Image to Image', icon: IconPhotoPlus },
];
</script>

<template>
  <div
    class="reference-mode-grid"
    role="radiogroup"
    aria-label="Generation mode"
  >
    <button
      v-for="mode in modes"
      :key="mode.value"
      type="button"
      role="radio"
      :aria-checked="modelValue === mode.value"
      :class="{ active: modelValue === mode.value }"
      @click="emit('update:modelValue', mode.value)"
    >
      <component :is="mode.icon" :size="17" aria-hidden="true" />
      <span>{{ mode.label }}</span>
    </button>
  </div>
</template>
