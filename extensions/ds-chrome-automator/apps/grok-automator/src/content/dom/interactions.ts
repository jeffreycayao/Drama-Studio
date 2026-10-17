import type { CancellationCheck } from '../types';
import { query, type QueryCollection } from './jquery-bridge';
import { domInteractionMutex } from './mutex';

export const CANCELLED_ERROR_MESSAGE = 'Cancelled';

export function delayWithCancellation(
  milliseconds: number,
  isCancelled?: CancellationCheck,
): Promise<void> {
  if (!isCancelled) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (isCancelled()) {
        clearInterval(timer);
        reject(new Error(CANCELLED_ERROR_MESSAGE));
      } else if (Date.now() - startedAt >= milliseconds) {
        clearInterval(timer);
        resolve();
      }
    }, 50);
  });
}

export function isElementInteractable(collection: QueryCollection): boolean {
  const element = collection[0];
  if (!element || !collection.is(':visible') || collection.is(':disabled'))
    return false;

  const bounds = element.getBoundingClientRect();
  if (bounds.width === 0 || bounds.height === 0) return false;

  const style = window.getComputedStyle(element);
  return (
    style.display !== 'none' &&
    style.visibility !== 'hidden' &&
    style.opacity !== '0'
  );
}

export async function waitForElement<TElement extends Element = Element>(
  selector: string,
  isCancelled?: CancellationCheck,
  timeoutMilliseconds = 5_000,
  pollMilliseconds = 100,
  requireInteractable = true,
): Promise<QueryCollection<TElement> | null> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMilliseconds) {
    if (isCancelled?.()) throw new Error(CANCELLED_ERROR_MESSAGE);
    const collection = query<TElement>(selector);
    if (
      requireInteractable
        ? isElementInteractable(collection)
        : collection.length > 0
    ) {
      await delayWithCancellation(200, isCancelled);
      return collection;
    }
    await delayWithCancellation(pollMilliseconds, isCancelled);
  }
  return null;
}

export async function clickElement(
  selector: string,
  description = 'Undefined element button',
  isCancelled?: CancellationCheck,
  timeoutMilliseconds = 5_000,
  pollMilliseconds = 100,
): Promise<void> {
  await domInteractionMutex.runExclusive(async () => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMilliseconds) {
      if (isCancelled?.()) throw new Error(CANCELLED_ERROR_MESSAGE);
      await delayWithCancellation(pollMilliseconds, isCancelled);
      const collection = query(selector);
      if (!isElementInteractable(collection)) continue;

      const element = collection.get(0);
      if (element) {
        for (const eventName of [
          'pointerover',
          'mouseover',
          'pointerdown',
          'mousedown',
          'pointerup',
          'mouseup',
          'click',
        ]) {
          element.dispatchEvent(
            new MouseEvent(eventName, {
              bubbles: true,
              cancelable: true,
              composed: true,
              view: window,
              detail: 1,
            }),
          );
        }
        await delayWithCancellation(300, isCancelled);
      }
      return;
    }

    if (isCancelled?.()) throw new Error(CANCELLED_ERROR_MESSAGE);
    const suffix =
      query(selector).length === 0
        ? `Element not found: ${selector}`
        : 'Element found but not fully visible/ready';
    throw new Error(
      `${description} - ${suffix} within timeout (${timeoutMilliseconds}ms)`,
    );
  });
}
