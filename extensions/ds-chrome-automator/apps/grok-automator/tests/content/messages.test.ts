import { handleRuntimeMessage } from '../../src/content/messages';
import {
  IMAGE_TRANSFER_TIMEOUT_MS,
  MAX_CONCURRENT_IMAGE_TRANSFERS,
} from '../../src/security/image-limits';
import {
  imageChunkBuffers,
  preparedImages,
  resetContentState,
} from '../../src/content/state';
import { afterEach, describe, expect, it } from 'vitest';

afterEach(() => resetContentState());

function dispatch(message: unknown): unknown[] {
  const responses: unknown[] = [];
  handleRuntimeMessage(message, {}, (response) => responses.push(response));
  return responses;
}

describe('content image preparation', () => {
  it('stores a validated direct image', () => {
    const responses = dispatch({
      type: 'PREPARE_IMAGE',
      id: 'image-direct',
      data: { base64: 'data:image/jpeg;base64,AA==', name: 'direct.jpg' },
    });
    expect(responses).toEqual([{ success: true }]);
    expect(preparedImages['image-direct']?.name).toBe('direct.jpg');
  });

  it('reassembles and validates chunked image JSON in index order', () => {
    const serialized = JSON.stringify({
      base64: 'data:image/jpeg;base64,AA==',
      name: 'chunked.jpg',
    });
    const splitAt = Math.floor(serialized.length / 2);
    const secondResponse = dispatch({
      type: 'PREPARE_IMAGE_CHUNK',
      id: 'image-chunked',
      chunk: serialized.slice(splitAt),
      chunkIndex: 1,
      totalChunks: 2,
    });
    expect(secondResponse).toEqual([
      {
        success: true,
        chunkReceived: true,
        receivedCount: 1,
        totalChunks: 2,
      },
    ]);

    expect(
      dispatch({
        type: 'PREPARE_IMAGE_CHUNK',
        id: 'image-chunked',
        chunk: serialized.slice(0, splitAt),
        chunkIndex: 0,
        totalChunks: 2,
      }),
    ).toEqual([{ success: true }]);
    expect(preparedImages['image-chunked']?.name).toBe('chunked.jpg');
    expect(imageChunkBuffers['img-image-chunked']).toBeUndefined();
  });

  it('rejects inconsistent chunk metadata without retaining partial data', () => {
    dispatch({
      type: 'PREPARE_IMAGE_CHUNK',
      id: 'bad',
      chunk: '{',
      chunkIndex: 0,
      totalChunks: 2,
    });
    expect(
      dispatch({
        type: 'PREPARE_IMAGE_CHUNK',
        id: 'bad',
        chunk: '}',
        chunkIndex: 1,
        totalChunks: 3,
      }),
    ).toEqual([
      { success: false, error: 'Image chunk count changed during transfer' },
    ]);
    expect(imageChunkBuffers['img-bad']).toBeUndefined();
  });

  it('bounds concurrent transfers and discards expired partial chunks', () => {
    for (let index = 0; index < MAX_CONCURRENT_IMAGE_TRANSFERS; index += 1) {
      dispatch({
        type: 'PREPARE_IMAGE_CHUNK',
        id: `pending-${index}`,
        chunk: '{',
        chunkIndex: 0,
        totalChunks: 2,
      });
    }
    expect(
      dispatch({
        type: 'PREPARE_IMAGE_CHUNK',
        id: 'one-too-many',
        chunk: '{',
        chunkIndex: 0,
        totalChunks: 2,
      }),
    ).toEqual([
      { success: false, error: 'Too many concurrent image transfers' },
    ]);

    imageChunkBuffers['img-pending-0']!.updatedAt =
      Date.now() - IMAGE_TRANSFER_TIMEOUT_MS - 1;
    dispatch({
      type: 'PREPARE_IMAGE_CHUNK',
      id: 'replacement',
      chunk: '{',
      chunkIndex: 0,
      totalChunks: 2,
    });
    expect(imageChunkBuffers['img-pending-0']).toBeUndefined();
    expect(imageChunkBuffers['img-replacement']).toBeDefined();
  });
});
