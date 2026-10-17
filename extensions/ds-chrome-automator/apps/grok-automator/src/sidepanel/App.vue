<script setup lang="ts">
import { IconAdjustmentsHorizontal, IconBug } from '@tabler/icons-vue';
import { nextTick, onMounted, onUnmounted, reactive, ref } from 'vue';
import { z } from 'zod/mini';

import {
  configuredOriginOrDefault,
  DEPLOYED_GROK_AUTOMATOR_GUIDE_URL,
  DEPLOYED_PLATFORM_WEB_ORIGIN,
} from '../config/deployment';
import { useAuth } from './auth';
import AppFooter from './components/AppFooter.vue';
import AppHeader from './components/AppHeader.vue';
import DebugPanel from './components/DebugPanel.vue';
import ModalShell from './components/ModalShell.vue';
import ModeSelector from './components/ModeSelector.vue';
import PlanBanner from './components/PlanBanner.vue';
import PromptComposer from './components/PromptComposer.vue';
import QueuePanel from './components/QueuePanel.vue';
import SettingsPanel from './components/SettingsPanel.vue';
import TipBeforeUseModal from './components/TipBeforeUseModal.vue';
import { ACTIVE_LOCALES, t, usePanelI18n } from './i18n';
import {
  cancelPromptGroup,
  commitPromptGroup,
  detectGrokPage,
  navigateToGrok,
  queryPromptGroupCommitStatus,
  queuePromptGroup,
  releasePromptGroup,
} from './protocol';
import {
  addOptimisticGroup,
  installRuntimeState,
  useRuntimeState,
} from './runtime-state';
import { RunAuthGate } from './run-auth-gate';
import { DEFAULT_SETTINGS, normalizeSettings } from './settings';
import {
  incrementDailyPromptCount,
  clearInFlightRunCommit,
  loadDailyPromptCount,
  loadSettings,
  resetSettings,
  saveInFlightRunCommit,
  saveSettings,
  watchSettings,
  type InFlightRunCommit,
} from './storage';
import {
  reconcileInFlightRunCommits,
  type RunCommitRecoveryResult,
} from './run-commit-recovery';
import {
  createUsageAuthorizer,
  type LegacyRunAuthorizationDecision,
  type ReservationTransitionDecision,
} from './usage-authorization';
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
const isGrokPage = ref(false);
const isSending = ref(false);
const isSaving = ref(false);
const dailyCount = ref(0);
const notice = ref<Notice | null>(null);
const showTip = ref(false);
const showUpdate = ref(false);
const showReport = ref(false);
const showGoogleSignIn = ref(false);
const googleSignInButton = ref<HTMLButtonElement | null>(null);
const auth = useAuth();
const runtime = useRuntimeState();
const i18n = usePanelI18n();
const runAuthGate = new RunAuthGate<PromptPayload[]>();
const usageAuthorizer = createUsageAuthorizer();
let stopRuntime: (() => void) | null = null;
let pagePoller: number | null = null;
let runRecoveryPoller: number | null = null;
let runRecoveryPromise: Promise<RunCommitRecoveryResult> | null = null;
let noticeTimer: number | null = null;
let settingsAutoSaveTimer: number | null = null;
let pendingAutoSave: Settings | null = null;
let focusBeforeGoogleSignIn: HTMLElement | null = null;
let googleSignInAttempt = 0;
let pendingRunHasRecovery = false;

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

async function refreshGrokState(): Promise<void> {
  isGrokPage.value = await detectGrokPage();
}

async function recoverInterruptedRunCommits(): Promise<RunCommitRecoveryResult> {
  if (runRecoveryPromise) return runRecoveryPromise;
  const operation = reconcileInFlightRunCommits(usageAuthorizer, {
    onRecovered: (recovery) =>
      runtime.addLocalLog(
        'info',
        `Recovered accepted prompt group ${recovery.groupId}`,
      ),
    onError: (error) =>
      runtime.addLocalLog(
        'error',
        error instanceof Error
          ? error.message
          : 'An accepted prompt group could not be recovered',
      ),
  });
  runRecoveryPromise = operation;
  try {
    return await operation;
  } finally {
    if (runRecoveryPromise === operation) runRecoveryPromise = null;
  }
}

type QueueUsageAuthority =
  | { lifecycle: 'reservation'; authorizationId: string }
  | { lifecycle: 'legacy-immediate'; units: number };

type QueueTransitionDecision =
  ReservationTransitionDecision | LegacyRunAuthorizationDecision;

async function queueReservedPayloads(
  payloads: PromptPayload[],
  acceptanceId: string,
  authority: QueueUsageAuthority,
): Promise<QueueTransitionDecision | null> {
  let acceptedGroup: { groupId: string; tabId: number } | null = null;
  let locallyReleased = false;
  let recovery: InFlightRunCommit;
  let recoveryPersisted = false;
  try {
    const result = await queuePromptGroup(payloads, {
      acceptanceId,
      concurrentPrompts:
        payloads[0]?.concurrentPrompts ?? settings.concurrentPrompts,
      promptDelaySecondsMin: settings.promptDelaySecondsMin,
      promptDelaySecondsMax: settings.promptDelaySecondsMax,
    });
    acceptedGroup = result;
    recovery =
      authority.lifecycle === 'reservation'
        ? {
            lifecycle: 'reservation',
            authorizationId: authority.authorizationId,
            acceptanceId,
            groupId: result.groupId,
            tabId: result.tabId,
            createdAt: Date.now(),
          }
        : {
            lifecycle: 'legacy-immediate',
            units: authority.units,
            acceptanceId,
            groupId: result.groupId,
            tabId: result.tabId,
            createdAt: Date.now(),
          };
    await saveInFlightRunCommit(recovery);
    recoveryPersisted = true;

    let localStatus:
      'pending' | 'blocked' | 'released' | 'claimed' | 'missing' = 'pending';
    if (authority.lifecycle === 'reservation') {
      const consumption = await usageAuthorizer.consumeReservation(
        authority.authorizationId,
        acceptanceId,
      );
      if (consumption.status === 'rolled_back') {
        await clearInFlightRunCommit(recovery);
        recoveryPersisted = false;
        await cancelPromptGroup(result.groupId, result.tabId, acceptanceId);
        return {
          status: 'unavailable',
          message: 'The Run reservation expired before it could be queued.',
        };
      }
      if (
        consumption.status !== 'accepted' &&
        consumption.status !== 'consumed'
      ) {
        return consumption;
      }
      if (consumption.status === 'accepted') {
        if (recovery.lifecycle !== 'reservation') {
          throw new Error(
            'Run recovery lifecycle did not match its reservation',
          );
        }
        recovery = { ...recovery, finalizeBy: consumption.finalizeBy };
        await saveInFlightRunCommit(recovery);
      }

      await commitPromptGroup(result.groupId, acceptanceId, result.tabId);
      localStatus = await queryPromptGroupCommitStatus(
        result.groupId,
        acceptanceId,
        result.tabId,
      );
      if (
        localStatus !== 'blocked' &&
        localStatus !== 'released' &&
        localStatus !== 'claimed'
      ) {
        throw new Error('The accepted prompt group stage was not confirmed');
      }
      if (consumption.status === 'accepted') {
        const finalized = await usageAuthorizer.finalizeReservation(
          authority.authorizationId,
          acceptanceId,
        );
        if (finalized.status !== 'consumed') return finalized;
      }
    } else {
      // Legacy authorization is immediately quota-counted. Make the exact
      // group durable and inert before crossing that irreversible boundary.
      await commitPromptGroup(result.groupId, acceptanceId, result.tabId);
      localStatus = await queryPromptGroupCommitStatus(
        result.groupId,
        acceptanceId,
        result.tabId,
      );
      if (
        localStatus !== 'blocked' &&
        localStatus !== 'released' &&
        localStatus !== 'claimed'
      ) {
        throw new Error('The accepted prompt group stage was not confirmed');
      }
      const authorization = await usageAuthorizer.authorizeLegacyRun(
        authority.units,
        acceptanceId,
      );
      if (authorization.status === 'denied') {
        await clearInFlightRunCommit(recovery);
        recoveryPersisted = false;
        await cancelPromptGroup(result.groupId, result.tabId, acceptanceId);
        return authorization;
      }
      if (authorization.status !== 'consumed') return authorization;
      recovery = {
        ...recovery,
        authorizationId: authorization.authorizationId,
      };
      await saveInFlightRunCommit(recovery);
    }

    if (localStatus !== 'released' && localStatus !== 'claimed') {
      await releasePromptGroup(result.groupId, acceptanceId, result.tabId);
      localStatus = await queryPromptGroupCommitStatus(
        result.groupId,
        acceptanceId,
        result.tabId,
      );
    }
    if (localStatus !== 'released' && localStatus !== 'claimed') {
      throw new Error('The finalized prompt group release was not confirmed');
    }
    locallyReleased = true;
    addOptimisticGroup(result.groupId, payloads, result.tabId);
    dailyCount.value = await incrementDailyPromptCount(payloads.length);
    runtime.addLocalLog(
      'info',
      `Queued ${payloads.length} prompt(s) as ${result.groupId}`,
    );
    await clearInFlightRunCommit(recovery);
    recoveryPersisted = false;
    showNotice(
      'success',
      `Queued ${payloads.length} prompt${payloads.length === 1 ? '' : 's'}.`,
    );
    return null;
  } catch (error) {
    if (recoveryPersisted) {
      await recoverInterruptedRunCommits().catch(() => undefined);
      if (acceptedGroup) {
        const reconciledStatus = await queryPromptGroupCommitStatus(
          acceptedGroup.groupId,
          acceptanceId,
          acceptedGroup.tabId,
        ).catch(() => 'missing' as const);
        if (reconciledStatus === 'released' || reconciledStatus === 'claimed') {
          locallyReleased = true;
        }
        if (reconciledStatus === 'blocked') {
          showNotice(
            'info',
            'This Run is safely staged and will remain blocked until usage finalization succeeds.',
          );
          return null;
        }
      }
    }
    const message =
      error instanceof Error ? error.message : 'Could not queue prompts';
    runtime.addLocalLog('error', message);
    if (locallyReleased) {
      showNotice(
        'success',
        `Queued ${payloads.length} prompt${payloads.length === 1 ? '' : 's'}, but local usage history could not be updated.`,
      );
      return null;
    }
    showNotice('error', message);
    return {
      status: 'unavailable',
      message: 'The accepted Run could not be committed to the local queue.',
    };
  } finally {
    if (acceptedGroup && !locallyReleased && !recoveryPersisted) {
      await cancelPromptGroup(
        acceptedGroup.groupId,
        acceptedGroup.tabId,
        acceptanceId,
      ).catch(() => undefined);
    }
    if (
      authority.lifecycle === 'reservation' &&
      !recoveryPersisted &&
      !locallyReleased
    ) {
      await usageAuthorizer
        .cancelReservation(authority.authorizationId)
        .catch(() => undefined);
    }
  }
}

async function showGoogleSignInPrompt(): Promise<void> {
  if (!showGoogleSignIn.value) {
    focusBeforeGoogleSignIn =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
  }
  showGoogleSignIn.value = true;
  await nextTick();
  googleSignInButton.value?.focus();
}

function restoreFocusAfterGoogleSignIn(): void {
  const target = focusBeforeGoogleSignIn;
  focusBeforeGoogleSignIn = null;
  void nextTick(() => target?.focus());
}

async function requestQueue(payloads: PromptPayload[]): Promise<void> {
  const authenticated = await auth.ensureActiveSession();
  const decision = await runAuthGate.request(
    payloads,
    authenticated,
    runAuthorizedPayloads,
  );
  if (decision === 'gated') await showGoogleSignInPrompt();
}

async function runAuthorizedPayloads(payloads: PromptPayload[]): Promise<void> {
  if (isSending.value) return;
  isSending.value = true;
  try {
    const existingRecovery = await recoverInterruptedRunCommits();
    if (existingRecovery.unresolvedCount > 0) {
      showNotice(
        'info',
        'A previous Run is safely staged and still reconciling. Wait before pressing Run again.',
      );
      return;
    }
    const acceptanceId = usageAuthorizer.createAcceptanceId();
    const reservation = await usageAuthorizer.reserveRun(
      payloads.length,
      acceptanceId,
    );
    if (reservation.status === 'authentication_required') {
      await auth.ensureActiveSession();
      await runAuthGate.request(payloads, false, runAuthorizedPayloads);
      showNotice('info', reservation.message);
      await showGoogleSignInPrompt();
      return;
    }
    if (
      reservation.status !== 'reserved' &&
      reservation.status !== 'legacy_protocol'
    ) {
      showNotice(
        reservation.status === 'denied' ? 'info' : 'error',
        reservation.message,
      );
      return;
    }
    const transition = await queueReservedPayloads(
      payloads,
      acceptanceId,
      reservation.status === 'reserved'
        ? {
            lifecycle: 'reservation',
            authorizationId: reservation.authorizationId,
          }
        : { lifecycle: 'legacy-immediate', units: payloads.length },
    );
    if (transition?.status === 'authentication_required') {
      pendingRunHasRecovery = true;
      await auth.ensureActiveSession();
      await runAuthGate.request(payloads, false, runAuthorizedPayloads);
      showNotice('info', transition.message);
      await showGoogleSignInPrompt();
    } else if (transition?.status === 'unavailable') {
      showNotice('error', transition.message);
    } else if (transition?.status === 'denied') {
      showNotice('info', transition.message);
    }
  } finally {
    isSending.value = false;
  }
}

async function completeGoogleSignIn(): Promise<void> {
  const attempt = ++googleSignInAttempt;
  const result = await auth.signInWithGoogle();
  if (attempt !== googleSignInAttempt) return;

  if (result.status !== 'authenticated') {
    showNotice(result.status === 'canceled' ? 'info' : 'error', result.message);
    return;
  }

  showGoogleSignIn.value = false;
  restoreFocusAfterGoogleSignIn();
  const recoveryResult = await recoverInterruptedRunCommits();
  if (pendingRunHasRecovery) {
    pendingRunHasRecovery = false;
    runAuthGate.cancel();
    if (recoveryResult.recoveredCount > 0) {
      showNotice('success', 'Recovered the accepted Run after sign-in.');
      return;
    }
    if (recoveryResult.rolledBackCount > 0) {
      showNotice(
        'info',
        'The pending Run was safely rolled back. Press Run again when ready.',
      );
      return;
    }
    showNotice(
      'info',
      'The accepted Run is still awaiting recovery. Do not press Run again while it reconciles.',
    );
    return;
  }
  const resumed = await runAuthGate.resumeOnce(true, runAuthorizedPayloads);
  if (!resumed) showNotice('success', result.message);
}

function cancelGoogleSignInPrompt(): void {
  const hadPendingRun = runAuthGate.cancel();
  googleSignInAttempt += 1;
  auth.cancelGoogleSignIn();
  showGoogleSignIn.value = false;
  restoreFocusAfterGoogleSignIn();
  showNotice(
    'info',
    hadPendingRun
      ? 'Google sign-in was canceled. Run was not started.'
      : 'Google sign-in was canceled.',
  );
}

function onPanelKeydown(event: KeyboardEvent): void {
  if (!showGoogleSignIn.value || event.key !== 'Escape') return;
  event.preventDefault();
  cancelGoogleSignInPrompt();
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

async function openCentralAuth(): Promise<void> {
  await showGoogleSignInPrompt();
}

async function openGrokAutomatorGuide(): Promise<void> {
  try {
    await chrome.tabs.create({ url: DEPLOYED_GROK_AUTOMATOR_GUIDE_URL });
  } catch {
    showNotice('error', 'Could not open the Grok Automator user guide.');
  }
}

async function openPlatformPage(path: string): Promise<void> {
  const origin = configuredOriginOrDefault(
    import.meta.env.WXT_PLATFORM_WEB_ORIGIN,
    DEPLOYED_PLATFORM_WEB_ORIGIN,
  );
  try {
    await chrome.tabs.create({ url: new URL(path, origin).toString() });
  } catch {
    showNotice(
      'error',
      'Could not open the Paks Tools Faceless automations portal.',
    );
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
    `Grok Automator™ v${version}`,
    `Mode: ${selectedMode.value}`,
    `Grok page detected: ${isGrokPage.value}`,
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
  window.addEventListener('keydown', onPanelKeydown);
  stopRuntime = installRuntimeState();
  chrome.runtime.onUpdateAvailable.addListener(onUpdateAvailable);
  stopSettingsWatch = watchSettings(applySyncedSettings, () => {
    showNotice('error', 'Invalid settings from another panel were ignored.');
  });
  const [storedSettingsResult, count] = await Promise.all([
    loadSettings().then(
      (value) => ({ success: true as const, value }),
      (error: unknown) => ({ success: false as const, error }),
    ),
    loadDailyPromptCount(),
    auth.restoreSession(),
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
  dailyCount.value = count;
  if (auth.state.error) showNotice('error', auth.state.error);
  const recoveryResult = await recoverInterruptedRunCommits();
  if (recoveryResult.recoveredCount > 0) {
    showNotice(
      'success',
      `Recovered ${recoveryResult.recoveredCount} accepted Run${recoveryResult.recoveredCount === 1 ? '' : 's'}.`,
    );
  } else if (recoveryResult.unresolvedCount > 0) {
    showNotice(
      'info',
      'An accepted Run is still reconciling. Do not press Run again yet.',
    );
  }
  pagePoller = window.setInterval(() => void refreshGrokState(), 2000);
  runRecoveryPoller = window.setInterval(
    () => void recoverInterruptedRunCommits().catch(() => undefined),
    5000,
  );
});

onUnmounted(() => {
  googleSignInAttempt += 1;
  auth.cancelGoogleSignIn();
  runAuthGate.cancel();
  window.removeEventListener('keydown', onPanelKeydown);
  flushPendingAutoSave();
  stopSettingsWatch?.();
  stopRuntime?.();
  if (pagePoller !== null) window.clearInterval(pagePoller);
  if (runRecoveryPoller !== null) window.clearInterval(runRecoveryPoller);
  if (noticeTimer !== null) window.clearTimeout(noticeTimer);
  for (const entry of [...expectedSettingsEchoes]) {
    removeExpectedSettingsEcho(entry);
  }
  chrome.runtime.onUpdateAvailable.removeListener(onUpdateAvailable);
});
</script>

<template>
  <main class="app-shell" :inert="showGoogleSignIn">
    <div v-if="notice" class="notice" :data-kind="notice.kind" role="status">
      {{ notice.message }}
    </div>

    <div class="app-header">
      <AppHeader
        :title="t('title')"
        :version="version"
        :description="t('description')"
        :locale="i18n.locale.value"
        :locales="ACTIVE_LOCALES"
        @update:locale="i18n.setLocale"
        @guide="openGrokAutomatorGuide"
        @community="openPlatformPage('/community')"
      />
      <PlanBanner
        :daily-count="dailyCount"
        :signed-in="auth.state.isLoggedIn"
        :pro="auth.state.isPro"
        :busy="auth.state.isChecking"
        :account-email="auth.state.accountEmail"
        :account-display-name="auth.state.accountDisplayName"
        :plan-code="auth.state.planCode"
        @sign-in="openCentralAuth"
        @upgrade="openCentralAuth"
      />
    </div>

    <nav class="main-tabs" aria-label="Side panel sections">
      <button
        :class="{ active: activeTab === 'control' }"
        type="button"
        @click="selectTab('control')"
      >
        <IconAdjustmentsHorizontal :size="17" aria-hidden="true" />
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
        <IconBug :size="17" aria-hidden="true" />
        {{ t('debug') }}
      </button>
    </nav>

    <section v-if="activeTab === 'control'" class="tab-content control-tab">
      <div v-if="!isGrokPage" class="grok-warning">
        <div>
          <strong>{{ t('notOnGrok') }}</strong>
          <span>The page is checked every two seconds.</span>
        </div>
        <button
          class="button primary small"
          type="button"
          @click="navigateToGrok"
        >
          {{ t('openGrok') }}
        </button>
      </div>

      <ModeSelector v-model="selectedMode" />
      <PromptComposer
        v-model="promptText[selectedMode]"
        :uploaded-images="uploadedImages[selectedMode]"
        :mode="selectedMode"
        :settings="settings"
        :daily-count="dailyCount"
        :is-pro="true"
        :is-busy="isSending"
        @update:uploaded-images="uploadedImages[selectedMode] = $event"
        @update:settings="updateWorkingSettings"
        @queue="requestQueue"
        @upgrade="openCentralAuth"
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
      <SettingsPanel
        :settings="settings"
        :saving="isSaving"
        :locale="i18n.locale.value"
        @save="persistSettings"
        @reset="restoreDefaults"
        @update:locale="i18n.setLocale"
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
      title="Sign in with Google"
      :visible="showGoogleSignIn"
      @close="cancelGoogleSignInPrompt"
    >
      <p id="google-sign-in-description" class="modal-copy">
        Run requires a short-lived Paks Tools Faceless automations session.
        Continue to the owned sign-in page and use Google, the only supported
        provider.
      </p>
      <p v-if="auth.state.error" class="form-error" role="alert">
        {{ auth.state.error }}
      </p>
      <div
        v-if="auth.state.userCode"
        class="verification-code"
        aria-live="polite"
      >
        <span>Verification code</span>
        <code>{{ auth.state.userCode }}</code>
        <small>Confirm this exact code on the owned sign-in page.</small>
      </div>
      <template #footer>
        <button
          class="button ghost"
          type="button"
          @click="cancelGoogleSignInPrompt"
        >
          Cancel
        </button>
        <button
          ref="googleSignInButton"
          class="button primary"
          type="button"
          aria-describedby="google-sign-in-description"
          :disabled="auth.state.isChecking"
          @click="completeGoogleSignIn"
        >
          {{
            auth.state.isChecking
              ? 'Waiting for Google…'
              : 'Continue with Google'
          }}
        </button>
      </template>
    </ModalShell>

    <ModalShell
      title="Report a problem"
      :visible="showReport"
      @close="showReport = false"
    >
      <p class="modal-copy">
        Copy the latest local diagnostics, then paste them into the Paks Tools
        Faceless automations support channel. Prompts and images are not
        included.
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
      title="Extension update available"
      :visible="showUpdate"
      persistent
    >
      <p class="modal-copy">
        Chrome has found a newer version. Finish active batches, then reload the
        extension to apply it.
      </p>
      <template #footer>
        <button
          class="button primary full"
          type="button"
          @click="applyAvailableUpdate"
        >
          Reload extension
        </button>
      </template>
    </ModalShell>
  </main>
</template>
