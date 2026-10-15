import {
  CONFIG_FILE_FORMAT,
  CONFIG_FILE_VERSION,
  MAX_IMPORTED_ITEMS,
} from '@/contract/config-transfer';
import { ModelConfigDraft, type ModelConfig } from '@/contract/model-config';
import { PromptConfigDraft, type PromptConfig } from '@/contract/prompt-config';
import { withoutCredentials } from './credentials';

/** The fields of a model configuration a file carries; the id never travels. */
const MODEL_FIELDS = [
  'name',
  'baseURL',
  'apiKey',
  'model',
  'headers',
  'extraBody',
  'contextWindow',
  'streamUsage',
] as const;
const PROMPT_FIELDS = ['name', 'system', 'user'] as const;

export interface ConfigFile {
  format: typeof CONFIG_FILE_FORMAT;
  version: number;
  exportedAt: string;
  models: unknown[];
  prompts: unknown[];
}

/**
 * The export file. Credentials (`apiKey`, `headers`, the query of `baseURL`)
 * are left out unless the user asked for them (docs/development-plan.md §8).
 * Only the known fields are written: a field a newer version added to a
 * stored row means nothing to the version that imports it.
 */
export function buildConfigFile(
  models: readonly ModelConfig[],
  prompts: readonly PromptConfig[],
  { withCredentials, at }: { withCredentials: boolean; at: Date },
): ConfigFile {
  const modelRows = models.map((model) => pick(model, MODEL_FIELDS));
  return {
    format: CONFIG_FILE_FORMAT,
    version: CONFIG_FILE_VERSION,
    exportedAt: at.toISOString(),
    models: withCredentials ? modelRows : (withoutCredentials(modelRows) as unknown[]),
    prompts: prompts.map((prompt) => pick(prompt, PROMPT_FIELDS)),
  };
}

export type ImportProblem =
  /** Not JSON at all. */
  | 'not-json'
  /** JSON, but not a file this extension exported. */
  | 'not-config'
  /** Exported by a newer version, which may mean its fields differently. */
  | 'newer'
  /** More items than one import may add. */
  | 'too-many'
  /** Not a single item could be read: the import is refused as a whole. */
  | 'nothing';

export type ImportPreview =
  | { kind: 'problem'; problem: ImportProblem }
  | {
      kind: 'ready';
      models: ModelConfigDraft[];
      prompts: PromptConfigDraft[];
      /** Items that could not be read, and will not be imported. */
      skipped: number;
      /** At least one model carries a key or request headers. */
      withCredentials: boolean;
    };

/**
 * Reads an export file and says what importing it would do
 * (docs/development-plan.md §4.6): the items it would add, the ones it
 * would skip as unreadable. An item is read with the same rules as the
 * settings page's forms, so what it adds could have been typed in. When no
 * item at all can be read, the whole import is refused (§7).
 */
export function previewImport(text: string): ImportPreview {
  let file: unknown;
  try {
    file = JSON.parse(text);
  } catch {
    return { kind: 'problem', problem: 'not-json' };
  }
  if (!isRecord(file) || file['format'] !== CONFIG_FILE_FORMAT) {
    return { kind: 'problem', problem: 'not-config' };
  }
  const version = file['version'];
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return { kind: 'problem', problem: 'not-config' };
  }
  if (version > CONFIG_FILE_VERSION) return { kind: 'problem', problem: 'newer' };
  const modelRows = file['models'] ?? [];
  const promptRows = file['prompts'] ?? [];
  if (!Array.isArray(modelRows) || !Array.isArray(promptRows)) {
    return { kind: 'problem', problem: 'not-config' };
  }
  if (modelRows.length > MAX_IMPORTED_ITEMS || promptRows.length > MAX_IMPORTED_ITEMS) {
    return { kind: 'problem', problem: 'too-many' };
  }

  const models: ModelConfigDraft[] = [];
  const prompts: PromptConfigDraft[] = [];
  for (const row of modelRows) {
    const parsed = isRecord(row) ? ModelConfigDraft.safeParse(pick(row, MODEL_FIELDS)) : null;
    if (parsed?.success) models.push(parsed.data);
  }
  for (const row of promptRows) {
    const parsed = isRecord(row) ? PromptConfigDraft.safeParse(pick(row, PROMPT_FIELDS)) : null;
    if (parsed?.success) prompts.push(parsed.data);
  }
  if (models.length + prompts.length === 0) return { kind: 'problem', problem: 'nothing' };

  return {
    kind: 'ready',
    models,
    prompts,
    skipped: modelRows.length + promptRows.length - models.length - prompts.length,
    withCredentials: models.some(
      (model) => (model.apiKey ?? '') !== '' || Object.keys(model.headers ?? {}).length > 0,
    ),
  };
}

/** The named fields of `row` that are present: a missing one takes its default when parsed. */
function pick(row: Record<string, unknown>, fields: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(
    fields.filter((field) => Object.hasOwn(row, field)).map((field) => [field, row[field]]),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
