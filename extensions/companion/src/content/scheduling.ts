import type { PromptGroup } from './types';

export function isPromptReady(
  group: PromptGroup,
  promptArrayIndex: number,
): boolean {
  if (promptArrayIndex === 0) return true;

  const previousIndex = promptArrayIndex - 1;
  const previousPayload = group.payloads[previousIndex];
  if (previousPayload?.isConcat) {
    return group.completedPromptIndexes.has(previousIndex);
  }
  return true;
}

export function takeNextReadyPromptIndex(group: PromptGroup): number | null {
  for (
    let queueIndex = 0;
    queueIndex < group.pendingIndexes.length;
    queueIndex += 1
  ) {
    const promptArrayIndex = group.pendingIndexes[queueIndex];
    if (
      promptArrayIndex !== undefined &&
      isPromptReady(group, promptArrayIndex)
    ) {
      group.pendingIndexes.splice(queueIndex, 1);
      return promptArrayIndex;
    }
  }
  return null;
}

export function calculateDelayMilliseconds(
  minimumSeconds: number,
  maximumSeconds: number,
  randomValue: number = Math.random(),
): number {
  const minimum = Math.max(0, minimumSeconds);
  const maximum = Math.max(minimum, maximumSeconds);
  const seconds =
    minimum >= maximum ? minimum : minimum + randomValue * (maximum - minimum);
  return seconds * 1_000;
}
