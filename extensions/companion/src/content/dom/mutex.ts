export class Mutex {
  private tail: Promise<void> = Promise.resolve();

  async runExclusive<TResult>(
    operation: () => Promise<TResult>,
  ): Promise<TResult> {
    let release: (() => void) | undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previous = this.tail;
    this.tail = previous.then(() => current);
    await previous;
    try {
      return await operation();
    } finally {
      release?.();
    }
  }
}

export const domInteractionMutex = new Mutex();
