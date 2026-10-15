import type { z } from 'zod';
import { StorageEnvelope, type StorageKey } from '@/contract/storage';
import { quarantine } from './quarantine';
import type { Queue } from './tx';
import type { StorageLike } from './types';

export interface RecordDefinition<T> {
  key: StorageKey;
  /** Schema version written into the envelope. */
  version: number;
  schema: z.ZodType<T>;
  /** Value shown when the key is missing or unreadable; must return a fresh object. */
  defaults: () => T;
  /**
   * Turns data written by an older version into the current shape. Pure, so
   * running it again on its own output changes nothing. Absent while a key has
   * only ever had one version.
   */
  upgrade?: (data: unknown, fromVersion: number) => unknown;
}

export type InvalidReason = 'malformed-envelope' | 'schema-mismatch' | 'newer-version';

/**
 * Reads are tri-state. Treating `invalid` like `missing` is how data gets
 * lost, so an invalid read carries the raw value and what was wrong with it.
 */
export type ReadResult<T> =
  | { status: 'ok'; value: T }
  | { status: 'missing'; value: T }
  | {
      status: 'invalid';
      value: T;
      reason: InvalidReason;
      issues: string[];
      raw: unknown;
      /** Written by a newer version: shown but never overwritten. */
      readOnly: boolean;
    };

export interface UpdateResult<T> {
  value: T;
  /** The previous, unreadable value was backed up before being replaced. */
  quarantined: boolean;
}

export class ReadOnlyRecordError extends Error {
  readonly key: StorageKey;
  readonly storedVersion: number;

  constructor(key: StorageKey, storedVersion: number) {
    super(`${key} was written by a newer version (${storedVersion}); refusing to overwrite it.`);
    this.name = 'ReadOnlyRecordError';
    this.key = key;
    this.storedVersion = storedVersion;
  }
}

export interface Repo<T> {
  read(): Promise<ReadResult<T>>;
  /**
   * Read-modify-write through the shared queue. Refuses when the stored value
   * came from a newer version, and backs up an unreadable value before
   * replacing it.
   */
  update(change: (current: T) => T): Promise<UpdateResult<T>>;
  /**
   * The same read-modify-write for a task that already runs in the queue,
   * because several records change together (removing the default model also
   * moves the default). Anywhere else, writes could interleave and lose updates.
   */
  updateUnqueued(change: (current: T) => T): Promise<UpdateResult<T>>;
  /**
   * Deletes the record, in a task that already runs in the queue. Only for
   * records whose lifetime the extension manages by design: conversation
   * snapshots are evicted for space and dropped with their tab
   * (docs/development-plan.md §4.4). The user's own data goes only by the
   * user's explicit action. Like every write, it refuses a value written by
   * a newer version.
   */
  removeUnqueued(): Promise<void>;
}

export function createRepo<T>(
  store: StorageLike,
  queue: Queue,
  definition: RecordDefinition<T>,
): Repo<T> {
  const updateUnqueued = async (change: (current: T) => T): Promise<UpdateResult<T>> => {
    const raw = await store.get(definition.key);
    const current = interpret(definition, raw);

    if (current.status === 'invalid' && current.readOnly) {
      throw new ReadOnlyRecordError(definition.key, storedVersionOf(raw));
    }

    let quarantined = false;
    if (current.status === 'invalid') {
      await quarantine(store, definition.key, raw);
      quarantined = true;
    }

    const value = definition.schema.parse(change(current.value));
    const envelope: StorageEnvelope = { version: definition.version, data: value };
    await store.set(definition.key, envelope);
    return { value, quarantined };
  };

  const removeUnqueued = async (): Promise<void> => {
    const raw = await store.get(definition.key);
    if (raw === undefined) return;
    const current = interpret(definition, raw);
    if (current.status === 'invalid' && current.readOnly) {
      throw new ReadOnlyRecordError(definition.key, storedVersionOf(raw));
    }
    await store.remove(definition.key);
  };

  return {
    async read() {
      return interpret(definition, await store.get(definition.key));
    },
    update: (change) => queue(() => updateUnqueued(change)),
    updateUnqueued,
    removeUnqueued,
  };
}

export function interpret<T>(definition: RecordDefinition<T>, raw: unknown): ReadResult<T> {
  if (raw === undefined || raw === null) {
    return { status: 'missing', value: definition.defaults() };
  }

  const invalid = (reason: InvalidReason, issues: string[], value = definition.defaults()) =>
    ({
      status: 'invalid',
      value,
      reason,
      issues,
      raw,
      readOnly: reason === 'newer-version',
    }) as const;

  const envelope = StorageEnvelope.safeParse(raw);
  if (!envelope.success) return invalid('malformed-envelope', describe(envelope.error));

  const { version } = envelope.data;
  if (version > definition.version) {
    // Show what the newer version wrote if this version can still read it.
    const parsed = definition.schema.safeParse(envelope.data.data);
    return invalid(
      'newer-version',
      [`stored version ${version} is newer than ${definition.version}`],
      parsed.success ? parsed.data : definition.defaults(),
    );
  }

  let data = envelope.data.data;
  if (version < definition.version) {
    if (!definition.upgrade) {
      return invalid('schema-mismatch', [`no upgrade from version ${version}`]);
    }
    try {
      data = definition.upgrade(data, version);
    } catch (error) {
      return invalid('schema-mismatch', [
        `upgrade from version ${version} failed: ${String(error)}`,
      ]);
    }
  }

  const parsed = definition.schema.safeParse(data);
  if (!parsed.success) return invalid('schema-mismatch', describe(parsed.error));
  return { status: 'ok', value: parsed.data };
}

function describe(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.map(String).join('.');
    return path ? `${path}: ${issue.message}` : issue.message;
  });
}

/** The version an envelope says it was written with; `NaN` for anything else. */
export function storedVersionOf(raw: unknown): number {
  const envelope = StorageEnvelope.safeParse(raw);
  return envelope.success ? envelope.data.version : Number.NaN;
}
