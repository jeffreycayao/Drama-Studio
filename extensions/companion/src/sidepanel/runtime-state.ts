import { computed, readonly, ref } from 'vue';

import { parseRuntimeMessage } from './protocol';
import type {
  GenerationProgress,
  LogEntry,
  PromptGroup,
  PromptPayload,
} from './types';

const promptGroups = ref<PromptGroup[]>([]);
const logs = ref<LogEntry[]>([]);
const progress = ref<Record<string, GenerationProgress>>({});
const RUNTIME_SNAPSHOT_KEY = 'grok-automation-runtime-state';
let listenerInstalled = false;
let keepAlivePort: chrome.runtime.Port | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;

function progressKey(groupId: string, promptIndex: number): string {
  return `${groupId}:${promptIndex}`;
}

function isTerminalGroup(group: PromptGroup): boolean {
  return (
    group.status === 'completed' ||
    group.status === 'cancelled' ||
    group.status === 'stopped' ||
    group.status === 'error'
  );
}

function addLog(entry: LogEntry): void {
  logs.value = [...logs.value, entry].slice(-500);
  scheduleSnapshot();
}

function upsertGroup(group: PromptGroup): void {
  const index = promptGroups.value.findIndex(
    (candidate) => candidate.id === group.id,
  );
  if (index < 0) promptGroups.value.push(group);
  else promptGroups.value[index] = { ...promptGroups.value[index], ...group };
  promptGroups.value.sort((left, right) => left.createdAt - right.createdAt);
  scheduleSnapshot();
}

function scheduleSnapshot(): void {
  if (!chrome.storage?.session) return;
  if (persistTimer !== null) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void chrome.storage.session
      .set({
        [RUNTIME_SNAPSHOT_KEY]: {
          promptGroups: promptGroups.value,
          logs: logs.value,
          progress: progress.value,
        },
      })
      .catch(() => undefined);
  }, 250);
}

async function restoreSnapshot(): Promise<void> {
  if (!chrome.storage?.session) return;
  try {
    const stored = await chrome.storage.session.get(RUNTIME_SNAPSHOT_KEY);
    const raw = stored[RUNTIME_SNAPSHOT_KEY];
    if (typeof raw !== 'object' || raw === null) return;
    const candidate = raw as Record<string, unknown>;

    if (Array.isArray(candidate.promptGroups)) {
      for (const group of candidate.promptGroups) {
        const parsed = parseRuntimeMessage({
          type: 'PROMPT_GROUP_STATUS',
          data: group,
        });
        if (
          parsed?.type === 'PROMPT_GROUP_STATUS' &&
          !promptGroups.value.some((current) => current.id === parsed.data.id)
        ) {
          upsertGroup(parsed.data as PromptGroup);
        }
      }
    }
    if (Array.isArray(candidate.logs) && logs.value.length === 0) {
      logs.value = candidate.logs.flatMap((entry) => {
        const parsed = parseRuntimeMessage({ type: 'ACTION_LOG', data: entry });
        return parsed?.type === 'ACTION_LOG' ? [parsed.data] : [];
      });
    }
    if (typeof candidate.progress === 'object' && candidate.progress !== null) {
      const restoredProgress: Record<string, GenerationProgress> = {};
      for (const [key, value] of Object.entries(candidate.progress)) {
        const parsed = parseRuntimeMessage({
          type: 'VIDEO_GENERATION_PROGRESS',
          data: value,
        });
        if (parsed?.type === 'VIDEO_GENERATION_PROGRESS') {
          restoredProgress[key] = {
            ...parsed.data,
            prompt: parsed.data.prompt ?? `Prompt ${parsed.data.promptIndex}`,
          };
        }
      }
      progress.value = { ...restoredProgress, ...progress.value };
    }
  } catch {
    // Session replay is best effort; live runtime messages remain authoritative.
  }
}

function senderTabId(sender: chrome.runtime.MessageSender): number | undefined {
  return sender.tab?.id;
}

function handleMessage(
  message: unknown,
  sender: chrome.runtime.MessageSender,
): boolean {
  const parsed = parseRuntimeMessage(message);
  if (!parsed) return false;
  if (parsed.type === 'ACTION_LOG') {
    addLog(parsed.data);
  } else if (parsed.type === 'VIDEO_GENERATION_PROGRESS') {
    const data: GenerationProgress = {
      ...parsed.data,
      prompt: parsed.data.prompt ?? `Prompt ${parsed.data.promptIndex}`,
    };
    progress.value = {
      ...progress.value,
      [progressKey(data.groupId, data.promptIndex)]: data,
    };
    scheduleSnapshot();
  } else if (parsed.type === 'CONTENT_SCRIPT_RESET') {
    const tabId = senderTabId(sender);
    if (tabId !== undefined) {
      const removedGroupIds = new Set(
        promptGroups.value
          .filter((group) => group.tabId === tabId)
          .map((group) => group.id),
      );
      promptGroups.value = promptGroups.value.filter(
        (group) => group.tabId !== tabId,
      );
      progress.value = Object.fromEntries(
        Object.entries(progress.value).filter(
          ([key]) =>
            ![...removedGroupIds].some((id) => key.startsWith(`${id}:`)),
        ),
      );
      scheduleSnapshot();
    }
  } else if (parsed.type === 'PROMPT_GROUP_STATUS') {
    const tabId = senderTabId(sender);
    upsertGroup({
      ...(parsed.data as PromptGroup),
      ...(tabId === undefined ? {} : { tabId }),
    });
  }
  return true;
}

export function addOptimisticGroup(
  groupId: string,
  payloads: PromptPayload[],
  tabId?: number,
): void {
  if (promptGroups.value.some((group) => group.id === groupId)) return;
  upsertGroup({
    id: groupId,
    ...(tabId === undefined ? {} : { tabId }),
    status: 'queued',
    processedCount: 0,
    totalCount: payloads.length,
    createdAt: Date.now(),
    isCancelling: false,
    isActive: false,
    results: [],
    promptPreviews: payloads.map((payload) => payload.prompt.slice(0, 60)),
    promptIndices: payloads.map((payload) => payload.promptIndex),
    retryCountByIndex: {},
    downloadRetryCountByIndex: {},
  });
}

export function installRuntimeState(): () => void {
  if (!listenerInstalled) {
    chrome.runtime.onMessage.addListener(handleMessage);
    listenerInstalled = true;
  }
  void restoreSnapshot();
  try {
    keepAlivePort ??= chrome.runtime.connect(chrome.runtime.id, {
      name: 'side-panel',
    });
    keepAlivePort.onDisconnect.addListener(() => {
      // Reading lastError prevents Chrome from reporting an unchecked error
      // when a development background worker has no port listener yet.
      void chrome.runtime.lastError;
      keepAlivePort = null;
    });
  } catch {
    keepAlivePort = null;
  }
  return () => {
    if (listenerInstalled) {
      chrome.runtime.onMessage.removeListener(handleMessage);
      listenerInstalled = false;
    }
    keepAlivePort?.disconnect();
    keepAlivePort = null;
    scheduleSnapshot();
  };
}

export function useRuntimeState() {
  return {
    promptGroups: readonly(promptGroups),
    logs: readonly(logs),
    progress: readonly(progress),
    activeGroups: computed(() =>
      promptGroups.value.filter(
        (group) => group.status === 'queued' || group.status === 'running',
      ),
    ),
    clearLogs: () => {
      logs.value = [];
      scheduleSnapshot();
    },
    clearCompleted: () => {
      const removed = new Set(
        promptGroups.value.filter(isTerminalGroup).map((group) => group.id),
      );
      promptGroups.value = promptGroups.value.filter(
        (group) => !isTerminalGroup(group),
      );
      progress.value = Object.fromEntries(
        Object.entries(progress.value).filter(
          ([key]) => ![...removed].some((id) => key.startsWith(`${id}:`)),
        ),
      );
      scheduleSnapshot();
    },
    addLocalLog: (level: LogEntry['level'], message: string) =>
      addLog({ level, message, timestamp: Date.now() }),
  };
}
