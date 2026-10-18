import {
  CAPTURE_CHUNK_BYTES,
  EXPECTED_REPLY,
  LEGACY_PROTOCOL_VERSION,
  LEGACY_REQUEST_TYPES,
  MAX_CAPTURE_BYTES,
  MAX_CAPTURE_PROMPT_CHARS,
  NATIVE_HOST_NAME,
  PROTOCOL_VERSION,
  desktopReplySchema,
  type CaptureMime,
  type CompanionRequest,
  type CompanionRequestType,
  type DesktopErrorCode,
  type DesktopResult,
  type JobParams,
  type JobReference,
  type JobState,
  type ReplyFor,
} from './contracts';
import { base64ToBytes, bytesToBase64, sha256Hex } from './bytes';

/**
 * Client side of the desktop link (plan §4). Background service worker only:
 * content scripts and pages cannot open a native port.
 *
 * Chrome starts one native host per port. Short exchanges (hello, a
 * hand-off, a job) use a port for one request and close it so the worker
 * can sleep; reading a reference or sending a capture keeps one port open
 * for all its pieces (NativeSession).
 */

export interface NativePortLike {
  postMessage(message: unknown): void;
  disconnect(): void;
  onMessage: { addListener(listener: (message: unknown) => void): void };
  onDisconnect: { addListener(listener: () => void): void };
}

export interface NativeClientDependencies {
  hasPermission: () => Promise<boolean>;
  connect: (hostName: string) => NativePortLike;
  lastErrorMessage: () => string | undefined;
  createId: () => string;
  sha256?: (bytes: Uint8Array) => Promise<string>;
}

const DEFAULT_TIMEOUT_MS = 5_000;

export function chromeNativeDependencies(): NativeClientDependencies {
  return {
    hasPermission: () =>
      chrome.permissions.contains({ permissions: ['nativeMessaging'] }),
    connect: (hostName) => {
      if (typeof chrome.runtime.connectNative !== 'function') {
        throw new Error('nativeMessaging permission is not granted');
      }
      return chrome.runtime.connectNative(hostName);
    },
    lastErrorMessage: () => chrome.runtime.lastError?.message,
    createId: () => crypto.randomUUID(),
  };
}

type RequestBody<T extends CompanionRequestType> = Omit<
  Extract<CompanionRequest, { type: T }>,
  'id' | 'protocol' | 'type'
>;

interface Pending {
  type: CompanionRequestType;
  settle: (result: DesktopResult<ReplyFor<CompanionRequestType>>) => void;
}

const rawId = (message: unknown): unknown =>
  message && typeof message === 'object'
    ? (message as Record<string, unknown>).id
    : undefined;

/** One native port carrying any number of requests, matched by id. */
export class NativeSession {
  private readonly pending = new Map<string, Pending>();
  private closedWith: DesktopErrorCode | null = null;

  constructor(
    private readonly port: NativePortLike,
    private readonly dependencies: NativeClientDependencies,
    private readonly timeoutMs: number,
  ) {
    port.onMessage.addListener((message) => this.receive(message));
    port.onDisconnect.addListener(() => {
      const detail = this.dependencies.lastErrorMessage() ?? '';
      this.failAll(
        /not found|not registered|forbidden/i.test(detail)
          ? 'host-missing'
          : 'app-not-running',
      );
    });
  }

  get closed(): boolean {
    return this.closedWith !== null;
  }

  request<T extends CompanionRequestType>(
    type: T,
    body: RequestBody<T>,
  ): Promise<DesktopResult<ReplyFor<T>>> {
    if (this.closedWith) {
      return Promise.resolve({ ok: false, code: this.closedWith });
    }
    const id = this.dependencies.createId();
    const protocol = LEGACY_REQUEST_TYPES.includes(type)
      ? LEGACY_PROTOCOL_VERSION
      : PROTOCOL_VERSION;
    return new Promise((resolve) => {
      const timer = globalThis.setTimeout(() => {
        this.pending.delete(id);
        resolve({ ok: false, code: 'timeout' });
      }, this.timeoutMs);
      this.pending.set(id, {
        type,
        settle: (result) => {
          globalThis.clearTimeout(timer);
          this.pending.delete(id);
          resolve(result as DesktopResult<ReplyFor<T>>);
        },
      });
      try {
        this.port.postMessage({ ...body, type, id, protocol });
      } catch {
        this.failAll('app-not-running');
      }
    });
  }

  close(): void {
    if (!this.closedWith) this.closedWith = 'app-not-running';
    for (const entry of [...this.pending.values()]) {
      entry.settle({ ok: false, code: 'app-not-running' });
    }
    try {
      this.port.disconnect();
    } catch {
      // Already closed.
    }
  }

  private receive(message: unknown): void {
    const parsed = desktopReplySchema.safeParse(message);
    if (!parsed.success) {
      const id = rawId(message);
      const entry = typeof id === 'string' ? this.pending.get(id) : undefined;
      if (entry) entry.settle({ ok: false, code: 'protocol' });
      else this.failAll('protocol');
      return;
    }
    const entry = this.pending.get(parsed.data.id);
    if (!entry) return;
    if (parsed.data.type === 'error') {
      entry.settle({ ok: false, code: parsed.data.code });
      return;
    }
    if (parsed.data.type !== EXPECTED_REPLY[entry.type]) {
      entry.settle({ ok: false, code: 'protocol' });
      return;
    }
    entry.settle({
      ok: true,
      value: parsed.data as ReplyFor<CompanionRequestType>,
    });
  }

  private failAll(code: DesktopErrorCode): void {
    if (!this.closedWith) this.closedWith = code;
    for (const entry of [...this.pending.values()]) {
      entry.settle({ ok: false, code });
    }
  }
}

export interface DesktopJob {
  jobId: string;
  site: string;
  kind: 'image' | 'video' | 'audio';
  prompt: string;
  params: JobParams;
  references: JobReference[];
}

export interface CaptureInput {
  jobId: string | null;
  site: string;
  prompt: string | null;
  mime: CaptureMime;
  name: string;
  bytes: Uint8Array;
}

export class NativeHostClient {
  constructor(
    private readonly dependencies: NativeClientDependencies = chromeNativeDependencies(),
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS,
  ) {}

  /** A port for several requests; the caller closes it. */
  async openSession(): Promise<DesktopResult<NativeSession>> {
    if (!(await this.dependencies.hasPermission())) {
      return { ok: false, code: 'permission-missing' };
    }
    try {
      const port = this.dependencies.connect(NATIVE_HOST_NAME);
      return {
        ok: true,
        value: new NativeSession(port, this.dependencies, this.timeoutMs),
      };
    } catch {
      return { ok: false, code: 'permission-missing' };
    }
  }

  /** One request, one reply, then the port closes so the worker can sleep. */
  async request<T extends CompanionRequestType>(
    type: T,
    body: RequestBody<T>,
  ): Promise<DesktopResult<ReplyFor<T>>> {
    return this.withSession((session) => session.request(type, body));
  }

  private async withSession<T>(
    run: (session: NativeSession) => Promise<DesktopResult<T>>,
  ): Promise<DesktopResult<T>> {
    const opened = await this.openSession();
    if (!opened.ok) return opened;
    try {
      return await run(opened.value);
    } finally {
      opened.value.close();
    }
  }

  async hello(
    extVersion: string,
    browser: string,
  ): Promise<DesktopResult<{ appVersion: string; paired: boolean }>> {
    const result = await this.request('hello', { extVersion, browser });
    if (!result.ok) return result;
    return {
      ok: true,
      value: {
        appVersion: result.value.appVersion,
        paired: result.value.paired,
      },
    };
  }

  async fetchHandoff(
    token: string,
    expectedSite: string,
  ): Promise<DesktopResult<{ prompt: string }>> {
    const result = await this.request('handoff.fetch', { token });
    if (!result.ok) return result;
    if (result.value.site !== expectedSite) {
      return { ok: false, code: 'handoff-wrong-site' };
    }
    return { ok: true, value: { prompt: result.value.prompt } };
  }

  /** A browser job, once; `acceptsSite` checks it was meant for this tab. */
  async fetchJob(
    token: string,
    acceptsSite: (site: string) => boolean,
  ): Promise<DesktopResult<DesktopJob>> {
    const result = await this.request('job.fetch', { token });
    if (!result.ok) return result;
    if (!acceptsSite(result.value.site)) {
      return { ok: false, code: 'handoff-wrong-site' };
    }
    const { jobId, site, kind, prompt, params, references } = result.value;
    return {
      ok: true,
      value: { jobId, site, kind, prompt, params, references },
    };
  }

  async updateJob(
    jobId: string,
    state: JobState,
    reason?: string,
  ): Promise<DesktopResult<true>> {
    const body = reason
      ? { jobId, state, reason: reason.slice(0, 200) }
      : { jobId, state };
    const result = await this.request('job.update', body);
    return result.ok ? { ok: true, value: true } : result;
  }

  /** One piece of a job reference, for the page that attaches it. */
  async readReferenceChunk(
    jobId: string,
    refId: string,
    offset: number,
  ): Promise<
    DesktopResult<{
      data: string;
      done: boolean;
      bytes: number;
      offset: number;
    }>
  > {
    const result = await this.request('asset.read', { jobId, refId, offset });
    if (!result.ok) return result;
    const { data, done, bytes } = result.value;
    return {
      ok: true,
      value: { data, done, bytes, offset: result.value.offset },
    };
  }

  /** All bytes of one job reference, read in pieces over one port. */
  async readReference(
    jobId: string,
    reference: JobReference,
  ): Promise<DesktopResult<Uint8Array>> {
    return this.withSession(async (session) => {
      const bytes = new Uint8Array(reference.bytes);
      let offset = 0;
      for (;;) {
        const result = await session.request('asset.read', {
          jobId,
          refId: reference.refId,
          offset,
        });
        if (!result.ok) return result;
        const piece = base64ToBytes(result.value.data);
        if (
          result.value.offset !== offset ||
          result.value.bytes !== reference.bytes ||
          offset + piece.length > reference.bytes
        ) {
          return { ok: false, code: 'protocol' };
        }
        bytes.set(piece, offset);
        offset += piece.length;
        if (result.value.done) break;
        if (piece.length === 0) return { ok: false, code: 'protocol' };
      }
      if (offset !== reference.bytes) return { ok: false, code: 'protocol' };
      return { ok: true, value: bytes };
    });
  }

  /** Sends one picture or video to Drama Studio, checked end to end. */
  async sendCapture(
    capture: CaptureInput,
  ): Promise<DesktopResult<{ captureId: string }>> {
    const size = capture.bytes.length;
    if (size < 1) return { ok: false, code: 'capture-refused' };
    if (size > MAX_CAPTURE_BYTES) return { ok: false, code: 'too-large' };
    const sha256 = await (this.dependencies.sha256 ?? sha256Hex)(capture.bytes);
    return this.withSession(async (session) => {
      const begun = await session.request('capture.begin', {
        jobId: capture.jobId,
        site: capture.site.slice(0, 32),
        prompt:
          capture.prompt === null
            ? null
            : capture.prompt.slice(0, MAX_CAPTURE_PROMPT_CHARS),
        mime: capture.mime,
        bytes: size,
        sha256,
        name: capture.name.slice(0, 200),
      });
      if (!begun.ok) return begun;
      const { captureId } = begun.value;
      const chunkBytes = Math.min(begun.value.chunkBytes, CAPTURE_CHUNK_BYTES);
      for (
        let index = 0, offset = 0;
        offset < size;
        index += 1, offset += chunkBytes
      ) {
        const sent = await session.request('capture.chunk', {
          captureId,
          index,
          data: bytesToBase64(
            capture.bytes.subarray(offset, offset + chunkBytes),
          ),
        });
        if (!sent.ok) return sent;
      }
      const ended = await session.request('capture.end', { captureId });
      if (!ended.ok) return ended;
      return { ok: true, value: { captureId } };
    });
  }
}
