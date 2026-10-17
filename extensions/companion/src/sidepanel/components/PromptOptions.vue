<script setup lang="ts">
import { IconAlertTriangle, IconPhoto, IconVideo } from '@tabler/icons-vue';
import { computed } from 'vue';

import type {
  AutomationMode,
  ImageOption,
  UploadedImage,
  VideoOption,
} from '../types';

const props = defineProps<{
  mode: AutomationMode;
  prompts: readonly string[];
  imagesByPrompt?: readonly (readonly UploadedImage[])[];
  warningsByPrompt?: Readonly<Record<number, string>>;
  selectedOptions: readonly (VideoOption | ImageOption)[];
  videoOptions?: readonly VideoOption[];
  imageOptions?: readonly ImageOption[];
  requiresImages?: boolean;
}>();

const emit = defineEmits<{
  'update:videoOption': [index: number, option: VideoOption];
  'update:imageOption': [index: number, option: ImageOption];
}>();

const defaultVideoOptions: readonly VideoOption[] = ['6s'];
const defaultImageOptions: readonly ImageOption[] = ['new-image'];
const isImageMode = computed(
  () => props.mode === 'textToImage' || props.mode === 'imageToImage',
);

function imagesFor(index: number): readonly UploadedImage[] {
  return props.imagesByPrompt?.[index] ?? [];
}

function warningFor(index: number): string | undefined {
  return (
    props.warningsByPrompt?.[index] ??
    (props.requiresImages && imagesFor(index).length === 0
      ? 'Add an image for this mode.'
      : undefined)
  );
}

function videoOptionFor(index: number): VideoOption {
  return (props.selectedOptions[index] ?? '6s') as VideoOption;
}

function imageOptionFor(index: number): ImageOption {
  return (props.selectedOptions[index] ?? 'new-image') as ImageOption;
}

function videoChoices(index: number): readonly VideoOption[] {
  const choices = props.videoOptions?.length
    ? props.videoOptions
    : defaultVideoOptions;
  return index === props.prompts.length - 1
    ? choices.filter((option) => !option.includes('-concat'))
    : choices;
}

function imageChoices(index: number): readonly ImageOption[] {
  const choices = props.imageOptions?.length
    ? props.imageOptions
    : defaultImageOptions;
  return index === props.prompts.length - 1
    ? choices.filter((option) => !option.includes('-concat'))
    : choices;
}

function optionLabel(option: VideoOption | ImageOption): string {
  if (option === 'new-image') return 'New Image';
  if (option === 'new-image-concat') return 'Edit Previous Image';
  const seconds = option.replace('-concat', '').replace('s', ' seconds');
  return option.includes('-concat') ? `${seconds} + chain` : seconds;
}

function optionChanged(index: number, event: Event): void {
  const value = (event.target as HTMLSelectElement).value;
  if (isImageMode.value)
    emit('update:imageOption', index, value as ImageOption);
  else emit('update:videoOption', index, value as VideoOption);
}
</script>

<template>
  <section v-if="prompts.length" class="prompt-options">
    <article v-for="(prompt, index) in prompts" :key="`${index}-${prompt}`">
      <div class="prompt-options__index">{{ index + 1 }}</div>
      <div class="prompt-options__body">
        <p :title="prompt">{{ prompt }}</p>
        <div v-if="imagesFor(index).length" class="prompt-options__previews">
          <img
            v-for="image in imagesFor(index).slice(0, 3)"
            :key="image.id"
            :src="image.base64"
            :alt="image.name"
          />
        </div>
        <span v-if="warningFor(index)" class="prompt-warning">
          <IconAlertTriangle :size="14" aria-hidden="true" />
          {{ warningFor(index) }}
        </span>
      </div>
      <label class="prompt-options__select">
        <span class="visually-hidden">Prompt {{ index + 1 }} option</span>
        <IconPhoto v-if="isImageMode" :size="15" aria-hidden="true" />
        <IconVideo v-else :size="15" aria-hidden="true" />
        <select
          :value="isImageMode ? imageOptionFor(index) : videoOptionFor(index)"
          @change="optionChanged(index, $event)"
        >
          <template v-if="isImageMode">
            <option
              v-for="option in imageChoices(index)"
              :key="option"
              :value="option"
            >
              {{ optionLabel(option) }}
            </option>
          </template>
          <template v-else>
            <option
              v-for="option in videoChoices(index)"
              :key="option"
              :value="option"
            >
              {{ optionLabel(option) }}
            </option>
          </template>
        </select>
      </label>
    </article>
  </section>
</template>
