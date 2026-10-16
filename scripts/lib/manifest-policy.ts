import { isDeepStrictEqual } from 'node:util';

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
  /** Keys whose value must equal this exactly. */
  exact: Record<string, unknown>;
  /** Keys that must be present (an object), and keys that must not appear inside them. */
  present: Record<string, { forbidden: string[] }>;
  /** Top-level keys that must not appear. */
  absent: string[];
}

export const MANIFEST_POLICY: ManifestPolicy = {
  permissions: ['storage', 'activeTab', 'scripting', 'contextMenus'],
  // Requested per origin at runtime, only for the model services the user configures.
  optionalHostPermissions: ['https://*/*', 'http://*/*'],
  exact: {
    // The browser's own words (name, description, icon title, shortcut) come
    // from _locales, Chinese unless the browser speaks a language there is a
    // table for.
    default_locale: 'zh_CN',
    web_accessible_resources: [
      { resources: ['panel.html'], matches: ['http://*/*', 'https://*/*'], use_dynamic_url: true },
    ],
    content_security_policy: {
      extension_pages:
        "script-src 'self'; object-src 'none'; img-src 'self' data:; frame-src 'none'; form-action 'none'; base-uri 'none'",
    },
  },
  present: {
    // A popup would swallow the click that opens the panel.
    action: { forbidden: ['default_popup'] },
    commands: { forbidden: [] },
  },
  absent: [
    // Also what keeps the E2E build's test-only host access out of production.
    'host_permissions',
    'optional_permissions',
    'content_scripts',
    'externally_connectable',
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

  for (const [key, expected] of Object.entries(policy.exact)) {
    if (!isDeepStrictEqual(manifest[key], expected)) {
      problems.push(`"${key}" 与附录 C 不一致：${JSON.stringify(manifest[key])}`);
    }
  }

  for (const [key, { forbidden }] of Object.entries(policy.present)) {
    const value = manifest[key];
    if (typeof value !== 'object' || value === null) {
      problems.push(`manifest 里缺少 "${key}"（见附录 C）`);
      continue;
    }
    for (const inner of forbidden) {
      if (inner in value) problems.push(`"${key}" 里不应出现 "${inner}"（见附录 C）`);
    }
  }

  for (const key of policy.absent) {
    if (key in manifest) problems.push(`manifest 里不应出现 "${key}"（见附录 C）`);
  }

  return problems;
}

/** `_locales/<locale>/messages.json`, by locale. */
export type LocaleMessages = Record<string, Record<string, unknown>>;

/**
 * Every `__MSG_name__` in the manifest must be defined for every locale, and
 * every locale must define the same names: the browser shows the raw
 * placeholder, or falls back silently, otherwise.
 */
export function checkLocales(manifest: Record<string, unknown>, locales: LocaleMessages): string[] {
  const problems: string[] = [];
  const defaultLocale = manifest.default_locale;
  if (typeof defaultLocale !== 'string' || !(defaultLocale in locales)) {
    problems.push(`缺少默认语言 ${String(defaultLocale)} 的 _locales/*/messages.json`);
  }
  const used = [...JSON.stringify(manifest).matchAll(/__MSG_(\w+)__/g)].map(
    (match) => match[1] ?? '',
  );
  const names = Object.keys(locales[String(defaultLocale)] ?? {}).sort();
  for (const [locale, messages] of Object.entries(locales)) {
    for (const name of used) {
      const entry = messages[name];
      const text =
        typeof entry === 'object' && entry !== null
          ? (entry as { message?: unknown }).message
          : null;
      if (typeof text !== 'string' || text.trim() === '') {
        problems.push(`_locales/${locale} 缺少 manifest 用到的 ${name}`);
      }
    }
    const own = Object.keys(messages).sort();
    if (own.join() !== names.join()) {
      problems.push(`_locales/${locale} 的条目与默认语言不一致：${own.join(', ')}`);
    }
  }
  return problems;
}

/** Marks the trigger the E2E build exposes; it must never reach a production build. */
export const E2E_HOOK_MARKER = '__yipieE2E';

/** Paths of built scripts that still contain the E2E hook. */
export function findTestHooks(files: { path: string; text: string }[]): string[] {
  return files.filter((file) => file.text.includes(E2E_HOOK_MARKER)).map((file) => file.path);
}

/** The list must hold exactly `expected`, in any order. */
function compareList(problems: string[], key: string, actual: unknown, expected: string[]): void {
  const present = Array.isArray(actual) ? actual.map(String) : [];
  const extra = present.filter((item) => !expected.includes(item));
  const missing = expected.filter((item) => !present.includes(item));
  if (extra.length > 0) problems.push(`多出的 ${key}：${extra.join(', ')}（先在附录 C 写明理由）`);
  if (missing.length > 0) problems.push(`缺少的 ${key}：${missing.join(', ')}`);
}
