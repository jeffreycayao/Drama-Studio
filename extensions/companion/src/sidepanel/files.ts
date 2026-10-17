import { uploadedImageSchema } from './schemas';
import type { UploadedImage } from './types';
import {
  isAllowedUploadImageMimeType,
  MAX_UPLOADED_IMAGE_BYTES,
  MAX_UPLOADED_IMAGE_FILES,
  MAX_UPLOADED_IMAGE_TOTAL_BYTES,
} from '../security/image-limits';

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === 'string'
        ? resolve(reader.result)
        : reject(new Error('Invalid image result'));
    reader.onerror = () =>
      reject(reader.error ?? new Error('Could not read image'));
    reader.readAsDataURL(file);
  });
}

export async function filesToUploadedImages(
  files: FileList | File[],
  limits: {
    maxFiles?: number;
    maxTotalBytes?: number;
  } = {},
): Promise<UploadedImage[]> {
  const candidates = Array.from(files);
  const maxFiles = Math.min(
    MAX_UPLOADED_IMAGE_FILES,
    limits.maxFiles ?? MAX_UPLOADED_IMAGE_FILES,
  );
  const maxTotalBytes = Math.min(
    MAX_UPLOADED_IMAGE_TOTAL_BYTES,
    limits.maxTotalBytes ?? MAX_UPLOADED_IMAGE_TOTAL_BYTES,
  );
  if (candidates.length > maxFiles) {
    throw new Error(`Select no more than ${maxFiles} image files at a time.`);
  }

  let totalBytes = 0;
  for (const file of candidates) {
    if (!isAllowedUploadImageMimeType(file.type)) {
      throw new Error(`${file.name} is not a supported raster image.`);
    }
    if (file.size < 1 || file.size > MAX_UPLOADED_IMAGE_BYTES) {
      throw new Error(`${file.name} exceeds the 20 MiB image limit.`);
    }
    if (file.name.length > 255) {
      throw new Error('Image file names must be 255 characters or fewer.');
    }
    totalBytes += file.size;
    if (totalBytes > maxTotalBytes) {
      throw new Error('The selected images exceed the aggregate upload limit.');
    }
  }

  const images: UploadedImage[] = [];
  for (const file of candidates) {
    const uploadedAt = Date.now();
    const base64 = await fileToDataUrl(file);
    images.push(
      uploadedImageSchema.parse({
        id: `image-${uploadedAt}-${crypto.randomUUID()}`,
        name: file.name,
        base64,
        uploadedAt,
      }),
    );
  }
  return images;
}
