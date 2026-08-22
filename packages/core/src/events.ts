export type Awaitable<T> = T | Promise<T>;

/** The single payload carried by an event (events with none use `undefined`). */
export type EventPayload<Events, K extends keyof Events> = Events[K];

/**
 * Arguments passed to an event listener / `emit`. A `undefined` payload event
 * takes zero arguments at the call site; everything else takes exactly one.
 */
export type EventArgs<Payload> = [Payload] extends [undefined] ? [] : [payload: Payload];

export type EventHandler<Payload> = (...args: EventArgs<Payload>) => Awaitable<void>;

interface ListenerEntry {
  /** The callable actually invoked on `emit` (plain or once). */
  invoke: (...args: any[]) => Awaitable<void>;
  /** The original handler passed by the caller — identity used by `off` and dedup. */
  orig: (...args: any[]) => Awaitable<void>;
  once: boolean;
  /** Tombstone: removed during an in-flight dispatch; see `emit` snapshot. */
  removed: boolean;
}

/**
 * A type-safe, serial, async event bus. Single payload per event, listeners
 * run in registration order and are awaited sequentially; a throwing listener
 * rejects the current `emit()` and stops the remaining listeners. Unsubscribing
 * inside an emit only affects the next dispatch (the listener set is snapshotted
 * up front), except `once` listeners, which are removed before they run.
 */
export class EventBus<Events> {
  private readonly entries = new Map<string, ListenerEntry[]>();

  on<K extends keyof Events & string>(event: K, handler: EventHandler<Events[K]>): this {
    this.add(event, handler, false);
    return this;
  }

  once<K extends keyof Events & string>(event: K, handler: EventHandler<Events[K]>): this {
    this.add(event, handler, true);
    return this;
  }

  off<K extends keyof Events & string>(event: K, handler: EventHandler<Events[K]>): this {
    const bucket = this.entries.get(event);
    if (!bucket) return this;
    for (let i = 0; i < bucket.length; i++) {
      const entry = bucket[i]!;
      if (entry.orig === handler) {
        entry.removed = true;
        bucket.splice(i, 1);
        if (bucket.length === 0) this.entries.delete(event);
        break;
      }
    }
    return this;
  }

  async emit<K extends keyof Events & string>(
    event: K,
    ...args: EventArgs<Events[K]>
  ): Promise<void> {
    const bucket = this.entries.get(event);
    // Fast path: no listeners → no snapshot, no promise materialization.
    if (!bucket || bucket.length === 0) return;
    const snapshot = bucket.slice();
    for (const entry of snapshot) {
      if (entry.removed) continue;
      // `once` listeners are unsubscribed before running so a throwing listener
      // never fires again.
      if (entry.once) entry.removed = true;
      await entry.invoke(...args);
    }
  }

  removeAllListeners<K extends keyof Events & string>(event?: K): this {
    if (event === undefined) this.entries.clear();
    else this.entries.delete(event);
    return this;
  }

  listenerCount<K extends keyof Events & string>(event: K): number {
    return this.entries.get(event)?.length ?? 0;
  }

  /**
   * Cheap "is anyone listening to *any* of these events" probe used by the
   * hot paths to skip event wrapping/emission entirely when the bus is quiet.
   */
  hasAnyOf<K extends keyof Events & string>(events: readonly K[]): boolean {
    for (const event of events) {
      const bucket = this.entries.get(event);
      if (bucket && bucket.length > 0) return true;
    }
    return false;
  }

  private add<K extends keyof Events & string>(
    event: K,
    handler: EventHandler<Events[K]>,
    once: boolean,
  ): void {
    let bucket = this.entries.get(event);
    if (!bucket) {
      bucket = [];
      this.entries.set(event, bucket);
    }
    // Dedup: the same handler for the same event registers once, whether plain
    // or via `once` (off() by the original handler removes it either way).
    for (const entry of bucket) {
      if (entry.orig === handler) return;
    }
    bucket.push({
      invoke: handler as (...args: any[]) => Awaitable<void>,
      orig: handler as (...args: any[]) => Awaitable<void>,
      once,
      removed: false,
    });
  }
}

/** Compatibility alias — use `EventBus` (no Node `events` dependency). */
export const EventEmitter = EventBus;

/**
 * A write-only publishing surface (emit only). Hand this to middleware / plugins
 * that must raise events without being able to register (and thus leak) global
 * listeners.
 */
export interface EventPublisher<Events> {
  emit<K extends keyof Events & string>(event: K, ...args: EventArgs<Events[K]>): Promise<void>;
}
