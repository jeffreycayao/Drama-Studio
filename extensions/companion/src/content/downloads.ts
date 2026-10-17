import {
  domResourceSourceSchema,
  downloadResponseSchema,
  type AutomationConfig,
  type PromptPayload,
  type SelectorConfig,
} from '../protocol/content';
import { sendRuntimeEvent } from '../protocol/runtime';
import { dismissComparisonImage } from './automation';
import {
  CANCELLED_ERROR_MESSAGE,
  clickElement,
  delayWithCancellation,
  waitForElement,
} from './dom/interactions';
import {
  collectionToArray,
  query,
  type QueryCollection,
} from './dom/jquery-bridge';
import { logError, logInfo } from './logger';
import { extractLastVideoFrame, sanitizeFilename } from './media';
import type {
  CancellationCheck,
  DownloadResult,
  GeneratedResourceDescriptor,
} from './types';

type GeneratedResource = HTMLImageElement | HTMLVideoElement;

interface ResourceSearchResult {
  success: boolean;
  resources: GeneratedResource[];
}

export class ResourceDownloadError extends Error {
  readonly failedResourceIndexes: number[];

  constructor(message: string, failedResourceIndexes: number[]) {
    super(message);
    this.name = 'ResourceDownloadError';
    this.failedResourceIndexes = failedResourceIndexes;
  }
}

class NonRetryableResourceDownloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NonRetryableResourceDownloadError';
  }
}

function isGeneratedResource(element: Element): element is GeneratedResource {
  return (
    element instanceof HTMLImageElement || element instanceof HTMLVideoElement
  );
}

function sendGenerationProgress(
  payload: PromptPayload,
  percentage: number,
  status: 'generating' | 'completed',
): void {
  sendRuntimeEvent({
    type: 'VIDEO_GENERATION_PROGRESS',
    data: {
      ...(payload.groupId === undefined ? {} : { groupId: payload.groupId }),
      promptIndex: payload.promptIndex,
      percentage,
      status,
      prompt: payload.prompt,
    },
  });
}

function resourceArray(collection: QueryCollection): GeneratedResource[] {
  return collectionToArray(collection).filter(isGeneratedResource);
}

function selectResources(
  article: QueryCollection,
  payload: PromptPayload,
  selectors: SelectorConfig,
): GeneratedResource[] {
  if (
    payload.mode === 'imageToImage' ||
    payload.outputPreviousPrompt?.nextPromptEditImage
  ) {
    return resourceArray(article.find('div.grid > img'));
  }
  if (payload.mode === 'textToImage') {
    return resourceArray(article.find(selectors.generatedImageItem));
  }
  return resourceArray(article.find('video'));
}

async function waitForGeneratedResources(
  elementIDs: readonly string[],
  payload: PromptPayload,
  isCancelled: CancellationCheck,
  config: AutomationConfig,
): Promise<ResourceSearchResult> {
  const selectors = config.selectors;
  const articleSelector = elementIDs[0] ?? selectors.mainArticle;
  const firstSeen = new Map<Element, { source: string; timestamp: number }>();
  let resources: GeneratedResource[] = [];
  let attempt = 0;
  let generationTriggered = false;

  while (attempt < 150) {
    if (isCancelled()) return { success: false, resources: [] };
    let article = await waitForElement(articleSelector, isCancelled);
    article = article?.last() ?? null;
    if (!article?.length) {
      await delayWithCancellation(2_000, isCancelled);
      attempt += 1;
      continue;
    }

    let candidates = selectResources(article, payload, selectors);
    if (
      payload.mode === 'textToImage' &&
      !payload.outputPreviousPrompt?.nextPromptEditImage
    ) {
      const now = Date.now();
      for (const resource of candidates) {
        const prior = firstSeen.get(resource);
        if (!prior || prior.source !== resource.src) {
          firstSeen.set(resource, { source: resource.src, timestamp: now });
        }
      }
      candidates = candidates.filter((resource) => {
        const record = firstSeen.get(resource);
        return record !== undefined && now - record.timestamp >= 10_000;
      });
    }

    if (
      candidates.length < payload.outputCount &&
      payload.mode.includes('ToVideo') &&
      query(selectors.generateVideoButton).length > 0 &&
      !generationTriggered
    ) {
      generationTriggered = true;
      await clickElement(
        selectors.generateVideoButton,
        'Generate video button',
        isCancelled,
      );
    }

    if (candidates.length >= payload.outputCount && candidates[0]?.src) {
      resources = candidates.slice(0, payload.outputCount);
      await dismissComparisonImage(selectors, isCancelled);
      sendGenerationProgress(payload, 100, 'completed');
      break;
    }

    if (
      payload.mode === 'textToImage' &&
      !payload.outputPreviousPrompt?.nextPromptEditImage
    ) {
      sendGenerationProgress(
        payload,
        Math.min(
          Math.round((candidates.length / payload.outputCount) * 100),
          99,
        ),
        'generating',
      );
    } else {
      const percentage = await readGenerationPercentage(selectors, isCancelled);
      if (percentage > 0) {
        sendGenerationProgress(payload, percentage, 'generating');
      } else {
        // Preserves the recovered bundle's accelerated timeout when no progress UI exists.
        attempt += 20;
      }
    }

    await delayWithCancellation(2_000, isCancelled);
    attempt += 1;
  }

  return { success: resources.length > 0, resources };
}

async function readGenerationPercentage(
  selectors: SelectorConfig,
  isCancelled: CancellationCheck,
): Promise<number> {
  let percentage = -1;
  const circle = await waitForElement(selectors.percentageSvg, isCancelled);
  const label = await waitForElement(selectors.percentageSpan, isCancelled);
  if (circle?.length) {
    const dashArray = circle.first().attr('stroke-dasharray') ?? '';
    const dashOffset = circle.first().attr('stroke-dashoffset') ?? '';
    const total = Number.parseFloat(dashArray.split(' ')[0] ?? '');
    const offset = Number.parseFloat(dashOffset);
    if (Number.isFinite(total) && Number.isFinite(offset) && total > 0) {
      percentage = Math.max(
        0,
        Math.min(100, Math.round(100 * (1 - offset / total))),
      );
    }
  }
  if (label?.length) {
    percentage = Number.parseInt(
      label.first().text().trim().replace('%', ''),
      10,
    );
  }
  if (query('.animate-spin').length > 0)
    percentage = percentage > 0 ? percentage + 1 : 1;
  return Number.isFinite(percentage) ? percentage : -1;
}

async function createConcatOutput(
  resources: GeneratedResource[],
  payload: PromptPayload,
  selectors: SelectorConfig,
  isCancelled: CancellationCheck,
): Promise<Omit<DownloadResult, 'success'>> {
  await dismissComparisonImage(selectors, isCancelled);
  if (payload.isConcat && payload.mode.includes('ToVideo')) {
    if (await waitForElement(selectors.shareButton, isCancelled, 5_000)) {
      await clickElement(
        selectors.shareButton,
        'Create share link button',
        isCancelled,
      );
      await delayWithCancellation(1_000, isCancelled);
    }
    const frame = await extractLastVideoFrame(
      resources.filter(
        (resource): resource is HTMLVideoElement =>
          resource instanceof HTMLVideoElement,
      ),
      isCancelled,
    );
    return frame ? { nextPromptExtendVideo: true, extractedFrame: frame } : {};
  }
  if (payload.isConcat && payload.mode.includes('ToImage')) {
    query(resources).click();
    return { nextPromptEditImage: true };
  }
  return {};
}

function configureDownloadNaming(payload: PromptPayload): {
  prefix: string;
  folder: string;
} {
  const index = String(payload.promptIndex).padStart(3, '0');
  const prefix = `${index}_${sanitizeFilename(payload.prompt)}_`;
  const folder = payload.folderName.trim();
  sendRuntimeEvent({
    type: 'SET_FOLDER_NAME',
    folderName: folder,
    prefix,
    autoChangeFileName: payload.autoChangeFileName !== false,
  });
  return { prefix, folder };
}

async function prepareVideoQuality(
  payload: PromptPayload,
  selectors: SelectorConfig,
  isCancelled: CancellationCheck,
): Promise<void> {
  const quality = payload.autoDownloadResourceQuality;
  if (
    quality.includes('upscale') ||
    quality === '720p' ||
    quality === '1080p'
  ) {
    if (query(selectors.hdButton).length === 0) {
      try {
        if (query(selectors.moreOptionsButton).length > 0) {
          await clickElement(
            selectors.moreOptionsButton,
            'Open more options button',
            isCancelled,
          );
        }
        if (query(selectors.upscaleMenuItem).length === 0) {
          throw new Error('Requested video upscale control is unavailable');
        }
        await clickElement(
          selectors.upscaleMenuItem,
          'Upscale video option',
          isCancelled,
        );
        await delayWithCancellation(2_000, isCancelled);
        const option = quality.includes('upscale')
          ? selectors.upscale720pOption
          : quality === '1080p'
            ? selectors.upscale1080pOption
            : null;
        if (option) {
          if (!(await waitForElement(option, isCancelled, 3_000))) {
            throw new Error('Requested video quality option is unavailable');
          }
          await clickElement(option, 'Upscale quality option', isCancelled);
        }
        let upscaleComplete = false;
        for (let attempt = 0; attempt < 30; attempt += 1) {
          if (await waitForElement(selectors.hdButton, isCancelled, 2_000)) {
            upscaleComplete = true;
            break;
          }
          await delayWithCancellation(2_000, isCancelled);
        }
        if (!upscaleComplete) {
          throw new Error('Requested video upscale did not complete');
        }
      } catch (error) {
        if (String(error).includes(CANCELLED_ERROR_MESSAGE)) throw error;
        throw new Error('Failed to prepare requested video quality', {
          cause: error,
        });
      }
    }
  }
}

async function requestResourceDownload(
  url: string,
  filename: string,
  folder: string,
  autoChangeFileName: boolean,
): Promise<void> {
  const response: unknown = await chrome.runtime.sendMessage({
    type: 'DOWNLOAD_RESOURCE',
    url,
    filename,
    folder,
    autoChangeFileName,
  });
  const parsed = downloadResponseSchema.safeParse(response);
  if (!parsed.success || !parsed.data.success) {
    const message = parsed.success
      ? parsed.data.error || 'Failed to initiate download'
      : 'Invalid download response';
    if (!parsed.success || parsed.data.retryable === false) {
      throw new NonRetryableResourceDownloadError(message);
    }
    throw new Error(message);
  }
}

export async function downloadImages(
  resources: readonly GeneratedResource[],
  payload: PromptPayload,
  folder: string,
  isCancelled: CancellationCheck,
  pendingResourceIndexes?: readonly number[],
): Promise<void> {
  return downloadResourceDescriptors(
    resources.map((resource) => ({
      kind: resource instanceof HTMLVideoElement ? 'video' : 'image',
      source: resource.src,
    })),
    payload,
    folder,
    isCancelled,
    pendingResourceIndexes,
  );
}

function resourceFilename(
  descriptor: GeneratedResourceDescriptor,
  payload: PromptPayload,
  resourceIndex: number,
): string {
  const index = String(payload.promptIndex).padStart(3, '0');
  let extension = descriptor.kind === 'video' ? 'mp4' : 'jpg';
  try {
    const pathname = new URL(descriptor.source).pathname;
    const matched = /\.([a-z0-9]{2,5})$/iu.exec(pathname)?.[1]?.toLowerCase();
    if (
      matched &&
      (descriptor.kind === 'video'
        ? ['mp4', 'webm'].includes(matched)
        : ['avif', 'bmp', 'gif', 'jpeg', 'jpg', 'png', 'webp'].includes(
            matched,
          ))
    ) {
      extension = matched;
    }
  } catch {
    // The URL schema below remains authoritative; this only chooses a suffix.
  }
  if (payload.autoChangeFileName !== false) {
    return `${index}_${sanitizeFilename(payload.prompt)}.${extension}`;
  }
  try {
    return (
      new URL(descriptor.source).pathname.split('/').pop() ||
      `${index}_resource_${resourceIndex + 1}.${extension}`
    );
  } catch {
    return `${index}_resource_${resourceIndex + 1}.${extension}`;
  }
}

export async function downloadResourceDescriptors(
  resources: readonly GeneratedResourceDescriptor[],
  payload: PromptPayload,
  folder: string,
  isCancelled: CancellationCheck,
  pendingResourceIndexes?: readonly number[],
): Promise<void> {
  const errors: string[] = [];
  const failedResourceIndexes: number[] = [];
  const resourceIndexes = [
    ...new Set(pendingResourceIndexes ?? resources.map((_, index) => index)),
  ];
  for (const resourceIndex of resourceIndexes) {
    const resource = resources[resourceIndex];
    const parsedSource = domResourceSourceSchema.safeParse(resource?.source);
    if (
      !Number.isSafeInteger(resourceIndex) ||
      resourceIndex < 0 ||
      !resource ||
      (resource.kind !== 'image' && resource.kind !== 'video') ||
      !parsedSource.success
    ) {
      errors.push(`resource ${resourceIndex + 1} has an unsupported URL`);
      failedResourceIndexes.push(resourceIndex);
      continue;
    }
    const source = parsedSource.data;
    try {
      const rename = payload.autoChangeFileName !== false;
      const filename = resourceFilename(resource, payload, resourceIndex);
      await requestResourceDownload(
        source,
        filename,
        rename ? folder : '',
        rename,
      );
      await delayWithCancellation(500, isCancelled);
    } catch (error) {
      if (String(error).includes(CANCELLED_ERROR_MESSAGE)) throw error;
      if (error instanceof NonRetryableResourceDownloadError) throw error;
      logError(`Error downloading resource ${payload.promptIndex}:`, error);
      errors.push(`resource ${resourceIndex + 1}: ${String(error)}`);
      failedResourceIndexes.push(resourceIndex);
    }
  }
  if (errors.length > 0) {
    throw new ResourceDownloadError(
      `Failed to download ${errors.length} of ${resourceIndexes.length} requested resources: ${errors.join('; ')}`,
      failedResourceIndexes,
    );
  }
}

export async function downloadFromElementIds(
  elementIDs: string[],
  payload: PromptPayload,
  isCancelled: CancellationCheck,
  config: AutomationConfig,
  pendingResourceIndexes?: readonly number[],
  persistedResourceDescriptors?: readonly GeneratedResourceDescriptor[],
): Promise<DownloadResult> {
  let resourceDescriptors = persistedResourceDescriptors?.map((resource) => ({
    ...resource,
  }));
  let concatResult: Omit<DownloadResult, 'success'> = {};
  try {
    if (!resourceDescriptors && elementIDs.length === 0) {
      return { success: false, error: 'No generated article identifier' };
    }
    if (!resourceDescriptors) {
      const found = await waitForGeneratedResources(
        elementIDs,
        payload,
        isCancelled,
        config,
      );
      if (!found.success)
        return { success: false, error: 'Prompt generation failed' };

      if (
        payload.autoDownloadResourceQuality !== 'no-download' &&
        payload.mode.includes('ToVideo')
      ) {
        await prepareVideoQuality(payload, config.selectors, isCancelled);
      }
      resourceDescriptors = found.resources.map((resource) => ({
        kind: resource instanceof HTMLVideoElement ? 'video' : 'image',
        source: resource.src,
      }));
      concatResult = await createConcatOutput(
        found.resources,
        payload,
        config.selectors,
        isCancelled,
      );
    }
    if (payload.autoDownloadResourceQuality === 'no-download') {
      return {
        success: true,
        resourceDescriptors,
        ...concatResult,
      };
    }

    const { folder } = configureDownloadNaming(payload);
    await downloadResourceDescriptors(
      resourceDescriptors,
      payload,
      folder,
      isCancelled,
      pendingResourceIndexes,
    );

    return {
      success: true,
      resourceDescriptors,
      ...concatResult,
    };
  } catch (error) {
    if (String(error).includes(CANCELLED_ERROR_MESSAGE)) {
      logInfo('Download cancelled');
      return {
        success: false,
        cancelled: true,
        error: CANCELLED_ERROR_MESSAGE,
        ...(resourceDescriptors ? { resourceDescriptors } : {}),
        ...concatResult,
      };
    }
    logError('Error in downloadFromElementIds:', error);
    return {
      success: false,
      error: String(error),
      ...(resourceDescriptors ? { resourceDescriptors } : {}),
      ...concatResult,
      ...(error instanceof ResourceDownloadError
        ? { failedResourceIndexes: error.failedResourceIndexes }
        : {}),
    };
  }
}
