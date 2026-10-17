// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  MAX_UPLOADED_IMAGE_BYTES,
  MAX_UPLOADED_IMAGE_FILES,
} from '../../src/security/image-limits';
import { filesToUploadedImages } from '../../src/sidepanel/files';

afterEach(() => vi.restoreAllMocks());

describe('uploaded image preflight', () => {
  it('checks count, MIME type, and aggregate bytes before starting FileReader', async () => {
    const read = vi.spyOn(FileReader.prototype, 'readAsDataURL');
    const tooMany = Array.from(
      { length: MAX_UPLOADED_IMAGE_FILES + 1 },
      (_, index) => new File(['x'], `${index}.png`, { type: 'image/png' }),
    );
    await expect(filesToUploadedImages(tooMany)).rejects.toThrow(
      /no more than/u,
    );
    await expect(
      filesToUploadedImages([
        new File(['<script>'], 'payload.svg', { type: 'image/svg+xml' }),
      ]),
    ).rejects.toThrow(/not a supported raster image/u);
    await expect(
      filesToUploadedImages(
        [
          new File(['1234'], 'first.png', { type: 'image/png' }),
          new File(['5678'], 'second.png', { type: 'image/png' }),
        ],
        { maxTotalBytes: 7 },
      ),
    ).rejects.toThrow(/aggregate upload limit/u);
    expect(read).not.toHaveBeenCalled();
  });

  it('rejects an oversized individual file without reading it', async () => {
    const read = vi.spyOn(FileReader.prototype, 'readAsDataURL');
    const oversized = new File(
      [new Uint8Array(MAX_UPLOADED_IMAGE_BYTES + 1)],
      'oversized.png',
      { type: 'image/png' },
    );

    await expect(filesToUploadedImages([oversized])).rejects.toThrow(
      /20 MiB image limit/u,
    );
    expect(read).not.toHaveBeenCalled();
  });
});
