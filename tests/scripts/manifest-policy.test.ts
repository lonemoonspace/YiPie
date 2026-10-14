import { describe, expect, it } from 'vitest';
import { checkManifest } from '../../scripts/lib/manifest-policy';

const valid = {
  manifest_version: 3,
  name: 'YiPie',
  version: '0.0.0',
  permissions: ['storage'],
  background: { service_worker: 'background.js' },
};

describe('checkManifest', () => {
  it('accepts a manifest that matches the policy', () => {
    expect(checkManifest(valid)).toEqual([]);
  });

  it('catches an extra permission', () => {
    const problems = checkManifest({ ...valid, permissions: ['storage', 'tabs'] });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('tabs');
  });

  it('catches a missing permission', () => {
    expect(checkManifest({ ...valid, permissions: [] })[0]).toContain('storage');
  });

  it('catches a key that is not allowed yet', () => {
    const problems = checkManifest({ ...valid, host_permissions: ['<all_urls>'] });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('host_permissions');
  });

  it('catches a manifest that is not MV3', () => {
    expect(checkManifest({ ...valid, manifest_version: 2 })).toHaveLength(1);
  });
});
