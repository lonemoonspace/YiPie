import { describe, expect, it } from 'vitest';
import { GENERAL_SETTINGS_KEY } from '@/contract/general-settings';
import { MODEL_CONFIGS_KEY } from '@/contract/model-config';
import { createBackupsService } from '@/platform/settings/backups-service';
import { NotFoundError } from '@/platform/settings/errors';
import { createQueue } from '@/platform/storage';
import { createMemoryStore } from '../../helpers/memory-store';

const entry = (key: string, at: string, raw: unknown) => ({ key, at, raw });

function setup() {
  const store = createMemoryStore({
    'local:quarantine:general-settings': [
      entry(GENERAL_SETTINGS_KEY, '2026-01-01T00:00:00.000Z', 1),
    ],
    'local:quarantine:model-configs': [
      entry(MODEL_CONFIGS_KEY, '2026-01-02T00:00:00.000Z', { apiKey: 'sk-x' }),
      entry(MODEL_CONFIGS_KEY, '2026-01-03T00:00:00.000Z', 'second'),
    ],
    'local:quarantine:something-else': [entry('local:something-else', '2026-01-04', 'ignored')],
  });
  return { store, backups: createBackupsService(store, createQueue()) };
}

describe('backups service', () => {
  it('lists the backups of every backed-up key, with their position and time', async () => {
    const { backups } = setup();

    expect(await backups.list()).toEqual({
      backups: [
        { key: GENERAL_SETTINGS_KEY, index: 0, at: '2026-01-01T00:00:00.000Z', raw: 1 },
        {
          key: MODEL_CONFIGS_KEY,
          index: 0,
          at: '2026-01-02T00:00:00.000Z',
          raw: { apiKey: 'sk-x' },
        },
        { key: MODEL_CONFIGS_KEY, index: 1, at: '2026-01-03T00:00:00.000Z', raw: 'second' },
      ],
    });
  });

  it('deletes the backup named, and refuses one that is no longer there', async () => {
    const { backups } = setup();

    const after = await backups.remove({
      key: MODEL_CONFIGS_KEY,
      index: 0,
      at: '2026-01-02T00:00:00.000Z',
    });
    expect(after.backups.map((backup) => backup.raw)).toEqual([1, 'second']);

    await expect(
      backups.remove({ key: MODEL_CONFIGS_KEY, index: 0, at: '2026-01-02T00:00:00.000Z' }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
