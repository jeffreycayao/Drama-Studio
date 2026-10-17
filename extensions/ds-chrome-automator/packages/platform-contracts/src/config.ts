import { z } from 'zod';

import {
  isoDateTimeSchema,
  revisionSchema,
  semanticVersionSchema,
  sha256Schema,
} from './primitives.js';

const selectorValueSchema = z
  .string()
  .min(1)
  .max(4_096)
  .refine((value) => value.trim().length > 0, 'Selector cannot be blank')
  .refine(
    (value) => !/[\u0000-\u001F\u007F]/u.test(value),
    'Selector cannot contain control characters',
  );

const compatibleVersionsSchema = z
  .array(semanticVersionSchema)
  .min(1)
  .max(100)
  .refine(
    (versions) => new Set(versions).size === versions.length,
    'Compatible versions must be unique',
  );

export const GROK_SELECTOR_KEYS = [
  'imagineLink',
  'videoModeButton',
  'imageModeButton',
  'imageSpeedModel',
  'imageQualityModel',
  'aspectRatioButton',
  'aspectRatioTemplateV3',
  'numberOfImagesOutputButton',
  'numberOfImagesOutputTemplate',
  'videoQuality480pItem',
  'videoQuality720pItem',
  'videoQuality1080pItem',
  'videoLength6sItem',
  'videoLength10sItem',
  'videoLength15sItem',
  'plusImageButton',
  'fileInput',
  'promptContentEditable',
  'promptDropUiTextarea',
  'imageUploading',
  'imageUploadFailed',
  'removeFailedUploadedImage',
  'submitButton',
  'comparisonImage',
  'ignoreComparisonImageButton',
  'generateVideoButton',
  'mainArticle',
  'generatedImageItem',
  'shareButton',
  'moreOptionsButton',
  'extendVideoMenuItem',
  'upscaleMenuItem',
  'upscale720pOption',
  'upscale1080pOption',
  'hdButton',
  'downloadButton',
  'percentageSvg',
  'percentageSpan',
] as const;

export const grokSelectorSetSchema = z.strictObject({
  imagineLink: selectorValueSchema,
  videoModeButton: selectorValueSchema,
  imageModeButton: selectorValueSchema,
  imageSpeedModel: selectorValueSchema,
  imageQualityModel: selectorValueSchema,
  aspectRatioButton: selectorValueSchema,
  aspectRatioTemplateV3: selectorValueSchema,
  numberOfImagesOutputButton: selectorValueSchema,
  numberOfImagesOutputTemplate: selectorValueSchema,
  videoQuality480pItem: selectorValueSchema,
  videoQuality720pItem: selectorValueSchema,
  videoQuality1080pItem: selectorValueSchema,
  videoLength6sItem: selectorValueSchema,
  videoLength10sItem: selectorValueSchema,
  videoLength15sItem: selectorValueSchema,
  plusImageButton: selectorValueSchema,
  fileInput: selectorValueSchema,
  promptContentEditable: selectorValueSchema,
  promptDropUiTextarea: selectorValueSchema,
  imageUploading: selectorValueSchema,
  imageUploadFailed: selectorValueSchema,
  removeFailedUploadedImage: selectorValueSchema,
  submitButton: selectorValueSchema,
  comparisonImage: selectorValueSchema,
  ignoreComparisonImageButton: selectorValueSchema,
  generateVideoButton: selectorValueSchema,
  mainArticle: selectorValueSchema,
  generatedImageItem: selectorValueSchema,
  shareButton: selectorValueSchema,
  moreOptionsButton: selectorValueSchema,
  extendVideoMenuItem: selectorValueSchema,
  upscaleMenuItem: selectorValueSchema,
  upscale720pOption: selectorValueSchema,
  upscale1080pOption: selectorValueSchema,
  hdButton: selectorValueSchema,
  downloadButton: selectorValueSchema,
  percentageSvg: selectorValueSchema,
  percentageSpan: selectorValueSchema,
});

export const grokAutomatorConfigPayloadSchema = z.strictObject({
  selectors: grokSelectorSetSchema,
});

export function createConfigEnvelopeSchema<
  TAppId extends z.ZodType<string>,
  TPayload extends z.ZodType,
>(appId: TAppId, payload: TPayload) {
  return z.strictObject({
    schemaVersion: z.literal(1),
    appId,
    revision: revisionSchema,
    contentSha256: sha256Schema,
    compatibleClientVersions: compatibleVersionsSchema,
    publishedAt: isoDateTimeSchema,
    cacheSeconds: z.number().int().min(0).max(86_400),
    payload,
  });
}

export const grokAutomatorConfigEnvelopeSchema = createConfigEnvelopeSchema(
  z.literal('grok-automator'),
  grokAutomatorConfigPayloadSchema,
);

export type GrokSelectorSet = z.infer<typeof grokSelectorSetSchema>;
export type GrokAutomatorConfigPayload = z.infer<
  typeof grokAutomatorConfigPayloadSchema
>;
export type GrokAutomatorConfigEnvelope = z.infer<
  typeof grokAutomatorConfigEnvelopeSchema
>;
