<script setup lang="ts">
import {
  IconFileSpreadsheet,
  IconFileText,
  IconListCheck,
} from '@tabler/icons-vue';
import { ref } from 'vue';

defineProps<{ modelValue: string; promptCount?: number }>();

const emit = defineEmits<{
  'update:modelValue': [value: string];
  textFile: [file: File];
  spreadsheetFile: [file: File];
}>();

const textFileInput = ref<HTMLInputElement | null>(null);
const spreadsheetInput = ref<HTMLInputElement | null>(null);

function updateValue(event: Event): void {
  emit('update:modelValue', (event.target as HTMLTextAreaElement).value);
}

function emitFile(kind: 'textFile' | 'spreadsheetFile', event: Event): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file && kind === 'textFile') emit('textFile', file);
  if (file && kind === 'spreadsheetFile') emit('spreadsheetFile', file);
  input.value = '';
}
</script>

<template>
  <section class="reference-card prompt-input">
    <div class="prompt-input__tabs">
      <span class="prompt-input__title">
        <IconListCheck :size="17" aria-hidden="true" />
        Prompts
        <span v-if="promptCount !== undefined" class="inline-count">{{
          promptCount
        }}</span>
      </span>
      <button type="button" @click="textFileInput?.click()">
        <IconFileText :size="16" aria-hidden="true" />
        Upload .txt file
      </button>
      <button type="button" @click="spreadsheetInput?.click()">
        <IconFileSpreadsheet :size="16" aria-hidden="true" />
        Upload .xlsx / .csv
      </button>
    </div>
    <input
      ref="textFileInput"
      class="visually-hidden"
      type="file"
      accept=".txt,text/plain"
      @change="emitFile('textFile', $event)"
    />
    <input
      ref="spreadsheetInput"
      class="visually-hidden"
      type="file"
      accept=".xlsx,.xls,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      @change="emitFile('spreadsheetFile', $event)"
    />
    <textarea
      class="reference-textarea"
      :value="modelValue"
      rows="8"
      placeholder="Example:&#10;First long prompt.&#10;It can span multiple lines.&#10;&#10;Second prompt starts after a blank line.&#10;&#10;Third prompt."
      @input="updateValue"
    />
    <p class="prompt-input__helper">Separate each prompt with a blank line.</p>
  </section>
</template>
