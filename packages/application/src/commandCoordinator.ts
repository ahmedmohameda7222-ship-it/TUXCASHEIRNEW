export class ApplicationCommandCoordinator {
  #tail: Promise<void> = Promise.resolve();

  async runExclusive<Result>(work: () => Promise<Result>): Promise<Result> {
    const previous = this.#tail;
    let release = (): void => undefined;
    this.#tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await work();
    } finally {
      release();
    }
  }
}
