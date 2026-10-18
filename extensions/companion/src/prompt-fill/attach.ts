import type { JobReference } from '../desktop/contracts';
import type { ReferenceChunkResponse } from '../desktop/messages';
import type { AiSite } from '../sites/ai-sites';

/**
 * Reference files for a browser job: read from Drama Studio in pieces, then
 * handed to the site's own upload control, exactly as if the person had
 * picked them in the file dialog. Nothing is uploaded anywhere else.
 */
export type FetchReferenceChunk = (
  jobId: string,
  refId: string,
  offset: number,
) => Promise<ReferenceChunkResponse>;

function base64ToBytes(data: string): Uint8Array {
  const binary = globalThis.atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/** One reference as a File, or null if Drama Studio could not send it. */
export async function readReferenceFile(
  jobId: string,
  reference: JobReference,
  fetchChunk: FetchReferenceChunk,
): Promise<File | null> {
  const bytes = new Uint8Array(reference.bytes);
  let offset = 0;
  for (;;) {
    const piece = await fetchChunk(jobId, reference.refId, offset);
    if (
      !piece.ok ||
      piece.offset !== offset ||
      piece.bytes !== reference.bytes
    ) {
      return null;
    }
    const chunk = base64ToBytes(piece.data);
    if (offset + chunk.length > reference.bytes) return null;
    bytes.set(chunk, offset);
    offset += chunk.length;
    if (piece.done) break;
    if (chunk.length === 0) return null;
  }
  if (offset !== reference.bytes) return null;
  return new File([bytes], reference.name, { type: reference.mime });
}

export interface FileTransfer {
  items: { add(file: File): unknown };
  files: FileList;
}

export type CreateTransfer = () => FileTransfer | null;

const defaultTransfer: CreateTransfer = () =>
  typeof DataTransfer === 'function' ? new DataTransfer() : null;

function accepts(input: HTMLInputElement, file: File): boolean {
  const accept = input.accept.trim();
  if (!accept) return true;
  return accept.split(',').some((rule) => {
    const value = rule.trim().toLowerCase();
    if (!value) return false;
    if (value.startsWith('.')) return file.name.toLowerCase().endsWith(value);
    if (value.endsWith('/*')) return file.type.startsWith(value.slice(0, -1));
    return file.type === value;
  });
}

function fileInputs(site: AiSite, root: ParentNode): HTMLInputElement[] {
  const seen = new Set<HTMLInputElement>();
  for (const selector of site.fileInputSelectors) {
    let found: Element[];
    try {
      found = [...root.querySelectorAll(selector)];
    } catch {
      continue;
    }
    for (const element of found) {
      if (
        element instanceof HTMLInputElement &&
        element.type === 'file' &&
        !element.disabled
      ) {
        seen.add(element);
      }
    }
  }
  return [...seen];
}

export type AttachOutcome = 'attached' | 'dropped' | 'none';

/**
 * Gives the files to the site's upload control. Falls back to dropping them
 * on the prompt box, which many sites also accept. Never submits anything.
 */
export function attachReferenceFiles(
  site: AiSite,
  root: Document,
  files: readonly File[],
  promptBox: HTMLElement | null,
  createTransfer: CreateTransfer = defaultTransfer,
): AttachOutcome {
  if (files.length === 0) return 'none';
  for (const input of fileInputs(site, root)) {
    const usable = files.filter((file) => accepts(input, file));
    if (usable.length === 0) continue;
    const transfer = createTransfer();
    if (!transfer) return 'none';
    for (const file of input.multiple ? usable : usable.slice(0, 1)) {
      transfer.items.add(file);
    }
    try {
      input.files = transfer.files;
    } catch {
      continue;
    }
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return 'attached';
  }
  if (!promptBox) return 'none';
  const transfer = createTransfer();
  if (!transfer) return 'none';
  for (const file of files) transfer.items.add(file);
  for (const type of ['dragenter', 'dragover', 'drop']) {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: transfer });
    promptBox.dispatchEvent(event);
  }
  return 'dropped';
}
