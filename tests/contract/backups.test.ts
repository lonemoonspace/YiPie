import { describe, expect, it } from 'vitest';
import { BACKED_UP_KEYS, BackedUpKey } from '@/contract/backups';

describe('BackedUpKey', () => {
  it("names only the user's records", () => {
    expect(BACKED_UP_KEYS).toEqual([
      'local:model-configs',
      'local:prompt-configs',
      'local:selection',
      'local:general-settings',
    ]);
  });

  it.each(['session:panel-registry', 'local:quarantine:model-configs', 'local:anything', ''])(
    'refuses %s',
    (key) => {
      expect(BackedUpKey.safeParse(key).success).toBe(false);
    },
  );
});
