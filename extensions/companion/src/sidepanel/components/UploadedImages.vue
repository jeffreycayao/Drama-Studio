<script setup lang="ts">
import {
  IconArrowsSort,
  IconChevronDown,
  IconChevronUp,
  IconGripVertical,
  IconPhotoPlus,
  IconTrash,
} from '@tabler/icons-vue';
import { computed, ref } from 'vue';

import { filesToUploadedImages } from '../files';
import type { UploadedImage } from '../types';
import {
  estimateBase64DataUrlBytes,
  MAX_UPLOADED_IMAGE_FILES,
  MAX_UPLOADED_IMAGE_TOTAL_BYTES,
} from '../../security/image-limits';

type ImageSortMode =
  'custom' | 'name-ascending' | 'name-descending' | 'newest' | 'oldest';

const props = defineProps<{
  modelValue: UploadedImage[];
  maxImages?: number;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [images: UploadedImage[]];
  error: [message: string];
}>();

const input = ref<HTMLInputElement | null>(null);
const draggingId = ref<string | null>(null);
const sortMode = ref<ImageSortMode>('custom');
const effectiveMaxImages = computed(() =>
  Math.min(
    props.maxImages ?? MAX_UPLOADED_IMAGE_FILES,
    MAX_UPLOADED_IMAGE_FILES,
  ),
);

function isImageSortMode(value: string): value is ImageSortMode {
  return [
    'custom',
    'name-ascending',
    'name-descending',
    'newest',
    'oldest',
  ].includes(value);
}

function sortImages(
  images: readonly UploadedImage[],
  mode: ImageSortMode,
): UploadedImage[] {
  if (mode === 'custom') return [...images];
  return images
    .map((image, index) => ({ image, index }))
    .sort((left, right) => {
      let comparison: number;
      if (mode === 'name-ascending' || mode === 'name-descending') {
        comparison = left.image.name.localeCompare(
          right.image.name,
          undefined,
          {
            numeric: true,
            sensitivity: 'base',
          },
        );
        if (mode === 'name-descending') comparison *= -1;
      } else {
        comparison = left.image.uploadedAt - right.image.uploadedAt;
        if (mode === 'newest') comparison *= -1;
      }
      return comparison || left.index - right.index;
    })
    .map(({ image }) => image);
}

function changeSort(event: Event): void {
  const value = (event.target as HTMLSelectElement).value;
  if (!isImageSortMode(value)) return;
  sortMode.value = value;
  if (value !== 'custom') {
    emit('update:modelValue', sortImages(props.modelValue, value));
  }
}

async function addFiles(files: FileList | File[] | null): Promise<void> {
  if (!files || props.disabled) return;
  try {
    const remainingFiles = Math.max(
      0,
      effectiveMaxImages.value - props.modelValue.length,
    );
    const existingBytes = props.modelValue.reduce(
      (total, image) => total + estimateBase64DataUrlBytes(image.base64),
      0,
    );
    const images = await filesToUploadedImages(files, {
      maxFiles: remainingFiles,
      maxTotalBytes: Math.max(
        0,
        MAX_UPLOADED_IMAGE_TOTAL_BYTES - existingBytes,
      ),
    });
    emit(
      'update:modelValue',
      sortImages([...props.modelValue, ...images], sortMode.value),
    );
  } catch (error) {
    emit(
      'error',
      error instanceof Error ? error.message : 'Could not read images',
    );
  } finally {
    if (input.value) input.value.value = '';
  }
}

function remove(id: string): void {
  emit(
    'update:modelValue',
    props.modelValue.filter((image) => image.id !== id),
  );
}

function move(index: number, direction: -1 | 1): void {
  const destination = index + direction;
  if (destination < 0 || destination >= props.modelValue.length) return;
  const images = [...props.modelValue];
  const [image] = images.splice(index, 1);
  if (!image) return;
  images.splice(destination, 0, image);
  sortMode.value = 'custom';
  emit('update:modelValue', images);
}

function dropBefore(targetId: string): void {
  const sourceId = draggingId.value;
  draggingId.value = null;
  if (!sourceId || sourceId === targetId) return;
  const images = [...props.modelValue];
  const sourceIndex = images.findIndex((image) => image.id === sourceId);
  const targetIndex = images.findIndex((image) => image.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0) return;
  const [image] = images.splice(sourceIndex, 1);
  if (!image) return;
  images.splice(targetIndex, 0, image);
  sortMode.value = 'custom';
  emit('update:modelValue', images);
}
</script>

<template>
  <section class="uploaded-images">
    <input
      ref="input"
      class="visually-hidden"
      type="file"
      accept="image/avif,image/bmp,image/gif,image/jpeg,image/png,image/webp"
      multiple
      @change="addFiles(($event.target as HTMLInputElement).files)"
    />
    <button
      class="image-dropzone"
      type="button"
      :disabled="disabled || modelValue.length >= effectiveMaxImages"
      @click="input?.click()"
      @dragover.prevent
      @drop.prevent="addFiles($event.dataTransfer?.files ?? null)"
    >
      <IconPhotoPlus :size="18" aria-hidden="true" />
      <span>Upload or drop images</span>
      <small>{{ modelValue.length }}/{{ effectiveMaxImages }}</small>
    </button>

    <div v-if="modelValue.length" class="uploaded-images__toolbar">
      <label>
        <IconArrowsSort :size="16" aria-hidden="true" />
        <span>Sort images</span>
        <select :value="sortMode" @change="changeSort">
          <option value="custom">Custom order</option>
          <option value="name-ascending">Name: A to Z</option>
          <option value="name-descending">Name: Z to A</option>
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
        </select>
      </label>
      <p id="uploaded-images-order-help">
        This order controls how images are assigned to prompts. Drag or use the
        arrow buttons for a custom order.
      </p>
    </div>

    <ol
      v-if="modelValue.length"
      class="uploaded-images__list"
      aria-label="Uploaded images in processing order"
      aria-describedby="uploaded-images-order-help"
    >
      <li
        v-for="(image, index) in modelValue"
        :key="image.id"
        draggable="true"
        :aria-label="`${index + 1} of ${modelValue.length}: ${image.name}`"
        :aria-posinset="index + 1"
        :aria-setsize="modelValue.length"
        @dragstart="draggingId = image.id"
        @dragend="draggingId = null"
        @dragover.prevent
        @drop.prevent="dropBefore(image.id)"
      >
        <IconGripVertical :size="16" class="drag-handle" aria-hidden="true" />
        <img :src="image.base64" :alt="image.name" />
        <span :title="image.name">{{ image.name }}</span>
        <button
          type="button"
          aria-label="Move image up"
          :disabled="index === 0"
          @click="move(index, -1)"
        >
          <IconChevronUp :size="15" aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="Move image down"
          :disabled="index === modelValue.length - 1"
          @click="move(index, 1)"
        >
          <IconChevronDown :size="15" aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="Remove image"
          @click="remove(image.id)"
        >
          <IconTrash :size="15" aria-hidden="true" />
        </button>
      </li>
    </ol>
  </section>
</template>
