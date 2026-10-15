import { describe, expect, it } from 'vitest';
import { CONFIG_FILE_VERSION, ConfigImport } from '@/contract/config-transfer';
import { ModelConfig } from '@/contract/model-config';
import { PromptConfig } from '@/contract/prompt-config';
import { buildConfigFile, previewImport } from '@/domain/config-transfer';

const at = new Date('2026-10-15T08:00:00.000Z');

const gateway = ModelConfig.parse({
  id: 'a',
  name: '网关',
  baseURL: 'https://gw.example/v1?key=query-secret',
  apiKey: 'sk-secret',
  model: 'gpt-4o-mini',
  headers: { 'X-Team': 'header-secret' },
  extraBody: { temperature: 0.2 },
  contextWindow: 128_000,
  streamUsage: false,
  addedLater: 'a field of a newer version',
});
const ollama = ModelConfig.parse({
  id: 'b',
  baseURL: 'http://localhost:11434/v1',
  model: 'qwen2.5:7b',
});
const terse = PromptConfig.parse({ id: 'p', name: '一句话', user: '一句话总结：{{content}}' });

const exported = (withCredentials: boolean) =>
  JSON.stringify(buildConfigFile([gateway, ollama], [terse], { withCredentials, at }));

/** What the list holds after an import: everything but the id. */
const withoutId = ({ id: _id, ...rest }: { id: string }) => rest;

describe('export', () => {
  it('leaves credentials out unless asked, and never writes ids or unknown fields', () => {
    const text = exported(false);

    expect(text).not.toContain('secret');
    expect(text).not.toContain('"id"');
    expect(text).not.toContain('addedLater');
    expect(JSON.parse(text)).toMatchObject({
      format: 'yipie-config',
      version: CONFIG_FILE_VERSION,
      exportedAt: '2026-10-15T08:00:00.000Z',
    });
  });

  it('keeps them when asked', () => {
    const text = exported(true);

    expect(text).toContain('sk-secret');
    expect(text).toContain('header-secret');
    expect(text).toContain('query-secret');
  });
});

describe('export, then import', () => {
  it('gives back the same items, credentials included when they were exported', () => {
    const preview = previewImport(exported(true));

    expect(preview).toMatchObject({ kind: 'ready', skipped: 0, withCredentials: true });
    if (preview.kind !== 'ready') return;
    // What the background would store: the same rows, under new ids.
    const imported = ConfigImport.parse({ models: preview.models, prompts: preview.prompts });
    const known: Record<string, unknown> = withoutId(gateway);
    delete known['addedLater'];
    expect(imported.models).toEqual([known, withoutId(ollama)]);
    expect(imported.prompts).toEqual([withoutId(terse)]);
  });

  it('gives back the same items without credentials when they were left out', () => {
    const preview = previewImport(exported(false));

    expect(preview).toMatchObject({ kind: 'ready', skipped: 0, withCredentials: false });
    if (preview.kind !== 'ready') return;
    const imported = ConfigImport.parse({ models: preview.models, prompts: preview.prompts });
    expect(imported.models[0]).toMatchObject({
      name: '网关',
      baseURL: 'https://gw.example/v1',
      apiKey: '',
      headers: {},
      extraBody: { temperature: 0.2 },
      contextWindow: 128_000,
      streamUsage: false,
    });
  });
});

describe('import preview', () => {
  const file = (fields: Record<string, unknown>) =>
    JSON.stringify({ format: 'yipie-config', version: 1, ...fields });

  it('skips the items it cannot read, and counts them', () => {
    const preview = previewImport(
      file({
        models: [
          { baseURL: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
          { baseURL: 'not a url', model: 'm' },
          { baseURL: 'https://gw.example/v1', model: 'm', extraBody: { messages: [] } },
          { baseURL: 'https://gw.example/v1', model: 'm', headers: { Cookie: 'c' } },
          'a string',
        ],
        prompts: [
          { name: '要点', user: '{{content}}' },
          { name: '', user: '{{content}}' },
        ],
      }),
    );

    expect(preview).toMatchObject({ kind: 'ready', skipped: 5, withCredentials: false });
    if (preview.kind !== 'ready') return;
    expect(preview.models.map((model) => model.model)).toEqual(['deepseek-chat']);
    expect(preview.prompts.map((prompt) => prompt.name)).toEqual(['要点']);
  });

  it('ignores an id and fields it does not know', () => {
    const preview = previewImport(
      file({ prompts: [{ id: 'taken', name: '要点', user: '{{content}}', color: 'red' }] }),
    );

    expect(preview).toMatchObject({
      kind: 'ready',
      prompts: [{ name: '要点', system: '', user: '{{content}}' }],
    });
  });

  it.each([
    ['not-json', '{ not json'],
    ['not-config', JSON.stringify({ models: [] })],
    ['not-config', JSON.stringify([1, 2])],
    ['not-config', file({ version: 'one' })],
    ['not-config', file({ models: {} })],
    ['newer', file({ version: CONFIG_FILE_VERSION + 1, models: [] })],
    ['too-many', file({ prompts: Array.from({ length: 201 }, () => ({})) })],
    ['nothing', file({ models: [{ model: 'no base URL' }], prompts: [] })],
    ['nothing', file({})],
  ])('refuses the whole file: %s', (problem, text) => {
    expect(previewImport(text)).toEqual({ kind: 'problem', problem });
  });
});
