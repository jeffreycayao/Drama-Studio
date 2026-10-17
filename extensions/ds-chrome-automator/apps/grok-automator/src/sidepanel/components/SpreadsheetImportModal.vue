<script setup lang="ts">
import { IconCheck, IconFileSpreadsheet, IconX } from '@tabler/icons-vue';
import { computed, ref, watch } from 'vue';

import type { SpreadsheetWorkbookModel } from '../spreadsheet-import';

const props = defineProps<{
  visible: boolean;
  workbook: SpreadsheetWorkbookModel | null;
}>();

const emit = defineEmits<{
  close: [];
  confirm: [promptText: string];
}>();

const selectedSheetName = ref('');
const selectedColumnIndex = ref(0);

const selectedSheet = computed(() =>
  props.workbook?.sheets.find(
    (sheet) => sheet.name === selectedSheetName.value,
  ),
);
const extraction = computed(() => {
  const sheet = selectedSheet.value;
  const column = sheet?.columns[selectedColumnIndex.value];
  if (!sheet || !column) return null;
  const sourceRows = sheet.hasHeader ? sheet.rows.slice(1) : sheet.rows;
  const values = sourceRows
    .map((row) => row[selectedColumnIndex.value]?.trim() ?? '')
    .filter(Boolean);
  return {
    valid: values.length > 0,
    values,
    error:
      values.length === 0
        ? `Column ${column.label} in sheet ${sheet.name} is empty.`
        : null,
  };
});
const preview = computed(() => extraction.value?.values.slice(0, 6) ?? []);

function selectAutomaticColumn(): void {
  selectedColumnIndex.value = selectedSheet.value?.autoColumnIndex ?? 0;
}

watch(
  () => [props.visible, props.workbook] as const,
  ([visible, workbook]) => {
    if (!visible || !workbook) return;
    selectedSheetName.value = workbook.selectedSheetName;
    selectedColumnIndex.value = workbook.selectedColumnIndex ?? 0;
  },
  { immediate: true },
);

watch(selectedSheetName, selectAutomaticColumn);

function confirm(): void {
  const result = extraction.value;
  if (!result?.valid || result.values.length === 0) return;
  emit('confirm', result.values.join('\n\n'));
}

function onBackdrop(event: MouseEvent): void {
  if (event.target === event.currentTarget) emit('close');
}
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="modal-backdrop" @click="onBackdrop">
      <section
        class="modal-card spreadsheet-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="spreadsheet-title"
      >
        <header>
          <h2 id="spreadsheet-title">
            <IconFileSpreadsheet :size="19" aria-hidden="true" />
            Import prompts
          </h2>
          <button
            type="button"
            aria-label="Close import"
            @click="emit('close')"
          >
            <IconX :size="20" aria-hidden="true" />
          </button>
        </header>

        <div v-if="workbook" class="modal-body spreadsheet-modal__body">
          <p class="spreadsheet-file" :title="workbook.fileName">
            {{ workbook.fileName }}
          </p>
          <label class="field">
            <span>Sheet</span>
            <select v-model="selectedSheetName">
              <option
                v-for="sheet in workbook.sheets"
                :key="sheet.name"
                :value="sheet.name"
              >
                {{ sheet.name }}
              </option>
            </select>
          </label>
          <label v-if="selectedSheet" class="field">
            <span>Prompt column</span>
            <select v-model.number="selectedColumnIndex">
              <option
                v-for="column in selectedSheet.columns"
                :key="column.index"
                :value="column.index"
                :disabled="column.nonEmptyCount === 0"
              >
                {{ column.label }}
                {{
                  column.index === selectedSheet.autoColumnIndex
                    ? '(recommended)'
                    : ''
                }}
              </option>
            </select>
          </label>

          <section v-if="extraction?.valid" class="spreadsheet-preview">
            <header>
              <strong>Preview</strong>
              <span>{{ extraction.values.length }} prompts</span>
            </header>
            <ol>
              <li v-for="(value, index) in preview" :key="`${index}-${value}`">
                <span>{{ index + 1 }}</span
                >{{ value }}
              </li>
            </ol>
            <p v-if="extraction.values.length > preview.length">
              +{{ extraction.values.length - preview.length }} more
            </p>
          </section>
          <p v-else class="form-error">
            {{ extraction?.error ?? 'Select a prompt column.' }}
          </p>
        </div>

        <footer>
          <button class="button ghost" type="button" @click="emit('close')">
            Cancel
          </button>
          <button
            class="button primary"
            type="button"
            :disabled="!extraction?.valid"
            @click="confirm"
          >
            <IconCheck :size="16" aria-hidden="true" />
            Import {{ extraction?.values.length ?? 0 }} prompts
          </button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>
