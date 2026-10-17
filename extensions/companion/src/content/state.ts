import type {
  DownloadGroup,
  ImageChunkBuffer,
  PreparedImageStore,
  PromptGroup,
} from './types';

export const promptGroupQueue: PromptGroup[] = [];
export const downloadQueue: DownloadGroup[] = [];
export const preparedImages: PreparedImageStore = {};
export const imageChunkBuffers: Record<string, ImageChunkBuffer> = {};

let activePromptGroupId: string | null = null;

export function getActivePromptGroupId(): string | null {
  return activePromptGroupId;
}

export function setActivePromptGroupId(groupId: string | null): void {
  activePromptGroupId = groupId;
}

export function resetContentState(): void {
  promptGroupQueue.splice(0);
  downloadQueue.splice(0);
  for (const key of Object.keys(preparedImages)) delete preparedImages[key];
  for (const key of Object.keys(imageChunkBuffers))
    delete imageChunkBuffers[key];
  activePromptGroupId = null;
}
