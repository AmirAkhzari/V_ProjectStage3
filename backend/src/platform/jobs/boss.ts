/**
 * pg-boss job queue skeleton (P0-E5-T4). Jobs must enqueue in the same DB transaction as the
 * write they belong to. The queue schema is not created in Foundation (F-6 empty schemas), so this
 * is a typed handle with a no-op in-memory implementation used by the worker heartbeat.
 */
export interface JobHandle {
  name: string;
  singletonKey?: string;
}

export interface JobQueue<TTx = unknown> {
  enqueue(tx: TTx, job: JobHandle, payload: unknown, options?: { runAt?: Date }): Promise<void>;
  work(name: string, handler: (payload: unknown) => Promise<void>): Promise<void>;
  stop(): Promise<void>;
}

export class InMemoryJobQueue implements JobQueue<unknown> {
  readonly enqueued: { job: JobHandle; payload: unknown }[] = [];
  private readonly handlers = new Map<string, (payload: unknown) => Promise<void>>();

  enqueue(_tx: unknown, job: JobHandle, payload: unknown): Promise<void> {
    this.enqueued.push({ job, payload });
    return Promise.resolve();
  }

  work(name: string, handler: (payload: unknown) => Promise<void>): Promise<void> {
    this.handlers.set(name, handler);
    return Promise.resolve();
  }

  async drain(): Promise<void> {
    const pending = this.enqueued.splice(0);
    for (const item of pending) {
      const handler = this.handlers.get(item.job.name);
      if (handler) await handler(item.payload);
    }
  }

  stop(): Promise<void> {
    this.handlers.clear();
    return Promise.resolve();
  }
}
