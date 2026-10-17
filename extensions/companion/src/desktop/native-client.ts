import {
  NATIVE_HOST_NAME,
  PROTOCOL_VERSION,
  desktopReplySchema,
  type CompanionRequest,
  type DesktopReply,
  type DesktopResult,
} from './contracts';

/**
 * Client side of the desktop link (plan §4). Background service worker only:
 * content scripts and pages cannot open a native port.
 *
 * This is a stub until the desktop app ships its native host. It already
 * speaks the final wire format, so the host can be built against it, and it
 * reports `host-missing` cleanly in the meantime.
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

type RequestBody<T extends CompanionRequest['type']> = Omit<
  Extract<CompanionRequest, { type: T }>,
  'id' | 'protocol' | 'type'
>;

export class NativeHostClient {
  constructor(
    private readonly dependencies: NativeClientDependencies = chromeNativeDependencies(),
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS,
  ) {}

  /** One request, one reply, then the port closes so the worker can sleep. */
  async request<T extends CompanionRequest['type']>(
    type: T,
    body: RequestBody<T>,
  ): Promise<DesktopResult<DesktopReply>> {
    if (!(await this.dependencies.hasPermission())) {
      return { ok: false, code: 'permission-missing' };
    }
    const id = this.dependencies.createId();
    let port: NativePortLike;
    try {
      port = this.dependencies.connect(NATIVE_HOST_NAME);
    } catch {
      return { ok: false, code: 'permission-missing' };
    }

    return new Promise((resolve) => {
      let settled = false;
      const settle = (result: DesktopResult<DesktopReply>): void => {
        if (settled) return;
        settled = true;
        globalThis.clearTimeout(timer);
        try {
          port.disconnect();
        } catch {
          // Already closed.
        }
        resolve(result);
      };
      const timer = globalThis.setTimeout(
        () => settle({ ok: false, code: 'timeout' }),
        this.timeoutMs,
      );

      port.onMessage.addListener((message) => {
        const parsed = desktopReplySchema.safeParse(message);
        if (!parsed.success) {
          settle({ ok: false, code: 'protocol' });
          return;
        }
        if (parsed.data.id !== id) return;
        if (parsed.data.type === 'error') {
          settle({ ok: false, code: parsed.data.code });
          return;
        }
        settle({ ok: true, value: parsed.data });
      });
      port.onDisconnect.addListener(() => {
        const detail = this.dependencies.lastErrorMessage() ?? '';
        settle({
          ok: false,
          code: /not found|not registered|forbidden/i.test(detail)
            ? 'host-missing'
            : 'app-not-running',
        });
      });

      port.postMessage({ ...body, type, id, protocol: PROTOCOL_VERSION });
    });
  }

  async hello(
    extVersion: string,
    browser: string,
  ): Promise<DesktopResult<{ appVersion: string; paired: boolean }>> {
    const result = await this.request('hello', { extVersion, browser });
    if (!result.ok) return result;
    if (result.value.type !== 'hello.reply') {
      return { ok: false, code: 'protocol' };
    }
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
    if (result.value.type !== 'handoff.reply') {
      return { ok: false, code: 'protocol' };
    }
    if (result.value.site !== expectedSite) {
      return { ok: false, code: 'handoff-wrong-site' };
    }
    return { ok: true, value: { prompt: result.value.prompt } };
  }
}
