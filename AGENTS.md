# AGENTS

一瞥 YiPie：用用户自己配置的 OpenAI 兼容模型服务总结当前网页的 Chrome / Edge 扩展。

路线图、技术决定与验收标准的唯一权威来源是 `docs/development-plan.md`。本文件只写日常开发需要遵守的约定；两者冲突时以计划为准，并同步修正本文件。

## 调试约定

- **不要运行 `npm run dev`**：它是常驻进程。需要时请用户手动运行。
- 真实 API Key 的调用由用户手动验证。不要读取、保存或写入用户的密钥。

## 常用命令

| 命令                     | 作用                                                                          |
| ------------------------ | ----------------------------------------------------------------------------- |
| `npm run gate`           | compile + test + lint + format，每次提交前必须全绿                            |
| `npm run build`          | 生产构建到 `.output/chrome-mv3`（Chrome「加载已解压的扩展」用这个目录）       |
| `npm run build:e2e`      | E2E 构建到 `.output/chrome-mv3-e2e`：多了对 127.0.0.1 的主机权限与触发入口   |
| `npm run check:manifest` | 比对构建产物的 manifest 与计划附录 C（先 build）                              |
| `npm run check:bundle`   | 按入口检查计划 §9 的体积预算，写出 `.output/bundle-report.json`（先 build）   |
| `npm run test:e2e`       | Playwright 在真实 Chromium 里加载 E2E 构建（先 build:e2e）                   |
| `npm run format`         | 用 Prettier 改写格式（Markdown 不在格式检查范围内）                           |

CI（`.github/workflows/quality.yml`）在每次 push / PR 上依次跑：gate → build → 两项检查 → build:e2e → E2E。两项检查只针对生产构建，其中 check:manifest 会确认 E2E 专用的主机权限和触发入口没有混进来。

## 目录与分层

```
src/contract     schema、类型、存储信封版本、RPC 方法表（含允许的调用方）
src/domain       纯函数，不碰浏览器 API
src/platform     唯一调用浏览器 API 的层：storage、rpc、settings、logger
src/features     界面逻辑：React 组件、hooks、主题 token
src/entrypoints  薄壳：background、options、panel、injected（内容脚本）
tests/           Vitest 单测，路径与被测文件同构
e2e/             Playwright；fixtures.ts 负责加载扩展
scripts/         check-manifest.ts、check-bundle-budget.ts；判定逻辑在 scripts/lib，有单测
```

依赖只能从上往下：contract → domain → platform → features → entrypoints。反向依赖会被 ESLint 拦下。

## 硬约束（ESLint / CI 会拦）

- **分层**：`import-x/no-restricted-paths`。
- **单一写入口**：只有 `src/platform/storage/**` 能引用 `wxt-store.ts`。其它代码通过 repo（`createRepo(...).update`）写入，写入都在 SW 的唯一写队列里执行。扩展页面要改数据就发 RPC，不要自己写存储。
- **SW 不含界面**：background 入口不能引用 `features/**`；contract / domain / platform / background 不能在运行时引用 `react`、`react-dom`（`import type` 可以）。React 只出现在 features 和扩展页面入口里。
- **内容脚本只带外壳、提取与定位**：`src/entrypoints/injected.ts`、`platform/panel-host/**`、`platform/extract/**`、`platform/rpc/lite-client.ts` 不能在运行时引用 React、zod、`platform/storage`、`platform/llm`、`platform/settings`、`features`，也不能在运行时引用 contract 下定义 schema 的文件（一个常量就会把 zod 带进来）；只有 `@/contract/rpc-wire`、`@/contract/commands` 这两个纯常量文件例外，其余只能 `import type`。
- **内容脚本按需注入，不进 manifest**：入口文件叫 `injected.ts` 而不是 `content.ts`（WXT 会把 `content.ts` 当成 manifest 声明的内容脚本），由 `platform/inject/inject.ts` 在用户触发、隔离闸门通过之后 `executeScript`。
- **不用 `eslint-disable`、不用 `any`**：`noInlineConfig` 让 `eslint-disable` 注释无效并报告，`--max-warnings 0` 让它失败。
- **manifest 与计划附录 C 一致**：新增权限或 manifest 键，先改附录 C，再在同一提交里改 `scripts/lib/manifest-policy.ts`。
- **体积预算**（计划 §9）：超出时先找原因，不要直接调高预算；确需调高，在计划附录 F 写明理由。

## 存储约定

- 每个 key 存 `{ version, data }`。键常量写在 `src/contract/**`，带 `local:` / `session:` 前缀。
- 读取是三态：ok / missing / invalid。不要把 invalid 当成 missing 处理。
- 覆盖无法识别的值之前，repo 会先把原值备份到 `<area>:quarantine:<key>`（每个 key 保留最近 3 份）。
- 存储里的版本比代码新：只读，repo 拒绝写入。
- **加字段**：给默认值，不升版本（schema 用 `z.looseObject`，未知字段原样保留）。**改名、删字段、改语义**：升版本，在 `RecordDefinition.upgrade` 里写纯函数升级，并补幂等测试。
- patch schema 逐字段 `.optional()`，不要从存储 schema `.partial()` 派生：那样会带上默认值，保存一个字段就会静默重置其它字段。

## RPC 约定

- `src/contract/rpc.ts` 的方法表是唯一权威：每个方法声明 input / output schema 和允许的调用方（options / panel / content）。
- 调用方由浏览器提供的 sender 判定（`src/platform/rpc/caller-policy.ts`），不看消息内容。
- **凭据隔离 fail closed**：浏览器确认 `storage.local` 只对扩展页面开放之前，dispatcher 不运行任何 handler；确认失败时一律返回 `storage-not-isolated`，下一次请求再重试。闸门是 `ensureLocalStorageIsolated()`（`src/platform/storage/access-level.ts`），只记住成功。之后任何会产生内容脚本的代码（阶段 1 的注入）也必须先 `await` 它，失败就不注入。
- 新增方法的顺序：方法表登记 → background 的 handlers 里实现（类型会强制补齐）→ 给 dispatcher 写测试，尤其是应被拒绝的调用方。
- 扩展页面用 `callRpc`，它会校验返回值。内容脚本用的轻量客户端在阶段 1 加入，不引入 zod；届时通道名和请求 / 回复的形状移到不依赖 zod 的 `contract/rpc-wire.ts`（从 `rpc.ts` 取常量会把全部 schema 带进内容脚本）。

## 测试约定

- 单测在 node 环境跑，不加载浏览器 API；存储用 `tests/helpers/memory-store.ts`，它每次操作都让出事件循环，能复现并发交错。
- 新增行为必须有测试。测自己的语义，不重复测 zod、React 这些第三方库本身。
- E2E 要断言存储里的数据或刷新后的状态，不能只看界面。
- E2E 跑的是 E2E 构建；打开面板用 `openPanel` fixture（等同点工具栏图标），本地页面与假服务由 `e2e/fake-llm/` 提供。面板的宿主是 closed shadow root，Playwright 的定位器进不去：面板内容通过 `panelFrame` 拿到 iframe 再找，宿主外壳的按钮按坐标点。
- E2E 里通过 `serviceWorker` fixture 拿 SW，不要自己取 `context.serviceWorkers()`：Playwright 可能在浏览器装好扩展 API 之前就报告这个 worker（此时 `chrome` 里只有 `csi`、`loadTimes`，约 1/20 的概率），fixture 会等到 `chrome.storage.local` 可用再交给测试。

## 依赖版本约束

| 依赖               | 版本            | 原因                                                                                    |
| ------------------ | --------------- | --------------------------------------------------------------------------------------- |
| TypeScript         | 6.0.x           | typescript-eslint 要求 < 6.1；TS 7 暂时用不了类型感知 lint（计划风险 1）                |
| ESLint             | 9.x             | eslint-plugin-jsx-a11y 还不支持 ESLint 10（计划风险 2）。npm 提示 9.x 不再维护，是已知取舍 |
| @playwright/test   | 1.56.1（固定）  | 对应 Chromium 1194，与云端开发环境预装的浏览器一致；升级时要同时确认本地与 CI 的浏览器  |
| Node               | ≥ 22.18         | `scripts/*.ts` 依靠 Node 内置的类型剥离直接运行                                         |

## 开发环境备注

- 云端开发环境预装了 Chromium 1194，Playwright 能直接找到。不要运行 `playwright install`；CI 会自己安装。
- 在无 root 的沙箱里跑 E2E 的经验（自计划附录 G 迁入）：
  1. 容器的 `no new privileges` 让 Chromium 自带沙箱不可用，需要 `--no-sandbox`。Playwright 默认 `chromiumSandbox: false`，已经会带上。
  2. 缺 X11 / NSS 等约 16 个动态库时：把 deb 依赖解到可写前缀（例如 `/tmp/sysroot`），运行时用 `LD_LIBRARY_PATH` 指过去。
  3. 必须装字体并自建 fontconfig 配置，否则 Skia 直接 FATAL（`SkFontMgr_FontConfigInterface.cpp:163 Not implemented`），浏览器一开就崩。这一条最容易误判成「库没装齐」。
- 沙箱恢复后 `node_modules` 等会被清空：`npm ci` → `npm run gate` → `npm run build`。

## 提交与分支

- 提交信息：`type(scope): 说明`，type ∈ `feat / fix / refactor / test / docs / chore / perf / ci`；正文写「为什么」，中文可。
- `main` 为主；开发在 `feat/<主题>` 分支。
- 用户可见的行为变化，同步 `CHANGELOG.md` 的 `[Unreleased]` 与 `README.md` 的「当前状态」；架构约束变化，同步本文件。

## 发版

阶段 6 落地，固定步骤见计划 §4.7。
