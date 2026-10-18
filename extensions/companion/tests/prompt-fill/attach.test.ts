// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  attachReferenceFiles,
  readReferenceFile,
  type FileTransfer,
} from '../../src/prompt-fill/attach';
import { findAiSite } from '../../src/sites/ai-sites';

const flow = findAiSite('google-flow')!;

function fakeTransfer(): FileTransfer & { added: File[] } {
  const added: File[] = [];
  return {
    added,
    items: { add: (file: File) => added.push(file) },
    files: added as unknown as FileList,
  };
}

function watchFiles(input: HTMLInputElement): { set: File[] | null } {
  const seen: { set: File[] | null } = { set: null };
  Object.defineProperty(input, 'files', {
    configurable: true,
    set(value: FileList) {
      seen.set = [...(value as unknown as File[])];
    },
  });
  return seen;
}

const png = new File([new Uint8Array([1, 2])], 'still.png', {
  type: 'image/png',
});
const mp4 = new File([new Uint8Array([3])], 'clip.mp4', { type: 'video/mp4' });

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('reference files', () => {
  it('reads a reference in pieces and checks every piece', async () => {
    const pieces = [
      { ok: true as const, data: btoa('ab'), done: false, bytes: 4, offset: 0 },
      { ok: true as const, data: btoa('cd'), done: true, bytes: 4, offset: 2 },
    ];
    const fetchChunk = vi.fn(
      async (_job: string, _ref: string, offset: number) =>
        pieces.find((piece) => piece.offset === offset)!,
    );
    const file = await readReferenceFile(
      'job_0123456789',
      { refId: 'ref_01234567', name: 'four.png', mime: 'image/png', bytes: 4 },
      fetchChunk,
    );
    expect(file?.name).toBe('four.png');
    expect(file?.type).toBe('image/png');
    expect(new TextDecoder().decode(await file!.arrayBuffer())).toBe('abcd');
    expect(fetchChunk).toHaveBeenCalledTimes(2);
  });

  it('gives up on a piece at the wrong offset or a refused read', async () => {
    const reference = {
      refId: 'ref_01234567',
      name: 'x.png',
      mime: 'image/png' as const,
      bytes: 4,
    };
    await expect(
      readReferenceFile('job_0123456789', reference, async () => ({
        ok: true,
        data: btoa('ab'),
        done: false,
        bytes: 4,
        offset: 2,
      })),
    ).resolves.toBeNull();
    await expect(
      readReferenceFile('job_0123456789', reference, async () => ({
        ok: false,
        code: 'job-not-found',
      })),
    ).resolves.toBeNull();
    await expect(
      readReferenceFile('job_0123456789', reference, async () => ({
        ok: true,
        data: btoa('abcdef'),
        done: true,
        bytes: 4,
        offset: 0,
      })),
    ).resolves.toBeNull();
  });

  it('hands files to the upload control that accepts them', () => {
    document.body.innerHTML = `
      <input type="file" accept="audio/*" id="audio">
      <input type="file" accept="image/*" id="images" multiple>`;
    const audio = watchFiles(
      document.getElementById('audio') as HTMLInputElement,
    );
    const images = watchFiles(
      document.getElementById('images') as HTMLInputElement,
    );
    const changed = vi.fn();
    document.getElementById('images')!.addEventListener('change', changed);

    const outcome = attachReferenceFiles(
      flow,
      document,
      [png, mp4],
      null,
      fakeTransfer,
    );

    expect(outcome).toBe('attached');
    expect(audio.set).toBeNull();
    expect(images.set).toEqual([png]);
    expect(changed).toHaveBeenCalledOnce();
  });

  it('gives a single-file control only the first file it accepts', () => {
    document.body.innerHTML = '<input type="file" id="one">';
    const one = watchFiles(document.getElementById('one') as HTMLInputElement);
    attachReferenceFiles(flow, document, [png, mp4], null, fakeTransfer);
    expect(one.set).toEqual([png]);
  });

  it('drops the files on the prompt box when there is no upload control', () => {
    document.body.innerHTML = '<textarea id="box"></textarea>';
    const box = document.getElementById('box')!;
    const drops: unknown[] = [];
    box.addEventListener('drop', (event) =>
      drops.push((event as DragEvent).dataTransfer),
    );

    expect(attachReferenceFiles(flow, document, [png], box, fakeTransfer)).toBe(
      'dropped',
    );
    expect(drops).toHaveLength(1);
  });

  it('skips disabled controls and reports when nothing could take the files', () => {
    document.body.innerHTML = '<input type="file" disabled>';
    expect(
      attachReferenceFiles(flow, document, [png], null, fakeTransfer),
    ).toBe('none');
    expect(attachReferenceFiles(flow, document, [], null, fakeTransfer)).toBe(
      'none',
    );
  });
});
