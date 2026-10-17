import { isHttpsGrokUrl } from '../security/urls';

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
