/**
 * Chinese messages the content script uses: all it carries, since it runs in
 * every page the user summarizes (docs/development-plan.md §9). Extension
 * pages carry them too.
 */
export const content = {
  'app.name': '一瞥',
  'panel.close': '关闭',
  'panel.attachFailed': '面板无法连接到这个标签页，请重新点击工具栏图标。',
} as const satisfies Record<string, string>;
