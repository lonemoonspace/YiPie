/**
 * What the built manifest may contain, mirroring appendix C of
 * docs/development-plan.md. Each phase that introduces a manifest entry
 * updates appendix C and this policy in the same commit.
 */
export interface ManifestPolicy {
  /** `permissions`, exactly: nothing missing, nothing extra. */
  permissions: string[];
  /** `optional_host_permissions`, exactly. */
  optionalHostPermissions: string[];
  /** Top-level keys that must not appear yet. */
  absent: string[];
}

export const MANIFEST_POLICY: ManifestPolicy = {
  permissions: ['storage'],
  // Requested per origin at runtime, only for the model services the user configures.
  optionalHostPermissions: ['https://*/*', 'http://*/*'],
  absent: [
    'host_permissions',
    'optional_permissions',
    'content_scripts',
    'web_accessible_resources',
    'externally_connectable',
    'action',
    'commands',
    'side_panel',
    'declarative_net_request',
  ],
};

/** Returns one message per violation; an empty list means the manifest is fine. */
export function checkManifest(
  manifest: Record<string, unknown>,
  policy: ManifestPolicy = MANIFEST_POLICY,
): string[] {
  const problems: string[] = [];

  if (manifest.manifest_version !== 3) {
    problems.push(`manifest_version 应为 3，实际为 ${String(manifest.manifest_version)}`);
  }

  compareList(problems, 'permissions', manifest.permissions, policy.permissions);
  compareList(
    problems,
    'optional_host_permissions',
    manifest.optional_host_permissions,
    policy.optionalHostPermissions,
  );

  for (const key of policy.absent) {
    if (key in manifest) problems.push(`manifest 里不应出现 "${key}"（见附录 C）`);
  }

  return problems;
}

/** The list must hold exactly `expected`, in any order. */
function compareList(problems: string[], key: string, actual: unknown, expected: string[]): void {
  const present = Array.isArray(actual) ? actual.map(String) : [];
  const extra = present.filter((item) => !expected.includes(item));
  const missing = expected.filter((item) => !present.includes(item));
  if (extra.length > 0) problems.push(`多出的 ${key}：${extra.join(', ')}（先在附录 C 写明理由）`);
  if (missing.length > 0) problems.push(`缺少的 ${key}：${missing.join(', ')}`);
}
