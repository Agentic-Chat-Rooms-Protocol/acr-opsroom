/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Provenance: Lifted from `google/adk-js` (commit `8dad457`, v2.4.0)
 * `core/src/utils/async_queue.ts`.
 */

/**
 * A generic, single-consumer async queue that implements AsyncIterable,
 * bridging a *push* producer to a *pull* consumer (`for await (const x of q)`).
 */
export class AsyncQueue<T> implements AsyncIterable<T> {
  private queue: Array<{ value: T; ack?: () => void }> = [];
  private resolvers: Array<{
    resolve: (value: IteratorResult<T>) => void;
    reject: (reason?: unknown) => void;
  }> = [];
  private closed = false;
  private failure?: { error: unknown };
  /** Releases the producer of the item the consumer currently holds. */
  private deliveredAck?: () => void;

  /** Whether the queue has been closed or failed. */
  get isClosed(): boolean {
    return this.closed;
  }

  /** Number of items buffered and not yet consumed. */
  get size(): number {
    return this.queue.length;
  }

  /**
   * Enqueues a value. If a consumer is currently awaiting, it is resolved
   * immediately; otherwise the value is buffered. No-op once closed/failed.
   */
  push(value: T): void {
    this.enqueue(value);
  }

  /**
   * Enqueues a value like {@link push}, and resolves once the consumer has
   * finished with it: when it asks for the next item, or when the queue closes
   * or fails. Resolves at once if the queue is already closed.
   */
  pushAndWait(value: T): Promise<void> {
    return new Promise<void>((resolve) => this.enqueue(value, resolve));
  }

  private enqueue(value: T, ack?: () => void): void {
    if (this.closed) {
      ack?.();
      return;
    }
    const resolver = this.resolvers.shift();
    if (resolver) {
      this.deliveredAck = ack;
      resolver.resolve({ value, done: false });
    } else {
      this.queue.push({ value, ack });
    }
  }

  /** Releases every producer still waiting in {@link pushAndWait}. */
  private releaseAll(): void {
    this.releaseDelivered();
    for (const item of this.queue) {
      item.ack?.();
      item.ack = undefined;
    }
  }

  private releaseDelivered(): void {
    const ack = this.deliveredAck;
    this.deliveredAck = undefined;
    ack?.();
  }

  /**
   * Signals that production failed. Buffered items are still delivered first;
   * once the buffer drains, the consumer's next `next()` rejects with `error`.
   */
  fail(error: unknown): void {
    if (this.failure) return;
    this.failure = { error };
    this.closed = true;
    this.releaseAll();
    while (this.resolvers.length > 0) {
      this.resolvers.shift()!.reject(error);
    }
  }

  /** @deprecated Alias for {@link fail}; kept for existing callers. */
  error(err: unknown): void {
    this.fail(err);
  }

  /**
   * Signals that no more items will be produced. Any awaiting consumer receives
   * `{done: true}`. Idempotent.
   */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.releaseAll();
    while (this.resolvers.length > 0) {
      this.resolvers.shift()!.resolve({ value: undefined as never, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: (): Promise<IteratorResult<T>> => {
        this.releaseDelivered();
        if (this.queue.length > 0) {
          const item = this.queue.shift()!;
          this.deliveredAck = item.ack;
          return Promise.resolve({ value: item.value, done: false });
        }
        if (this.failure) {
          return Promise.reject(this.failure.error);
        }
        if (this.closed) {
          return Promise.resolve({ value: undefined as never, done: true });
        }
        return new Promise<IteratorResult<T>>((resolve, reject) => {
          this.resolvers.push({ resolve, reject });
        });
      },
    };
  }
}
