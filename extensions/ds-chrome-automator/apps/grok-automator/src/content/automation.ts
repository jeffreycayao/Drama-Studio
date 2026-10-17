import type {
  AutomationConfig,
  AutomationStep,
  PreparedImage,
  PromptPayload,
  SelectorConfig,
} from '../protocol/content';
import {
  CANCELLED_ERROR_MESSAGE,
  clickElement,
  delayWithCancellation,
  isElementInteractable,
  waitForElement,
} from './dom/interactions';
import { collectionToArray, query } from './dom/jquery-bridge';
import { logError, logInfo, logWarning } from './logger';
import type { AutomationResult, CancellationCheck } from './types';

const AUTOMATION_STEP_NAMES = [
  'Redirect to Imagine',
  'Configure Video',
  'Fill Prompt',
  'Check & Download Resource',
] as const;

interface InlineImageMatch {
  index: number;
  length: number;
  imageIndex: number;
}

const GENERATED_ARTICLE_TOKEN_ATTRIBUTE = 'data-grok-automation-result-token';
let generatedArticleTokenCounter = 0;

export interface GeneratedArticleSnapshot {
  readonly fingerprints: ReadonlyMap<Element, string>;
}

function createSteps(): AutomationStep[] {
  return AUTOMATION_STEP_NAMES.map((name) => ({ name, status: 'pending' }));
}

function errorResult(steps: AutomationStep[], error: string): AutomationResult {
  return { success: false, steps, error };
}

function setStepError(step: AutomationStep | undefined, error: string): void {
  if (!step) return;
  step.status = 'error';
  step.error = error;
}

export async function runPromptAutomation(
  payload: PromptPayload,
  isCancelled: CancellationCheck,
  config: AutomationConfig,
): Promise<AutomationResult> {
  const steps = createSteps();
  try {
    logInfo('Starting Grok Automator™ - Step 1: Redirect to imagine page');
    const redirectStep = steps[0];
    if (redirectStep) redirectStep.status = 'running';
    if (payload.outputPreviousPrompt?.nextPromptEditImage) {
      logInfo('Skipping redirect to imagine page');
    } else if (!(await redirectToImaginePage(config, isCancelled))) {
      setStepError(redirectStep, 'Failed to redirect to imagine page');
      return errorResult(steps, 'Failed to redirect to imagine page');
    }
    if (redirectStep) redirectStep.status = 'completed';

    await dismissComparisonImage(config.selectors, isCancelled);
    const configureStep = steps[1];
    if (configureStep) configureStep.status = 'running';
    const configured = payload.mode.includes('ToVideo')
      ? await configureVideo(payload, isCancelled, config)
      : await configureImage(payload, isCancelled, config);
    if (!configured) {
      const message = payload.mode.includes('ToVideo')
        ? 'Failed to configure video'
        : 'Failed to configure image';
      setStepError(configureStep, message);
      return errorResult(steps, message);
    }
    if (configureStep) configureStep.status = 'completed';

    const promptStep = steps[2];
    if (promptStep) promptStep.status = 'running';
    const articleSnapshot = captureGeneratedArticleSnapshot(config);
    if (!(await fillGrokPrompt(payload, config, isCancelled))) {
      setStepError(promptStep, 'Failed to fill prompt');
      return errorResult(steps, 'Failed to fill prompt');
    }
    if (promptStep) promptStep.status = 'completed';

    await delayWithCancellation(5_000, isCancelled);
    const resultStep = steps[3];
    if (resultStep) resultStep.status = 'running';
    const elementIDs = await waitForGeneratedArticle(
      isCancelled,
      config,
      articleSnapshot,
    );
    if (elementIDs.length > 0) {
      if (resultStep) resultStep.status = 'completed';
      return { success: true, steps, elementIDs };
    }
    setStepError(resultStep, 'Could not find element IDs');
    return errorResult(steps, 'Could not find element IDs');
  } catch (error) {
    if (String(error).includes(CANCELLED_ERROR_MESSAGE)) {
      logInfo('Automation cancelled');
      return {
        success: false,
        steps,
        cancelled: true,
        error: CANCELLED_ERROR_MESSAGE,
      };
    }
    logError('Automation failed:', error);
    return errorResult(steps, String(error));
  }
}

export async function redirectToImaginePage(
  config: AutomationConfig,
  isCancelled: CancellationCheck,
): Promise<boolean> {
  try {
    const selector = config.selectors.imagineLink;
    if (query(selector).length > 0) {
      await clickElement(selector, 'Imagine link', isCancelled, 10_000);
    }
    return true;
  } catch (error) {
    if (String(error).includes(CANCELLED_ERROR_MESSAGE)) throw error;
    logError('Error in redirectToImaginePage:', error);
    return false;
  }
}

const MIME_FILE_EXTENSIONS: Readonly<Record<string, string>> = {
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/svg+xml': 'svg',
  'image/webp': 'webp',
};

function parsePreparedImageData(image: PreparedImage): {
  encoded: string;
  mimeType: string;
} {
  const match = /^data:([^;,]+)(?:;[^,]*)*;base64,(.*)$/s.exec(image.base64);
  const candidateMimeType = match?.[1]?.trim().toLowerCase();
  return {
    encoded: match?.[2] ?? image.base64,
    mimeType:
      candidateMimeType?.startsWith('image/') === true
        ? candidateMimeType
        : 'image/jpeg',
  };
}

export function decodePreparedImage(image: PreparedImage): File {
  const { encoded, mimeType } = parsePreparedImageData(image);
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  const blob = new Blob([bytes], { type: mimeType });
  const extension = MIME_FILE_EXTENSIONS[mimeType] ?? 'jpg';
  return new File(
    [blob],
    image.name?.trim() || `image-${Date.now()}.${extension}`,
    {
      type: mimeType,
    },
  );
}

async function setImageInput(
  payload: PromptPayload,
  imageIndex: number,
  config: AutomationConfig,
): Promise<boolean> {
  const image = payload.images?.[imageIndex];
  if (!image) {
    logWarning(`Image index ${imageIndex} is unavailable`);
    return false;
  }
  try {
    const file = decodePreparedImage(image);
    logInfo(`Creating file: ${file.name}, size: ${file.size} bytes`);
    const inputCollection = await waitForElement<HTMLInputElement>(
      config.selectors.fileInput,
      undefined,
      10_000,
      100,
      false,
    );
    const input = inputCollection?.first().get(0);
    if (!(input instanceof HTMLInputElement)) {
      logWarning('Could not find file input for image upload');
      return false;
    }
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  } catch (error) {
    logError('Error uploading image from base64:', error);
    return false;
  }
}

async function waitForUploadToFinish(
  selector: string,
  isCancelled: CancellationCheck,
  timeoutMilliseconds = 30_000,
): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMilliseconds) {
    if (isCancelled()) throw new Error(CANCELLED_ERROR_MESSAGE);
    if (!isElementInteractable(query(selector))) return true;
    await delayWithCancellation(200, isCancelled);
  }
  return false;
}

export async function uploadConfiguredImage(
  payload: PromptPayload,
  imageIndex: number,
  config: AutomationConfig,
  isCancelled: CancellationCheck,
): Promise<boolean> {
  const selectors = config.selectors;
  await clickElement(
    selectors.plusImageButton,
    'Upload image button',
    isCancelled,
  );
  if (!(await setImageInput(payload, imageIndex, config))) return false;
  await delayWithCancellation(3_000, isCancelled);
  const uploadFinished = await waitForUploadToFinish(
    selectors.imageUploading,
    isCancelled,
  );
  if (!uploadFinished) {
    logWarning('Image upload did not finish before the timeout');
    return false;
  }
  const failure = await waitForElement(
    selectors.imageUploadFailed,
    isCancelled,
    1_000,
  );
  if (!failure) return true;
  logWarning('Image upload failed');
  await clickElement(
    selectors.removeFailedUploadedImage,
    'Remove failed uploaded image',
    isCancelled,
  );
  return false;
}

export async function dismissComparisonImage(
  selectors: SelectorConfig,
  isCancelled: CancellationCheck,
): Promise<void> {
  if (query(selectors.comparisonImage).length > 0) {
    await clickElement(
      selectors.ignoreComparisonImageButton,
      'Ignore comparison image',
      isCancelled,
    );
  }
}

type ImageUploader = typeof uploadConfiguredImage;

export async function uploadAllImages(
  payload: PromptPayload,
  config: AutomationConfig,
  isCancelled: CancellationCheck,
  uploadImage: ImageUploader = uploadConfiguredImage,
): Promise<boolean> {
  const images = payload.images ?? [];
  for (let index = 0; index < images.length; index += 1) {
    logInfo(
      `Uploading image ${index + 1}/${images.length}: ${images[index]?.name ?? 'image'}...`,
    );
    const uploaded = await uploadImage(payload, index, config, isCancelled);
    if (!uploaded) return false;
  }
  if (images.length === 0) {
    logWarning('No images provided for image-based mode');
  }
  return true;
}

export async function configureVideo(
  payload: PromptPayload,
  isCancelled: CancellationCheck,
  config: AutomationConfig,
): Promise<boolean> {
  try {
    if (isCancelled()) return false;
    const selectors = config.selectors;
    const extractedFrame = payload.outputPreviousPrompt?.extractedFrame;
    if (extractedFrame) {
      payload.images = [
        { base64: extractedFrame, name: `extracted-frame-${Date.now()}.jpg` },
        ...(payload.images ?? []),
      ];
    }

    if (!payload.outputPreviousPrompt) {
      await clickElement(
        selectors.videoModeButton,
        'Select Video Mode',
        isCancelled,
      );
      await selectAspectRatio(payload, selectors, isCancelled);
      const videoOption = payload.videoOption ?? '';
      const option = videoOption.includes('6s')
        ? selectors.videoLength6sItem
        : videoOption.includes('10s')
          ? selectors.videoLength10sItem
          : videoOption.includes('15s')
            ? selectors.videoLength15sItem
            : null;
      if (option && query(option).length > 0) {
        await clickElement(
          option,
          `${videoOption} video length option`,
          isCancelled,
        );
      }
      if (query(selectors.videoQuality720pItem).length > 0) {
        const qualitySelector =
          payload.autoDownloadResourceQuality === '480p'
            ? selectors.videoQuality480pItem
            : payload.autoDownloadResourceQuality === '720p'
              ? selectors.videoQuality720pItem
              : payload.autoDownloadResourceQuality === '1080p'
                ? selectors.videoQuality1080pItem
                : null;
        if (qualitySelector)
          await clickElement(
            qualitySelector,
            'Video quality option',
            isCancelled,
          );
      }
    }
    return uploadAllImages(payload, config, isCancelled);
  } catch (error) {
    if (String(error).includes(CANCELLED_ERROR_MESSAGE)) throw error;
    logError('Error in configureVideo:', error);
    return false;
  }
}

async function selectAspectRatio(
  payload: PromptPayload,
  selectors: SelectorConfig,
  isCancelled: CancellationCheck,
): Promise<void> {
  if (query(selectors.aspectRatioButton).length === 0) return;
  await clickElement(
    selectors.aspectRatioButton,
    'Select Aspect Ratio Mode',
    isCancelled,
  );
  const option = selectors.aspectRatioTemplateV3.replace(
    '{aspectRatio}',
    payload.aspectRatio,
  );
  if (await waitForElement(option, isCancelled)) {
    await clickElement(
      option,
      `Aspect ratio option: ${payload.aspectRatio}`,
      isCancelled,
    );
  } else {
    logWarning(`Could not find aspect ratio option: ${payload.aspectRatio}`);
  }
}

export async function configureImage(
  payload: PromptPayload,
  isCancelled: CancellationCheck,
  config: AutomationConfig,
): Promise<boolean> {
  try {
    if (isCancelled()) return false;
    const selectors = config.selectors;
    if (!payload.outputPreviousPrompt) {
      await clickElement(
        selectors.imageModeButton,
        'Select Image Mode',
        isCancelled,
      );
      if (query(selectors.imageSpeedModel).length > 0) {
        const modelSelector =
          payload.imageModel === 'speed'
            ? selectors.imageSpeedModel
            : selectors.imageQualityModel;
        await clickElement(modelSelector, 'Select Image Model', isCancelled);
      }
      if (query(selectors.numberOfImagesOutputButton).length > 0) {
        await clickElement(
          selectors.numberOfImagesOutputButton,
          'Select Number of Images',
          isCancelled,
        );
        const count =
          payload.outputCount > 8 ? '12' : payload.outputCount > 4 ? '8' : '4';
        const option = selectors.numberOfImagesOutputTemplate.replace(
          '{numberOfImages}',
          count,
        );
        if (await waitForElement(option, isCancelled)) {
          await clickElement(
            option,
            `Number of images option: ${count}`,
            isCancelled,
          );
        }
      }
      await selectAspectRatio(payload, selectors, isCancelled);
    }
    return uploadAllImages(payload, config, isCancelled);
  } catch (error) {
    if (String(error).includes(CANCELLED_ERROR_MESSAGE)) throw error;
    logError('Error in configureImage:', error);
    return false;
  }
}

export function findInlineImageMatches(
  prompt: string,
  images: readonly PreparedImage[],
): InlineImageMatch[] {
  const candidates: InlineImageMatch[] = [];
  images.forEach((image, imageIndex) => {
    if (!image.name) return;
    const dot = image.name.lastIndexOf('.');
    const stem = dot === -1 ? image.name : image.name.substring(0, dot);
    if (!stem) return;
    const escaped = stem.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
    const needsBoundary = /^\w/.test(stem) && /\w$/.test(stem);
    const matcher = new RegExp(
      needsBoundary ? `\\b${escaped}\\b` : escaped,
      'gi',
    );
    let match: RegExpExecArray | null;
    while ((match = matcher.exec(prompt)) !== null) {
      candidates.push({
        index: match.index,
        length: match[0].length,
        imageIndex,
      });
    }
  });
  // Preserve recovered first-image precedence when names overlap at the same
  // character offset.
  candidates.sort((left, right) => left.index - right.index);
  const nonOverlapping: InlineImageMatch[] = [];
  let cursor = 0;
  for (const match of candidates) {
    if (match.index >= cursor) {
      nonOverlapping.push(match);
      cursor = match.index + match.length;
    }
  }
  return nonOverlapping;
}

export async function selectReferenceImages(
  payload: PromptPayload,
  promptElement: HTMLElement,
  imageIndex: number | undefined,
  isCancelled: CancellationCheck,
): Promise<void> {
  const images = payload.images ?? [];
  const selections =
    imageIndex === undefined
      ? images.map((image, index) => ({ image, index }))
      : images[imageIndex]
        ? [{ image: images[imageIndex], index: imageIndex }]
        : [];

  for (const { image, index } of selections) {
    promptElement.focus();
    document.execCommand('insertText', false, '@');
    await delayWithCancellation(500, isCancelled);
    for (let step = 0; step < index; step += 1) {
      dispatchKey(promptElement, 'ArrowDown', 40);
      await delayWithCancellation(150, isCancelled);
    }
    dispatchKey(promptElement, 'Enter', 13);
    logInfo(
      `Typed @ and selected image ${index + 1}: ${image?.name ?? 'image'}`,
    );
    await delayWithCancellation(300, isCancelled);
  }
  await delayWithCancellation(300, isCancelled);
}

function dispatchKey(element: HTMLElement, key: string, keyCode: number): void {
  element.dispatchEvent(
    new KeyboardEvent('keydown', {
      key,
      code: key,
      keyCode,
      bubbles: true,
      cancelable: true,
    }),
  );
  element.dispatchEvent(
    new KeyboardEvent('keyup', {
      key,
      code: key,
      keyCode,
      bubbles: true,
    }),
  );
}

function insertText(element: HTMLElement, text: string): void {
  element.focus();
  document.execCommand('insertText', false, text);
}

function dispatchValueEvents(element: HTMLElement): void {
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

export async function fillGrokPrompt(
  payload: PromptPayload,
  config: AutomationConfig,
  isCancelled: CancellationCheck,
): Promise<boolean> {
  try {
    const selectors = config.selectors;
    const selector =
      query(selectors.promptDropUiTextarea).length > 0
        ? selectors.promptDropUiTextarea
        : selectors.promptContentEditable;
    const collection = await waitForElement<HTMLElement>(selector, isCancelled);
    const element = collection?.first().get(0);
    if (!(element instanceof HTMLElement)) return false;

    await clickElement(selector, 'Prompt input', isCancelled);
    element.focus();
    await delayWithCancellation(500, isCancelled);
    document.execCommand('selectAll', false);
    await delayWithCancellation(300, isCancelled);
    document.execCommand('delete', false);
    if (
      element instanceof HTMLTextAreaElement ||
      element instanceof HTMLInputElement
    ) {
      element.value = '';
    }
    element.dispatchEvent(new Event('input', { bubbles: true }));

    if (payload.mode === 'imageToVideo' && payload.images?.length === 2) {
      insertText(element, 'use ');
      await selectReferenceImages(payload, element, 0, isCancelled);
      insertText(element, ' as the exact start frame and use ');
      await selectReferenceImages(payload, element, 1, isCancelled);
      insertText(element, ' as the exact end frame');
    } else if (
      payload.outputPreviousPrompt?.nextPromptExtendVideo ||
      (payload.mode === 'imageToVideo' && payload.images?.length === 1)
    ) {
      insertText(element, payload.prompt);
      dispatchValueEvents(element);
    } else {
      const matches =
        element instanceof HTMLTextAreaElement
          ? []
          : findInlineImageMatches(payload.prompt, payload.images ?? []);
      if (matches.length > 0) {
        let cursor = 0;
        for (const match of matches) {
          insertText(
            element,
            payload.prompt.substring(cursor, match.index + match.length),
          );
          await delayWithCancellation(100, isCancelled);
          insertText(element, ' ');
          await selectReferenceImages(
            payload,
            element,
            match.imageIndex,
            isCancelled,
          );
          cursor = match.index + match.length;
        }
        if (cursor < payload.prompt.length)
          insertText(element, payload.prompt.substring(cursor));
      } else {
        if (payload.images?.length) {
          await selectReferenceImages(payload, element, undefined, isCancelled);
        }
        if (payload.outputPreviousPrompt?.nextPromptEditImage) {
          document.execCommand('selectAll', false);
          document.execCommand('delete', false);
        }
        insertText(element, payload.prompt);
        dispatchValueEvents(element);
      }
    }

    await waitForElement(selectors.submitButton, isCancelled, 5_000);
    dispatchKey(element, 'Enter', 13);
    return true;
  } catch (error) {
    if (String(error).includes(CANCELLED_ERROR_MESSAGE)) throw error;
    logError('Error in fillGrokPrompt:', error);
    return false;
  }
}

export async function waitForGeneratedArticle(
  isCancelled: CancellationCheck,
  config: AutomationConfig,
  beforeSubmit: GeneratedArticleSnapshot = { fingerprints: new Map() },
): Promise<string[]> {
  try {
    for (let attempt = 0; attempt < 360; attempt += 1) {
      if (isCancelled()) return [];
      const article = findFreshGeneratedArticle(config, beforeSubmit);
      if (article) return [tagGeneratedArticle(article)];
      await delayWithCancellation(500, isCancelled);
    }
  } catch (error) {
    logError('Error in waitForGeneratedArticle:', error);
  }
  return [];
}

function articleFingerprint(article: Element): string {
  return article.innerHTML;
}

export function captureGeneratedArticleSnapshot(
  config: AutomationConfig,
): GeneratedArticleSnapshot {
  return {
    fingerprints: new Map(
      collectionToArray(query(config.selectors.mainArticle)).map((article) => [
        article,
        articleFingerprint(article),
      ]),
    ),
  };
}

export function findFreshGeneratedArticle(
  config: AutomationConfig,
  beforeSubmit: GeneratedArticleSnapshot,
): Element | null {
  const latest = collectionToArray(query(config.selectors.mainArticle)).at(-1);
  if (!latest) return null;
  const priorFingerprint = beforeSubmit.fingerprints.get(latest);
  return priorFingerprint === undefined ||
    priorFingerprint !== articleFingerprint(latest)
    ? latest
    : null;
}

function tagGeneratedArticle(article: Element): string {
  generatedArticleTokenCounter += 1;
  const token = `result-${Date.now().toString(36)}-${generatedArticleTokenCounter.toString(36)}`;
  const existingTokens =
    article
      .getAttribute(GENERATED_ARTICLE_TOKEN_ATTRIBUTE)
      ?.split(/\s+/)
      .filter(Boolean) ?? [];
  article.setAttribute(
    GENERATED_ARTICLE_TOKEN_ATTRIBUTE,
    [...new Set([...existingTokens, token])].join(' '),
  );
  return `[${GENERATED_ARTICLE_TOKEN_ATTRIBUTE}~="${token}"]`;
}
