/**
 * Chinese messages the service worker uses: all it carries, so its bundle
 * stays small (docs/development-plan.md §9). Extension pages carry them too.
 */
export const background = {
  'prompt.builtinName': '网页总结',
  'host.unavailable': '此页面无法总结',
  'menu.summarizePage': '用一瞥总结此页',
} as const satisfies Record<string, string>;
