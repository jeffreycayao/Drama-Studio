import { promptPayloadSchema } from './schemas';
import {
  IMAGE_OPTIONS,
  VIDEO_OPTIONS,
  type AutomationMode,
  type ImageOption,
  type PromptPayload,
  type Settings,
  type UploadedImage,
  type VideoOption,
} from './types';

export interface PromptRange {
  /** One-based, inclusive prompt index. */
  start: number;
  /** One-based, inclusive prompt index. */
  end: number;
}

export type PromptOption = VideoOption | ImageOption;

export interface BuildPromptPayloadsInput {
  mode: AutomationMode;
  promptText: string;
  images: UploadedImage[];
  settings: Settings;
  videoOption?: VideoOption;
  imageOption?: ImageOption;
  /** Options are keyed by their original, one-based prompt index. */
  optionOverrides?: Readonly<Record<number, PromptOption>>;
  /** Applied before concat dependencies and image assignments are planned. */
  range?: PromptRange;
}

export type PromptBuildErrorCode =
  | 'NO_PROMPTS'
  | 'INVALID_RANGE'
  | 'INVALID_OPTION_OVERRIDE'
  | 'MISSING_IMAGES'
  | 'INSUFFICIENT_IMAGES'
  | 'NO_MATCHING_IMAGES';

export interface PromptBuildError {
  code: PromptBuildErrorCode;
  message: string;
  promptIndex?: number;
  requiredImages?: number;
  availableImages?: number;
}

export type ImageAssignmentStrategy =
  'none' | 'sequential' | 'filename-match' | 'cycle';

export interface PromptImageAssignmentMetadata {
  promptIndex: number;
  strategy: ImageAssignmentStrategy;
  /** Exact requirement for image-to-video; minimum requirement otherwise. */
  requiredImages: number;
  assignedImages: number;
}

export interface PromptBuildMetadata {
  totalPromptCount: number;
  selectedPromptCount: number;
  selectedPromptIndices: number[];
  range: PromptRange | null;
  concatPromptIndices: number[];
  hasConcat: boolean;
  availableImageCount: number;
  requiredImageCount: number;
  assignedImageCount: number;
  imageAssignments: PromptImageAssignmentMetadata[];
  imagesByPrompt: UploadedImage[][];
}

export interface PromptBuildResult {
  valid: boolean;
  payloads: PromptPayload[];
  errors: PromptBuildError[];
  metadata: PromptBuildMetadata;
}

interface SelectedPrompt {
  prompt: string;
  promptIndex: number;
  option: PromptOption;
  isConcat: boolean;
}

interface PlannedImageAssignments {
  assigned: UploadedImage[][];
  errors: PromptBuildError[];
  metadata: PromptImageAssignmentMetadata[];
}

export function parsePrompts(value: string): string[] {
  return value
    .split(/\n\s*\n/)
    .map((prompt) => prompt.trim())
    .filter(Boolean);
}

export function isUploadMode(mode: AutomationMode): boolean {
  return (
    mode === 'imageToVideo' ||
    mode === 'componentsToVideo' ||
    mode === 'imageToImage'
  );
}

export function isImageGenerationMode(mode: AutomationMode): boolean {
  return mode === 'textToImage' || mode === 'imageToImage';
}

export function isVideoMode(mode: AutomationMode): boolean {
  return !isImageGenerationMode(mode);
}

function withoutConcat<T extends PromptOption>(option: T): T {
  return option.replace('-concat', '') as T;
}

export function effectivePromptOption<T extends PromptOption>(
  option: T,
  promptIndex: number,
  totalPrompts: number,
): T {
  return promptIndex === totalPrompts - 1 && option.includes('-concat')
    ? withoutConcat(option)
    : option;
}

function maxImagesPerPrompt(mode: AutomationMode, settings: Settings): number {
  if (mode === 'componentsToVideo')
    return settings.componentsToVideoMaxImagesPerPrompt;
  if (mode === 'imageToImage') return settings.imageToImageMaxImagesPerPrompt;
  return settings.imageToVideoMaxImagesPerPrompt;
}

function isVideoOption(option: PromptOption): option is VideoOption {
  return (VIDEO_OPTIONS as readonly string[]).includes(option);
}

function isImageOption(option: PromptOption): option is ImageOption {
  return (IMAGE_OPTIONS as readonly string[]).includes(option);
}

function modeAcceptsOption(
  mode: AutomationMode,
  option: PromptOption,
): boolean {
  return isVideoMode(mode) ? isVideoOption(option) : isImageOption(option);
}

function resolveRange(
  range: PromptRange | undefined,
  totalPrompts: number,
): { range: PromptRange | null; error: PromptBuildError | null } {
  if (totalPrompts === 0) return { range: null, error: null };
  const resolved = range ?? { start: 1, end: totalPrompts };
  const valid =
    Number.isInteger(resolved.start) &&
    Number.isInteger(resolved.end) &&
    resolved.start >= 1 &&
    resolved.start <= resolved.end &&
    resolved.end <= totalPrompts;
  if (valid) return { range: { ...resolved }, error: null };
  return {
    range: null,
    error: {
      code: 'INVALID_RANGE',
      message: `Prompt range must use one-based inclusive indices between 1 and ${totalPrompts}, with start no greater than end.`,
    },
  };
}

function validateOverrides(
  mode: AutomationMode,
  overrides: BuildPromptPayloadsInput['optionOverrides'],
  totalPrompts: number,
): PromptBuildError[] {
  if (!overrides) return [];
  const errors: PromptBuildError[] = [];
  for (const [rawPromptIndex, option] of Object.entries(overrides)) {
    const promptIndex = Number(rawPromptIndex);
    if (
      !Number.isInteger(promptIndex) ||
      promptIndex < 1 ||
      promptIndex > totalPrompts
    ) {
      errors.push({
        code: 'INVALID_OPTION_OVERRIDE',
        message: `Option override index ${rawPromptIndex} does not identify an existing prompt.`,
      });
      continue;
    }
    if (!modeAcceptsOption(mode, option)) {
      errors.push({
        code: 'INVALID_OPTION_OVERRIDE',
        message: `Option ${option} is not valid for ${mode}.`,
        promptIndex,
      });
    }
  }
  return errors;
}

function deduplicateImages(images: readonly UploadedImage[]): UploadedImage[] {
  const seen = new Set<string>();
  return images.filter((image) => {
    if (seen.has(image.id)) return false;
    seen.add(image.id);
    return true;
  });
}

function filenameStem(name: string): string {
  return name
    .replace(/\.[^/.]+$/, '')
    .trim()
    .toLocaleLowerCase();
}

/**
 * Compatibility helper for callers that only need the former assignment API.
 * New prompt planning uses mode-specific assignment rules below.
 */
export function assignImagesToPrompts(input: {
  prompts: string[];
  images: UploadedImage[];
  maxImagesPerPrompt: number;
  autoAddCharacterImages: boolean;
  concatIndices: ReadonlySet<number>;
}): UploadedImage[][] {
  const result: UploadedImage[][] = [];
  const images = deduplicateImages(input.images);
  let cursor = 0;

  for (let index = 0; index < input.prompts.length; index += 1) {
    if (index > 0 && input.concatIndices.has(index - 1)) {
      result.push([]);
      continue;
    }

    const selected: UploadedImage[] = [];
    if (input.autoAddCharacterImages) {
      const normalizedPrompt = input.prompts[index]?.toLocaleLowerCase() ?? '';
      for (const image of images) {
        const name = filenameStem(image.name);
        if (
          name &&
          normalizedPrompt.includes(name) &&
          selected.length < input.maxImagesPerPrompt
        ) {
          selected.push(image);
        }
      }
    } else {
      const target = Math.min(input.maxImagesPerPrompt, images.length);
      while (selected.length < target) {
        const image = images[cursor % images.length];
        cursor += 1;
        if (image && !selected.some((candidate) => candidate.id === image.id))
          selected.push(image);
      }
    }
    result.push(selected);
  }
  return result;
}

function planSequentialImageToVideoAssignments(
  prompts: readonly SelectedPrompt[],
  images: readonly UploadedImage[],
  maxImages: number,
): PlannedImageAssignments {
  const assigned: UploadedImage[][] = [];
  const errors: PromptBuildError[] = [];
  const metadata: PromptImageAssignmentMetadata[] = [];
  let imageCursor = 0;

  for (let index = 0; index < prompts.length; index += 1) {
    const prompt = prompts[index];
    if (!prompt) continue;
    const isConcatSuccessor =
      index > 0 && prompts[index - 1]?.isConcat === true;
    const requiredImages = isConcatSuccessor
      ? maxImages === 1
        ? 0
        : 1
      : maxImages;
    const selected = images.slice(imageCursor, imageCursor + requiredImages);
    imageCursor += requiredImages;
    assigned.push(selected);
    metadata.push({
      promptIndex: prompt.promptIndex,
      strategy: 'sequential',
      requiredImages,
      assignedImages: selected.length,
    });
    if (selected.length < requiredImages) {
      errors.push({
        code: 'INSUFFICIENT_IMAGES',
        message: `Prompt ${prompt.promptIndex} requires ${requiredImages} sequential image${requiredImages === 1 ? '' : 's'}, but only ${selected.length} remain. Images are never wrapped in image-to-video mode.`,
        promptIndex: prompt.promptIndex,
        requiredImages,
        availableImages: selected.length,
      });
    }
  }

  return { assigned, errors, metadata };
}

function planReusableImageAssignments(
  prompts: readonly SelectedPrompt[],
  images: readonly UploadedImage[],
  maxImages: number,
  useFilenameMatching: boolean,
): PlannedImageAssignments {
  const assigned: UploadedImage[][] = [];
  const errors: PromptBuildError[] = [];
  const metadata: PromptImageAssignmentMetadata[] = [];
  const uniqueImages = deduplicateImages(images);
  let imageCursor = 0;

  for (let index = 0; index < prompts.length; index += 1) {
    const prompt = prompts[index];
    if (!prompt) continue;
    if (index > 0 && prompts[index - 1]?.isConcat === true) {
      assigned.push([]);
      metadata.push({
        promptIndex: prompt.promptIndex,
        strategy: useFilenameMatching ? 'filename-match' : 'cycle',
        requiredImages: 0,
        assignedImages: 0,
      });
      continue;
    }

    let selected: UploadedImage[];
    if (useFilenameMatching) {
      const normalizedPrompt = prompt.prompt.toLocaleLowerCase();
      selected = uniqueImages
        .filter((image) => {
          const name = filenameStem(image.name);
          return name.length > 0 && normalizedPrompt.includes(name);
        })
        .slice(0, maxImages);
    } else {
      selected = [];
      const target = Math.min(maxImages, uniqueImages.length);
      while (selected.length < target) {
        const image = uniqueImages[imageCursor % uniqueImages.length];
        imageCursor += 1;
        if (image && !selected.some((candidate) => candidate.id === image.id))
          selected.push(image);
      }
    }

    assigned.push(selected);
    metadata.push({
      promptIndex: prompt.promptIndex,
      strategy: useFilenameMatching ? 'filename-match' : 'cycle',
      requiredImages: 1,
      assignedImages: selected.length,
    });
    if (selected.length === 0) {
      errors.push({
        code: useFilenameMatching ? 'NO_MATCHING_IMAGES' : 'MISSING_IMAGES',
        message: useFilenameMatching
          ? `Prompt ${prompt.promptIndex} does not mention any uploaded image filename.`
          : `Prompt ${prompt.promptIndex} requires at least one uploaded image.`,
        promptIndex: prompt.promptIndex,
        requiredImages: 1,
        availableImages: 0,
      });
    }
  }

  return { assigned, errors, metadata };
}

function planImageAssignments(
  mode: AutomationMode,
  prompts: readonly SelectedPrompt[],
  images: readonly UploadedImage[],
  settings: Settings,
): PlannedImageAssignments {
  if (!isUploadMode(mode)) {
    return {
      assigned: prompts.map(() => []),
      errors: [],
      metadata: prompts.map((prompt) => ({
        promptIndex: prompt.promptIndex,
        strategy: 'none',
        requiredImages: 0,
        assignedImages: 0,
      })),
    };
  }

  const maximum = maxImagesPerPrompt(mode, settings);
  if (mode === 'imageToVideo') {
    return planSequentialImageToVideoAssignments(prompts, images, maximum);
  }
  return planReusableImageAssignments(
    prompts,
    images,
    maximum,
    settings.autoAddCharacterImages,
  );
}

function emptyMetadata(totalPromptCount: number): PromptBuildMetadata {
  return {
    totalPromptCount,
    selectedPromptCount: 0,
    selectedPromptIndices: [],
    range: null,
    concatPromptIndices: [],
    hasConcat: false,
    availableImageCount: 0,
    requiredImageCount: 0,
    assignedImageCount: 0,
    imageAssignments: [],
    imagesByPrompt: [],
  };
}

/**
 * Plans and validates a payload batch without losing its original prompt indices.
 * Consumers that need structured validation should prefer this API.
 */
export function buildPromptPayloadsResult(
  input: BuildPromptPayloadsInput,
): PromptBuildResult {
  const allPrompts = parsePrompts(input.promptText);
  const metadata = emptyMetadata(allPrompts.length);
  metadata.availableImageCount = input.images.length;
  const errors: PromptBuildError[] = [];

  if (allPrompts.length === 0) {
    errors.push({
      code: 'NO_PROMPTS',
      message: 'Enter at least one non-empty prompt.',
    });
    return { valid: false, payloads: [], errors, metadata };
  }

  const resolvedRange = resolveRange(input.range, allPrompts.length);
  if (resolvedRange.error) errors.push(resolvedRange.error);
  errors.push(
    ...validateOverrides(input.mode, input.optionOverrides, allPrompts.length),
  );
  if (!resolvedRange.range || errors.length > 0) {
    return { valid: false, payloads: [], errors, metadata };
  }

  const range = resolvedRange.range;
  metadata.range = range;
  const rangedPrompts = allPrompts
    .slice(range.start - 1, range.end)
    .map((prompt, index) => ({
      prompt,
      promptIndex: range.start + index,
    }));
  const defaultOption: PromptOption = isVideoMode(input.mode)
    ? (input.videoOption ?? input.settings.defaultVideoOption)
    : (input.imageOption ?? input.settings.defaultImageOption);
  const selectedPrompts: SelectedPrompt[] = rangedPrompts.map(
    ({ prompt, promptIndex }, selectedIndex) => {
      const override = input.optionOverrides?.[promptIndex];
      const option = effectivePromptOption(
        override ?? defaultOption,
        selectedIndex,
        rangedPrompts.length,
      );
      return {
        prompt,
        promptIndex,
        option,
        isConcat: option.includes('-concat'),
      };
    },
  );

  metadata.selectedPromptCount = selectedPrompts.length;
  metadata.selectedPromptIndices = selectedPrompts.map(
    (prompt) => prompt.promptIndex,
  );
  metadata.concatPromptIndices = selectedPrompts
    .filter((prompt) => prompt.isConcat)
    .map((prompt) => prompt.promptIndex);
  metadata.hasConcat = metadata.concatPromptIndices.length > 0;

  const imagePlan = planImageAssignments(
    input.mode,
    selectedPrompts,
    input.images,
    input.settings,
  );
  errors.push(...imagePlan.errors);
  metadata.imageAssignments = imagePlan.metadata;
  metadata.imagesByPrompt = imagePlan.assigned;
  metadata.requiredImageCount = imagePlan.metadata.reduce(
    (total, assignment) => total + assignment.requiredImages,
    0,
  );
  metadata.assignedImageCount = imagePlan.metadata.reduce(
    (total, assignment) => total + assignment.assignedImages,
    0,
  );

  const concurrentPrompts = metadata.hasConcat
    ? 1
    : input.settings.concurrentPrompts;
  const outputCount = metadata.hasConcat
    ? 1
    : isImageGenerationMode(input.mode)
      ? input.settings.imageOutputCount
      : input.settings.outputCount;
  const payloads = selectedPrompts.map((selected, index) => {
    const base: PromptPayload = {
      prompt: selected.prompt,
      mode: input.mode,
      aspectRatio: input.settings.aspectRatio,
      outputCount,
      promptIndex: selected.promptIndex,
      autoDownloadResourceQuality: isImageGenerationMode(input.mode)
        ? input.settings.autoDownloadImageQuality
        : input.settings.autoDownloadVideoQuality,
      concurrentPrompts,
      promptDelaySecondsMin: input.settings.promptDelaySecondsMin,
      promptDelaySecondsMax: input.settings.promptDelaySecondsMax,
      isConcat: selected.isConcat,
      maxRetries: input.settings.maxRetries,
      autoChangeFileName: input.settings.autoChangeFileName,
      folderName: input.settings.folderName,
    };
    if (isVideoMode(input.mode))
      base.videoOption = selected.option as VideoOption;
    else base.imageModel = input.settings.imageModel;
    const images = imagePlan.assigned[index];
    if (isUploadMode(input.mode) && images) base.images = images;
    return promptPayloadSchema.parse(base) as PromptPayload;
  });

  return {
    valid: errors.length === 0,
    payloads,
    errors,
    metadata,
  };
}

/** Preserves the original array-returning API and throws a readable validation error. */
export function buildPromptPayloads(
  input: BuildPromptPayloadsInput,
): PromptPayload[] {
  const result = buildPromptPayloadsResult(input);
  if (!result.valid) {
    throw new Error(result.errors.map((error) => error.message).join(' '));
  }
  return result.payloads;
}
