export const MODES = [
  'textToVideo',
  'imageToVideo',
  'componentsToVideo',
  'textToImage',
  'imageToImage',
] as const;

export type AutomationMode = (typeof MODES)[number];

export const ASPECT_RATIOS = ['16:9', '9:16', '1:1', '2:3', '3:2'] as const;
export type AspectRatio = (typeof ASPECT_RATIOS)[number];

export const VIDEO_OPTIONS = [
  '6s',
  '10s',
  '15s',
  '6s-concat',
  '10s-concat',
  '15s-concat',
] as const;
export type VideoOption = (typeof VIDEO_OPTIONS)[number];

export const IMAGE_OPTIONS = ['new-image', 'new-image-concat'] as const;
export type ImageOption = (typeof IMAGE_OPTIONS)[number];

export interface Settings {
  migrationVersion: 5;
  defaultMode: AutomationMode;
  aspectRatio: AspectRatio;
  concurrentPrompts: number;
  outputCount: number;
  imageOutputCount: number;
  promptDelaySecondsMin: number;
  promptDelaySecondsMax: number;
  imageModel: 'speed' | 'quality';
  defaultVideoOption: VideoOption;
  defaultImageOption: ImageOption;
  imageToVideoMaxImagesPerPrompt: number;
  componentsToVideoMaxImagesPerPrompt: number;
  imageToImageMaxImagesPerPrompt: number;
  maxRetries: number;
  autoDownloadVideoQuality: string;
  autoDownloadImageQuality: string;
  autoAddCharacterImages: boolean;
  autoChangeFileName: boolean;
  folderName: string;
  hideTipBeforeUse: boolean;
}

export interface UploadedImage {
  id: string;
  name: string;
  base64: string;
  uploadedAt: number;
}

export interface PromptPayload {
  prompt: string;
  mode: AutomationMode;
  aspectRatio: AspectRatio;
  outputCount: number;
  promptIndex: number;
  autoDownloadResourceQuality: string;
  concurrentPrompts: number;
  promptDelaySecondsMin: number;
  promptDelaySecondsMax: number;
  isConcat: boolean;
  maxRetries: number;
  autoChangeFileName: boolean;
  folderName: string;
  videoOption?: VideoOption;
  imageModel?: 'speed' | 'quality';
  images?: UploadedImage[];
  imageIds?: string[];
}

export type PromptGroupStatus =
  'queued' | 'running' | 'completed' | 'cancelled' | 'stopped' | 'error';

/** Why the page stopped a batch (see sites/types.ts). */
export interface BatchStop {
  reason: 'captcha' | 'usage-limit' | 'moderation' | 'sign-in' | 'site-changed';
  message: string;
}

export interface PromptResult {
  index: number;
  promptIndex: number;
  success: boolean;
  downloadComplete: boolean;
  error?: string;
}

export interface PromptGroup {
  id: string;
  /** Grok tab that owns this queue. Kept panel-local for safe cancellation. */
  tabId?: number;
  status: PromptGroupStatus;
  processedCount: number;
  totalCount: number;
  createdAt: number;
  isCancelling: boolean;
  isActive: boolean;
  delayRemainingSeconds?: number;
  results: PromptResult[];
  currentPromptIndex?: number;
  stop?: BatchStop;
  promptPreviews: string[];
  promptIndices: number[];
  retryCountByIndex: Record<string, number>;
  downloadRetryCountByIndex: Record<string, number>;
}

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: number;
}

export interface GenerationProgress {
  groupId: string;
  promptIndex: number;
  percentage: number;
  status: string;
  prompt: string;
}

export interface QueueOptions {
  groupId?: string;
  concurrentPrompts: number;
  promptDelaySecondsMin: number;
  promptDelaySecondsMax: number;
}
