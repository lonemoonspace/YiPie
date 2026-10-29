/**
 * Chinese messages the service worker uses: all it carries, so its bundle
 * stays small (docs/development-plan.md §9). Extension pages carry them too.
 */
export const background = {
  'host.unavailable': '此页面无法总结',
  // The icon's own title again, in the interface language (_locales has it in the browser's).
  'host.available': '一瞥：总结此页',
  'menu.summarizePage': '用一瞥总结此页',
  'menu.summarizeSelection': '用一瞥总结选中内容',
} as const satisfies Record<string, string>;
