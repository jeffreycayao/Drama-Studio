import type { PromptResult } from './content';
import type { PageStop } from '../sites/types';
import { z } from 'zod/mini';

export type GroupStatus =
  'queued' | 'running' | 'completed' | 'cancelled' | 'stopped' | 'error';

export interface PromptGroupStatusData {
  id: string;
  status: GroupStatus;
  processedCount: number;
  totalCount: number;
  createdAt: number;
  isCancelling: boolean;
  isActive: boolean;
  delayRemainingSeconds?: number;
  results: Array<
    Pick<
      PromptResult,
      'index' | 'promptIndex' | 'success' | 'downloadComplete' | 'error'
    >
  >;
  currentPromptIndex?: number;
  /** Set when the page blocked the batch; never retried. */
  stop?: PageStop;
  promptPreviews: string[];
  promptIndices: number[];
  retryCountByIndex: Record<number, number>;
  downloadRetryCountByIndex: Record<number, number>;
}

export type RuntimeEvent =
  | { type: 'CONTENT_SCRIPT_RESET' }
  | { type: 'SET_ZOOM'; zoomFactor: number }
  | { type: 'PROMPT_GROUP_STATUS'; data: PromptGroupStatusData }
  | {
      type: 'ACTION_LOG';
      data: {
        level: 'info' | 'warn' | 'error';
        message: string;
        timestamp: number;
      };
    }
  | {
      type: 'VIDEO_GENERATION_PROGRESS';
      data: {
        groupId?: string;
        promptIndex: number;
        percentage: number;
        status: 'generating' | 'completed';
        prompt: string;
      };
    }
  | {
      type: 'SET_FOLDER_NAME';
      folderName: string;
      prefix: string;
      autoChangeFileName: boolean;
    }
  | {
      type: 'DOWNLOAD_RESOURCE';
      url: string;
      filename: string;
      folder: string;
      autoChangeFileName: boolean;
    };

export type RuntimeResponseMap = {
  DOWNLOAD_RESOURCE: {
    success: boolean;
    downloadId?: number;
    error?: string;
    retryable?: boolean;
  };
};

export const pageStopSchema = z.object({
  reason: z.enum([
    'captcha',
    'usage-limit',
    'moderation',
    'sign-in',
    'site-changed',
  ]),
  message: z.string().check(z.maxLength(500)),
});

const statusResultSchema = z.object({
  index: z.number(),
  promptIndex: z.number(),
  success: z.boolean(),
  downloadComplete: z.boolean(),
  error: z.optional(z.string()),
});

const promptGroupStatusDataSchema = z.object({
  id: z.string().check(z.minLength(1)),
  status: z.enum([
    'queued',
    'running',
    'completed',
    'cancelled',
    'stopped',
    'error',
  ]),
  processedCount: z.number(),
  totalCount: z.number(),
  createdAt: z.number(),
  isCancelling: z.boolean(),
  isActive: z.boolean(),
  delayRemainingSeconds: z.optional(z.number()),
  results: z.array(statusResultSchema),
  currentPromptIndex: z.optional(z.number()),
  stop: z.optional(pageStopSchema),
  promptPreviews: z.array(z.string()),
  promptIndices: z.array(z.number()),
  retryCountByIndex: z.record(z.string(), z.number()),
  downloadRetryCountByIndex: z.record(z.string(), z.number()),
});

export const runtimeEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('CONTENT_SCRIPT_RESET') }),
  z.object({
    type: z.literal('SET_ZOOM'),
    zoomFactor: z.number().check(z.positive()),
  }),
  z.object({
    type: z.literal('PROMPT_GROUP_STATUS'),
    data: promptGroupStatusDataSchema,
  }),
  z.object({
    type: z.literal('ACTION_LOG'),
    data: z.object({
      level: z.enum(['info', 'warn', 'error']),
      message: z.string(),
      timestamp: z.number(),
    }),
  }),
  z.object({
    type: z.literal('VIDEO_GENERATION_PROGRESS'),
    data: z.object({
      groupId: z.optional(z.string()),
      promptIndex: z.number(),
      percentage: z.number(),
      status: z.enum(['generating', 'completed']),
      prompt: z.string(),
    }),
  }),
  z.object({
    type: z.literal('SET_FOLDER_NAME'),
    folderName: z.string(),
    prefix: z.string(),
    autoChangeFileName: z.boolean(),
  }),
  z.object({
    type: z.literal('DOWNLOAD_RESOURCE'),
    url: z.string().check(z.minLength(1)),
    filename: z.string().check(z.minLength(1)),
    folder: z.string(),
    autoChangeFileName: z.boolean(),
  }),
]);

export function sendRuntimeEvent(message: RuntimeEvent): void {
  const parsed = runtimeEventSchema.safeParse(message);
  if (!parsed.success) return;
  try {
    void chrome.runtime.sendMessage(parsed.data).catch(() => undefined);
  } catch {
    // The extension can be reloaded while an old content script is still alive.
  }
}
