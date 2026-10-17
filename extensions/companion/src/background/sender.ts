import { isHttpsGrokUrl } from '../security/urls';
import { promptSiteForHostname, type PromptSite } from '../sites/prompt-sites';

export interface RuntimeMessageSenderLike {
  id?: string | undefined;
  frameId?: number | undefined;
  url?: string | undefined;
  tab?:
    | {
        id?: number | undefined;
        url?: string | undefined;
      }
    | undefined;
}

export function isTrustedGrokContentSender(
  sender: RuntimeMessageSenderLike,
  extensionId: string,
): boolean {
  if (
    !extensionId ||
    sender.id !== extensionId ||
    sender.frameId !== 0 ||
    sender.tab?.id === undefined ||
    !isHttpsGrokUrl(sender.url)
  ) {
    return false;
  }

  return sender.tab.url === undefined || isHttpsGrokUrl(sender.tab.url);
}

/** A prompt-fill content script in the top frame of a known AI site. */
export function promptSiteOfContentSender(
  sender: RuntimeMessageSenderLike,
  extensionId: string,
): PromptSite | null {
  if (
    !extensionId ||
    sender.id !== extensionId ||
    sender.frameId !== 0 ||
    sender.tab?.id === undefined ||
    !sender.url
  ) {
    return null;
  }
  try {
    const url = new URL(sender.url);
    if (url.protocol !== 'https:') return null;
    return promptSiteForHostname(url.hostname);
  } catch {
    return null;
  }
}

/** The side panel or another page of this extension (never a web page). */
export function isTrustedExtensionPageSender(
  sender: RuntimeMessageSenderLike,
  extensionId: string,
): boolean {
  if (!extensionId || sender.id !== extensionId || sender.tab !== undefined) {
    return false;
  }
  return (
    typeof sender.url === 'string' &&
    sender.url.startsWith(`chrome-extension://${extensionId}/`)
  );
}
