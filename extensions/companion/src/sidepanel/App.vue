<script setup lang="ts">
import {
  IconAdjustmentsHorizontal,
  IconAlertTriangle,
  IconListDetails,
  IconPlayerPlay,
} from '@tabler/icons-vue';
import { onMounted, onUnmounted, reactive, ref } from 'vue';
import { z } from 'zod/mini';

import AppFooter from './components/AppFooter.vue';
import AppHeader from './components/AppHeader.vue';
import DebugPanel from './components/DebugPanel.vue';
import DesktopLinkCard from './components/DesktopLinkCard.vue';
import ModalShell from './components/ModalShell.vue';
import ModeSelector from './components/ModeSelector.vue';
import PromptComposer from './components/PromptComposer.vue';
import QueuePanel from './components/QueuePanel.vue';
import SettingsPanel from './components/SettingsPanel.vue';
import TipBeforeUseModal from './components/TipBeforeUseModal.vue';
import { t } from './i18n';
import { DISCORD_INVITE_URL } from './links';
import {
  cancelPromptGroup,
  detectGrokPage,
  navigateToGrok,
  queuePromptGroup,
  type GrokPageState,
} from './protocol';
import {
  addOptimisticGroup,
  installRuntimeState,
  useRuntimeState,
} from './runtime-state';
import { DEFAULT_SETTINGS, normalizeSettings } from './settings';
import {
  loadSettings,
  resetSettings,
  saveSettings,
  watchSettings,
} from './storage';
import type {
  AutomationMode,
  PromptPayload,
  Settings,
  UploadedImage,
} from './types';

type PanelTab = 'control' | 'settings' | 'debug';
type Notice = { kind: 'success' | 'error' | 'info'; message: string };

const manifestSchema = z.looseObject({
  version: z.string(),
  version_name: z.optional(z.string()),
});
const manifest = manifestSchema.parse(chrome.runtime.getManifest());
const version = manifest.version_name ?? manifest.version;
const settings = reactive<Settings>({ ...DEFAULT_SETTINGS });
const selectedMode = ref<AutomationMode>(DEFAULT_SETTINGS.defaultMode);
const activeTab = ref<PanelTab>('control');
const promptText = reactive<Record<AutomationMode, string>>({
  textToVideo: '',
  imageToVideo: '',
  componentsToVideo: '',
  textToImage: '',
  imageToImage: '',
});
const uploadedImages = reactive<Record<AutomationMode, UploadedImage[]>>({
  textToVideo: [],
  imageToVideo: [],
  componentsToVideo: [],
  textToImage: [],
  imageToImage: [],
});
const pageState = ref<GrokPageState>({ isGrokPage: false, healthy: true });
const isSending = ref(false);
const isSaving = ref(false);
const notice = ref<Notice | null>(null);
const showTip = ref(false);
const showUpdate = ref(false);
const showReport = ref(false);
const runtime = useRuntimeState();
let stopRuntime: (() => void) | null = null;
let pagePoller: number | null = null;
let noticeTimer: number | null = null;
let settingsAutoSaveTimer: number | null = null;
let pendingAutoSave: Settings | null = null;

function selectTab(tab: PanelTab): void {
  activeTab.value = tab;
  window.scrollTo({ top: 0, behavior: 'auto' });
}
let stopSettingsWatch: (() => void) | null = null;
let settingsWriteChain: Promise<void> = Promise.resolve();

type ExpectedSettingsEcho = {
  fingerprint: string;
  expiryTimer: number;
};

const expectedSettingsEchoes: ExpectedSettingsEcho[] = [];
const SETTINGS_AUTO_SAVE_DELAY_MS = 250;
const SETTINGS_ECHO_TIMEOUT_MS = 5000;

function showNotice(kind: Notice['kind'], message: string): void {
  notice.value = { kind, message };
  if (noticeTimer !== null) window.clearTimeout(noticeTimer);
  noticeTimer = window.setTimeout(() => (notice.value = null), 5000);
}

function settingsFingerprint(value: Settings): string {
  return JSON.stringify(value);
}

function settingsAreEqual(first: Settings, second: Settings): boolean {
  return settingsFingerprint(first) === settingsFingerprint(second);
}

function removeExpectedSettingsEcho(entry: ExpectedSettingsEcho): void {
  const index = expectedSettingsEchoes.indexOf(entry);
  if (index !== -1) expectedSettingsEchoes.splice(index, 1);
  window.clearTimeout(entry.expiryTimer);
}

function expectSettingsEcho(value: Settings): ExpectedSettingsEcho {
  const entry: ExpectedSettingsEcho = {
    fingerprint: settingsFingerprint(value),
    expiryTimer: 0,
  };
  entry.expiryTimer = window.setTimeout(
    () => removeExpectedSettingsEcho(entry),
    SETTINGS_ECHO_TIMEOUT_MS,
  );
  expectedSettingsEchoes.push(entry);
  return entry;
}

function consumeExpectedSettingsEcho(value: Settings): boolean {
  const fingerprint = settingsFingerprint(value);
  const entry = expectedSettingsEchoes.find(
    (candidate) => candidate.fingerprint === fingerprint,
  );
  if (!entry) return false;
  removeExpectedSettingsEcho(entry);
  return true;
}

function enqueueSettingsOperation<T>(operation: () => Promise<T>): Promise<T> {
  const result = settingsWriteChain.then(operation);
  settingsWriteChain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function writeSettings(value: Settings): Promise<void> {
  const snapshot = { ...value };
  const expectedEcho = expectSettingsEcho(snapshot);
  try {
    await saveSettings(snapshot);
  } catch (error) {
    removeExpectedSettingsEcho(expectedEcho);
    throw error;
  }
}

function cancelPendingAutoSave(): void {
  if (settingsAutoSaveTimer !== null) {
    window.clearTimeout(settingsAutoSaveTimer);
    settingsAutoSaveTimer = null;
  }
  pendingAutoSave = null;
}

function flushPendingAutoSave(): void {
  if (settingsAutoSaveTimer !== null) {
    window.clearTimeout(settingsAutoSaveTimer);
    settingsAutoSaveTimer = null;
  }
  const snapshot = pendingAutoSave;
  pendingAutoSave = null;
  if (!snapshot) return;
  void enqueueSettingsOperation(() => writeSettings(snapshot)).catch(() => {
    showNotice('error', 'A control setting could not be saved. Try again.');
  });
}

function scheduleAutoSave(value: Settings): void {
  pendingAutoSave = { ...value };
  if (settingsAutoSaveTimer !== null) {
    window.clearTimeout(settingsAutoSaveTimer);
  }
  settingsAutoSaveTimer = window.setTimeout(
    flushPendingAutoSave,
    SETTINGS_AUTO_SAVE_DELAY_MS,
  );
}

function applySyncedSettings(next: Settings): void {
  if (consumeExpectedSettingsEcho(next)) return;
  if (settingsAreEqual(settings, next)) return;
  cancelPendingAutoSave();
  expectedSettingsEchoes
    .splice(0)
    .forEach((entry) => window.clearTimeout(entry.expiryTimer));
  Object.assign(settings, next);
}

async function refreshGrokState(): Promise<GrokPageState> {
  pageState.value = await detectGrokPage();
  return pageState.value;
}

/**
 * Starts a batch on the active Grok tab. Nothing is sent while the tab shows
 * a CAPTCHA, a limit, a moderation message or a sign-in page, or when Grok
 * has changed so the Companion can no longer find the prompt box.
 */
async function requestQueue(payloads: PromptPayload[]): Promise<void> {
  if (isSending.value) return;
  isSending.value = true;
  try {
    const state = await refreshGrokState();
    if (!state.isGrokPage) {
      showNotice('info', t('notOnGrok'));
      return;
    }
    if (state.stop) {
      showNotice('error', state.stop.message);
      return;
    }
    if (!state.healthy) {
      showNotice('error', t('siteChanged'));
      return;
    }
    const result = await queuePromptGroup(payloads, {
      concurrentPrompts:
        payloads[0]?.concurrentPrompts ?? settings.concurrentPrompts,
      promptDelaySecondsMin: settings.promptDelaySecondsMin,
      promptDelaySecondsMax: settings.promptDelaySecondsMax,
    });
    addOptimisticGroup(result.groupId, payloads, result.tabId);
    runtime.addLocalLog(
      'info',
      `Queued ${payloads.length} prompt(s) as ${result.groupId}`,
    );
    showNotice(
      'success',
      `Queued ${payloads.length} prompt${payloads.length === 1 ? '' : 's'}.`,
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Could not queue prompts';
    runtime.addLocalLog('error', message);
    showNotice('error', message);
  } finally {
    isSending.value = false;
  }
}

async function cancel(groupId: string): Promise<void> {
  try {
    const group = runtime.promptGroups.value.find(
      (candidate) => candidate.id === groupId,
    );
    await cancelPromptGroup(groupId, group?.tabId);
    showNotice('info', 'Cancellation requested.');
  } catch (error) {
    showNotice(
      'error',
      error instanceof Error ? error.message : 'Cancellation failed',
    );
  }
}

async function persistSettings(next: Settings): Promise<void> {
  isSaving.value = true;
  try {
    const validated = normalizeSettings(next);
    cancelPendingAutoSave();
    await enqueueSettingsOperation(() => writeSettings(validated));
    Object.assign(settings, validated);
    selectedMode.value = validated.defaultMode;
    showNotice('success', 'Settings saved.');
  } catch (error) {
    showNotice(
      'error',
      error instanceof Error ? error.message : 'Could not save settings',
    );
  } finally {
    isSaving.value = false;
  }
}

function updateWorkingSettings(next: Settings): void {
  try {
    const validated = normalizeSettings(next);
    Object.assign(settings, validated);
    scheduleAutoSave(validated);
  } catch {
    showNotice(
      'error',
      'Invalid control setting. Check the value and try again.',
    );
  }
}

async function restoreDefaults(): Promise<void> {
  cancelPendingAutoSave();
  isSaving.value = true;
  try {
    const reset = await enqueueSettingsOperation(async () => {
      const value = await resetSettings();
      expectSettingsEcho(value);
      return value;
    });
    Object.assign(settings, reset);
    selectedMode.value = reset.defaultMode;
    showNotice('success', 'Defaults restored.');
  } catch {
    showNotice('error', 'Could not restore default settings.');
  } finally {
    isSaving.value = false;
  }
}

async function dismissTipForever(): Promise<void> {
  settings.hideTipBeforeUse = true;
  showTip.value = false;
  cancelPendingAutoSave();
  try {
    await enqueueSettingsOperation(() => writeSettings({ ...settings }));
  } catch {
    showNotice('error', 'Could not save the tip preference.');
  }
}

async function openCommunity(): Promise<void> {
  try {
    await chrome.tabs.create({ url: DISCORD_INVITE_URL });
  } catch {
    showNotice('error', 'Could not open the Drama Studio Discord.');
  }
}

async function openDownloadSettings(): Promise<void> {
  try {
    await chrome.tabs.create({ url: 'chrome://settings/downloads' });
  } catch {
    showNotice(
      'error',
      'Open Chrome Settings → Downloads to change the location.',
    );
  }
}

async function copyDiagnostics(): Promise<void> {
  const lines = [
    `Drama Studio Companion v${version}`,
    `Mode: ${selectedMode.value}`,
    `Grok page detected: ${pageState.value.isGrokPage}`,
    `Grok page healthy: ${pageState.value.healthy}`,
    `Page stop: ${pageState.value.stop?.reason ?? 'none'}`,
    `Queued groups: ${runtime.promptGroups.value.length}`,
    '',
    ...runtime.logs.value
      .slice(-100)
      .map(
        (entry) =>
          `[${new Date(entry.timestamp).toISOString()}] ${entry.level.toUpperCase()} ${entry.message}`,
      ),
  ];
  await navigator.clipboard.writeText(lines.join('\n'));
  showReport.value = false;
  showNotice('success', 'Diagnostics copied.');
}

function onUpdateAvailable(): void {
  showUpdate.value = true;
}

function applyAvailableUpdate(): void {
  chrome.runtime.reload();
}

onMounted(async () => {
  document.documentElement.classList.add('dark');
  stopRuntime = installRuntimeState();
  chrome.runtime.onUpdateAvailable.addListener(onUpdateAvailable);
  stopSettingsWatch = watchSettings(applySyncedSettings, () => {
    showNotice('error', 'Invalid settings from another panel were ignored.');
  });
  const [storedSettingsResult] = await Promise.all([
    loadSettings().then(
      (value) => ({ success: true as const, value }),
      (error: unknown) => ({ success: false as const, error }),
    ),
    refreshGrokState(),
  ]);
  if (storedSettingsResult.success) {
    Object.assign(settings, storedSettingsResult.value);
    selectedMode.value = storedSettingsResult.value.defaultMode;
    showTip.value = !storedSettingsResult.value.hideTipBeforeUse;
  } else {
    showNotice(
      'error',
      'Stored settings are invalid and were not reset. Review or reset them in Settings.',
    );
  }
  pagePoller = window.setInterval(() => void refreshGrokState(), 2000);
});

onUnmounted(() => {
  flushPendingAutoSave();
  stopSettingsWatch?.();
  stopRuntime?.();
  if (pagePoller !== null) window.clearInterval(pagePoller);
  if (noticeTimer !== null) window.clearTimeout(noticeTimer);
  for (const entry of [...expectedSettingsEchoes]) {
    removeExpectedSettingsEcho(entry);
  }
  chrome.runtime.onUpdateAvailable.removeListener(onUpdateAvailable);
});
</script>

<template>
  <main class="app-shell">
    <div v-if="notice" class="notice" :data-kind="notice.kind" role="status">
      {{ notice.message }}
    </div>

    <div class="app-header">
      <AppHeader
        :version="version"
        :description="t('description')"
        @help="showTip = true"
        @community="openCommunity"
      />
    </div>

    <nav class="main-tabs" aria-label="Side panel sections">
      <button
        :class="{ active: activeTab === 'control' }"
        type="button"
        @click="selectTab('control')"
      >
        <IconPlayerPlay :size="17" aria-hidden="true" />
        {{ t('control') }}
      </button>
      <button
        :class="{ active: activeTab === 'settings' }"
        type="button"
        @click="selectTab('settings')"
      >
        <IconAdjustmentsHorizontal :size="17" aria-hidden="true" />
        {{ t('settings') }}
      </button>
      <button
        :class="{ active: activeTab === 'debug' }"
        type="button"
        @click="selectTab('debug')"
      >
        <IconListDetails :size="17" aria-hidden="true" />
        {{ t('debug') }}
      </button>
    </nav>

    <section v-if="activeTab === 'control'" class="tab-content control-tab">
      <div v-if="!pageState.isGrokPage" class="grok-warning">
        <div>
          <strong>{{ t('notOnGrok') }}</strong>
          <span>{{ t('pageChecked') }}</span>
        </div>
        <button
          class="button primary small"
          type="button"
          @click="navigateToGrok"
        >
          {{ t('openGrok') }}
        </button>
      </div>
      <div v-else-if="pageState.stop" class="page-alert" role="alert">
        <IconAlertTriangle :size="18" aria-hidden="true" />
        <div>
          <strong>Run is paused</strong>
          {{ pageState.stop.message }}
        </div>
      </div>
      <div v-else-if="!pageState.healthy" class="page-alert" role="alert">
        <IconAlertTriangle :size="18" aria-hidden="true" />
        <div>
          <strong>Site changed</strong>
          {{ t('siteChanged') }}
        </div>
      </div>

      <ModeSelector v-model="selectedMode" />
      <PromptComposer
        v-model="promptText[selectedMode]"
        :uploaded-images="uploadedImages[selectedMode]"
        :mode="selectedMode"
        :settings="settings"
        :is-busy="isSending"
        @update:uploaded-images="uploadedImages[selectedMode] = $event"
        @update:settings="updateWorkingSettings"
        @queue="requestQueue"
        @report="showReport = true"
        @error="showNotice('error', $event)"
      >
        <template #queue>
          <QueuePanel
            :groups="runtime.promptGroups.value"
            :progress="runtime.progress.value"
            @cancel="cancel"
            @clear="runtime.clearCompleted"
          />
        </template>
      </PromptComposer>
    </section>

    <section v-else-if="activeTab === 'settings'" class="tab-content">
      <DesktopLinkCard />
      <SettingsPanel
        :settings="settings"
        :saving="isSaving"
        @save="persistSettings"
        @reset="restoreDefaults"
        @download-settings="openDownloadSettings"
      />
    </section>

    <section v-else class="tab-content debug-tab">
      <DebugPanel :logs="runtime.logs.value" @clear="runtime.clearLogs" />
    </section>

    <AppFooter :version="version" />

    <TipBeforeUseModal
      :visible="showTip"
      @close="showTip = false"
      @dismiss-forever="dismissTipForever"
    />

    <ModalShell
      title="Report a problem"
      :visible="showReport"
      @close="showReport = false"
    >
      <p class="modal-copy">
        Copy the latest activity log, then paste it into the Drama Studio
        Discord. Prompts and images are not included.
      </p>
      <template #footer>
        <button class="button ghost" type="button" @click="showReport = false">
          Cancel
        </button>
        <button class="button primary" type="button" @click="copyDiagnostics">
          Copy diagnostics
        </button>
      </template>
    </ModalShell>

    <ModalShell
      title="Companion update available"
      :visible="showUpdate"
      persistent
    >
      <p class="modal-copy">
        Chrome has a newer version of the Companion. Let running batches finish,
        then reload to apply it.
      </p>
      <template #footer>
        <button
          class="button primary full"
          type="button"
          @click="applyAvailableUpdate"
        >
          Reload the Companion
        </button>
      </template>
    </ModalShell>
  </main>
</template>
