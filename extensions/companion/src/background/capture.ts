import {
  CAPTURE_MIME_TYPES,
  DESKTOP_ERROR_MESSAGES,
  MAX_CAPTURE_BYTES,
  MAX_CAPTURE_PROMPT_CHARS,
  type CaptureMime,
  type DesktopResult,
} from '../desktop/contracts';
import type { CaptureInput } from '../desktop/native-client';
import { isAllowedGeneratedHttpsUrl } from '../security/urls';
import { promptSiteForHostname } from '../sites/prompt-sites';
import type { TabJob } from './tab-jobs';

/**
 * "Send to Drama Studio" on a picture or video (plan step 1). The person
 * chooses the file; the Companion downloads it from the page, and the
 * desktop link checks its size and sha-256 before keeping it.
 */
export const CAPTURE_MENU_ID = 'ds-send-to-drama-studio';

export const CAPTURE_SENT_MESSAGE =
  'Sent to Drama Studio. It appears in your project under AI Sites.';
export const CAPTURE_UNSUPPORTED_MESSAGE =
  'Only pictures and videos made on this site can be sent to Drama Studio.';
export const CAPTURE_DOWNLOAD_FAILED_MESSAGE =
  'Could not download this file from the page. Wait until it has finished loading, then try again.';

const EXTENSION_MIME: Record<string, CaptureMime> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
};

export interface FetchedMedia {
  bytes: Uint8Array;
  contentType: string | null;
}

export interface CaptureDependencies {
  fetchMedia: (
    url: string,
    maxBytes: number,
  ) => Promise<FetchedMedia | 'too-large' | null>;
  send: (
    capture: CaptureInput,
  ) => Promise<DesktopResult<{ captureId: string }>>;
}

export interface CaptureRequest {
  srcUrl: string | undefined;
  pageUrl: string | undefined;
  tabJob: TabJob | null;
}

export function captureMime(
  contentType: string | null,
  url: URL,
): CaptureMime | null {
  const declared =
    (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  if ((CAPTURE_MIME_TYPES as readonly string[]).includes(declared)) {
    return declared as CaptureMime;
  }
  const extension = /\.([a-z0-9]{2,5})$/i
    .exec(url.pathname)?.[1]
    ?.toLowerCase();
  return extension ? (EXTENSION_MIME[extension] ?? null) : null;
}

export function captureName(url: URL): string {
  let last = url.pathname.split('/').pop() ?? '';
  try {
    last = decodeURIComponent(last);
  } catch {
    // Keep the raw segment.
  }
  // eslint-disable-next-line no-control-regex
  const cleaned = last.replace(/[\u0000-\u001f<>:"/\\|?*]/g, '').trim();
  return (cleaned || 'capture').slice(0, 200);
}

function captureSite(request: CaptureRequest): string {
  if (request.tabJob) return request.tabJob.site;
  try {
    const page = new URL(request.pageUrl ?? '');
    return promptSiteForHostname(page.hostname)?.id ?? 'web';
  } catch {
    return 'web';
  }
}

/** Returns the message to show the person. */
export async function sendCaptureToDesktop(
  request: CaptureRequest,
  dependencies: CaptureDependencies,
): Promise<string> {
  const srcUrl = request.srcUrl ?? '';
  if (!isAllowedGeneratedHttpsUrl(srcUrl)) return CAPTURE_UNSUPPORTED_MESSAGE;
  const url = new URL(srcUrl);

  let fetched: FetchedMedia | 'too-large' | null;
  try {
    fetched = await dependencies.fetchMedia(srcUrl, MAX_CAPTURE_BYTES);
  } catch {
    fetched = null;
  }
  if (fetched === 'too-large') return DESKTOP_ERROR_MESSAGES['too-large'];
  if (!fetched || fetched.bytes.length === 0)
    return CAPTURE_DOWNLOAD_FAILED_MESSAGE;

  const mime = captureMime(fetched.contentType, url);
  if (!mime) return CAPTURE_UNSUPPORTED_MESSAGE;

  const result = await dependencies.send({
    jobId: request.tabJob?.jobId ?? null,
    site: captureSite(request),
    prompt: request.tabJob?.prompt.slice(0, MAX_CAPTURE_PROMPT_CHARS) ?? null,
    mime,
    name: captureName(url),
    bytes: fetched.bytes,
  });
  return result.ok ? CAPTURE_SENT_MESSAGE : DESKTOP_ERROR_MESSAGES[result.code];
}

/** Downloads with the person's cookies, refusing anything over `maxBytes`. */
export async function fetchMediaWithLimit(
  url: string,
  maxBytes: number,
  fetchImpl: typeof fetch = fetch,
): Promise<FetchedMedia | 'too-large' | null> {
  const response = await fetchImpl(url, { credentials: 'include' });
  if (!response.ok || !response.body) return null;
  // A redirect must stay on the site's own media hosts.
  if (response.url && !isAllowedGeneratedHttpsUrl(response.url)) {
    await response.body.cancel().catch(() => {});
    return null;
  }
  const declared = Number(response.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body.cancel().catch(() => {});
    return 'too-large';
  }
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return 'too-large';
    }
    parts.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return { bytes, contentType: response.headers.get('content-type') };
}
