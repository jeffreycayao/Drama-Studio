import { z } from 'zod/mini';

import archivedConfig from './remote-config.snapshot.json';

export const remoteSelectorsSchema = z.object({
  imagineLink: z.string().check(z.minLength(1)),
  videoModeButton: z.string().check(z.minLength(1)),
  imageModeButton: z.string().check(z.minLength(1)),
  imageSpeedModel: z.string().check(z.minLength(1)),
  imageQualityModel: z.string().check(z.minLength(1)),
  aspectRatioButton: z.string().check(z.minLength(1)),
  aspectRatioTemplateV3: z.string().check(z.minLength(1)),
  numberOfImagesOutputButton: z.string().check(z.minLength(1)),
  numberOfImagesOutputTemplate: z.string().check(z.minLength(1)),
  videoQuality480pItem: z.string().check(z.minLength(1)),
  videoQuality720pItem: z.string().check(z.minLength(1)),
  videoQuality1080pItem: z.string().check(z.minLength(1)),
  videoLength6sItem: z.string().check(z.minLength(1)),
  videoLength10sItem: z.string().check(z.minLength(1)),
  videoLength15sItem: z.string().check(z.minLength(1)),
  plusImageButton: z.string().check(z.minLength(1)),
  fileInput: z.string().check(z.minLength(1)),
  promptContentEditable: z.string().check(z.minLength(1)),
  promptDropUiTextarea: z.string().check(z.minLength(1)),
  imageUploading: z.string().check(z.minLength(1)),
  imageUploadFailed: z.string().check(z.minLength(1)),
  removeFailedUploadedImage: z.string().check(z.minLength(1)),
  submitButton: z.string().check(z.minLength(1)),
  comparisonImage: z.string().check(z.minLength(1)),
  ignoreComparisonImageButton: z.string().check(z.minLength(1)),
  generateVideoButton: z.string().check(z.minLength(1)),
  mainArticle: z.string().check(z.minLength(1)),
  generatedImageItem: z.string().check(z.minLength(1)),
  shareButton: z.string().check(z.minLength(1)),
  moreOptionsButton: z.string().check(z.minLength(1)),
  extendVideoMenuItem: z.string().check(z.minLength(1)),
  upscaleMenuItem: z.string().check(z.minLength(1)),
  upscale720pOption: z.string().check(z.minLength(1)),
  upscale1080pOption: z.string().check(z.minLength(1)),
  hdButton: z.string().check(z.minLength(1)),
  downloadButton: z.string().check(z.minLength(1)),
  percentageSvg: z.string().check(z.minLength(1)),
  percentageSpan: z.string().check(z.minLength(1)),
});

export const remoteConfigSchema = z.object({
  version: z.string().check(z.minLength(1)),
  hash: z.string().check(z.minLength(1)),
  selectors: remoteSelectorsSchema,
});

export type RemoteConfig = z.infer<typeof remoteConfigSchema>;

const bundledConfig = remoteConfigSchema.parse(archivedConfig);

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function verifyRemoteConfigIntegrity(
  config: RemoteConfig,
): Promise<boolean> {
  const encoded = new TextEncoder().encode(JSON.stringify(config.selectors));
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return config.hash === `sha256:${bytesToHex(new Uint8Array(digest))}`;
}

export function isVersionSupported(
  config: RemoteConfig,
  version: string,
): boolean {
  return config.version
    .split(',')
    .map((candidate) => candidate.trim())
    .filter(Boolean)
    .includes(version.trim());
}

export async function getRemoteConfig(): Promise<RemoteConfig> {
  if (!(await verifyRemoteConfigIntegrity(bundledConfig))) {
    throw new Error(
      'Bundled Grok selector snapshot failed integrity validation',
    );
  }
  return bundledConfig;
}

// Compatibility aliases used by the recovered Rollup side-panel bundle.
export { getRemoteConfig as g, isVersionSupported as i };
