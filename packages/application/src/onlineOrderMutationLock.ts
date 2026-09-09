export class OnlineOrderMutationLock {
  readonly #tails = new Map<string, Promise<void>>();

  async run<T>(requestId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.#tails.get(requestId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => gate);
    this.#tails.set(requestId, tail);

    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.#tails.get(requestId) === tail) {
        this.#tails.delete(requestId);
      }
    }
  }
}

export const onlineOrderMutationLock = new OnlineOrderMutationLock();
