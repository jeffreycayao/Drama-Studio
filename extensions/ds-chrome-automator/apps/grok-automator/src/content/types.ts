import type {
  AutomationStep,
  PreparedImage,
  PromptPayload,
  PromptResult,
} from '../protocol/content';
import type { GroupStatus } from '../protocol/runtime';

export type SendResponse = (response: unknown) => void;
export type CancellationCheck = () => boolean;

export interface PromptGroup {
  id: string;
  acceptanceId: string;
  payloads: PromptPayload[];
  concurrentPrompts: number;
  promptDelaySecondsMin: number;
  promptDelaySecondsMax: number;
  status: GroupStatus;
  createdAt: number;
  processedCount: number;
  totalCount: number;
  isCancelling: boolean;
  delayRemainingSeconds?: number;
  results: PromptResult[];
  pendingIndexes: number[];
  completedPromptIndexes: Set<number>;
  retryCountByIndex: Record<number, number>;
  downloadRetryCountByIndex: Record<number, number>;
  currentPromptIndex?: number;
}

export interface ImageChunkBuffer {
  chunks: Array<string | undefined>;
  totalChunks: number;
  receivedCount: number;
  totalChars: number;
  updatedAt: number;
}

export interface DownloadItem {
  elementIDs: string[];
  config: PromptPayload;
  promptIndex: number;
  index: number;
  retryCount: number;
  pendingResourceIndexes?: number[];
  resourceDescriptors?: GeneratedResourceDescriptor[];
}

export interface DownloadGroup {
  id: string;
  items: DownloadItem[];
  status: GroupStatus;
  isCancelling: boolean;
}

export interface PendingPromptGroup {
  acceptanceId: string;
  group: PromptGroup;
  preparedImages: PreparedImageStore;
}

export interface GeneratedResourceDescriptor {
  kind: 'image' | 'video';
  source: string;
}

export interface AutomationResult {
  success: boolean;
  steps: AutomationStep[];
  elementIDs?: string[];
  cancelled?: boolean;
  error?: string;
}

export interface DownloadResult {
  success: boolean;
  cancelled?: boolean;
  error?: string;
  failedResourceIndexes?: number[];
  resourceDescriptors?: GeneratedResourceDescriptor[];
  nextPromptExtendVideo?: boolean;
  nextPromptEditImage?: boolean;
  extractedFrame?: string;
}

export type PreparedImageStore = Record<string, PreparedImage>;
