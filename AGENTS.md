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
src/platform     唯一调用浏览器 API 的层：storage、rpc、settings、llm、inject、panel-host、extract 等
src/features     界面逻辑：React 组件、hooks、Markdown 渲染、主题 token
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
- 存储里的版本比代码新：只读，repo 拒绝写入。列表只读时，它的默认项也不能改（`setDefault` 同样拒绝）。
- **加字段**：给默认值，不升版本（schema 用 `z.looseObject`，未知字段原样保留）。**改名、删字段、改语义**：升版本，在 `RecordDefinition.upgrade` 里写纯函数升级，并补幂等测试。
- patch schema 逐字段 `.optional()`，不要从存储 schema `.partial()` 派生：那样会带上默认值，保存一个字段就会静默重置其它字段。编辑表单只发送改过的字段（`domain/patch.ts` 的 `changedFields`），别的标签页同时改的字段不会被改回去。
- **列表记录**用 `createListRepo`（`platform/storage/list-repo.ts`）：一行通不过 schema、或者 id 与前面的行重复，就放进 `unrecognized`，不参与业务、界面不显示，写回时原样放在已识别的行之后。只有整个值不是数组才算 invalid。
- **几条记录一起变**（列表与默认项）时，在一个 `queue(...)` 任务里依次调用各自的 `updateUnqueued`。在队列任务之外调用它，写入会交错、丢更新。
- **删除整条记录**用 repo 的 `removeUnqueued`，只给扩展按设计管理寿命的记录（对话快照：被驱逐、随标签页关闭而删除）；用户自己的数据只由用户的显式操作删除。
- **对话快照**（`platform/snapshot/store.ts`，`storage.session`）：每段对话一个键 `session:snapshot:<id>`，另有索引 `session:snapshots`：条目记下这一页的对话在哪个键、最后存下的那次保存来自哪个面板文档、序号多少，另有待删的键（`garbage`）。保存不碰它要替换的东西：先把新 id 记进待删、再写新键，然后一次索引写入把条目指向新键、把旧键和被驱逐的键记为待删，最后才删除。id 不复用。这样任何一步失败或 SW 停下，读到的都是保存前或保存后的完整状态，存储里的每个键都在索引里，下一次保存先清掉待删的键。改这里的写入顺序时，`store.test.ts` 里逐个写入点失败 / 停下的测试必须仍然通过。快照只放回答与追问，不放正文、Prompt 和任何凭据。`storage.session` 随扩展更新清空，这里的格式变了不需要升级函数。
- **默认项**（`local:selection`）里的 id 找不到时，以列表首项为默认。只在一次变更会让默认项变化时才写它，规则是 `domain/list-mutations.ts` 的 `defaultAfterChange`；设置页删除前的确认也用它预告默认项的去向。
- 扩展页面想知道存储变了，用 `platform/storage/watch.ts` 的 `onStoredChange` 当信号，值仍经 RPC 读：存储只由后台解读。

## RPC 约定

- `src/contract/rpc.ts` 的方法表是唯一权威：每个方法声明 input / output schema 和允许的调用方（options / panel / content）。
- 调用方由浏览器提供的 sender 判定（`src/platform/rpc/caller-policy.ts`），不看消息内容。
- **凭据隔离 fail closed**：浏览器确认 `storage.local` 只对扩展页面开放之前，dispatcher 不运行任何 handler；确认失败时一律返回 `storage-not-isolated`，下一次请求再重试。闸门是 `ensureLocalStorageIsolated()`（`src/platform/storage/access-level.ts`），只记住成功。注入内容脚本（`src/platform/inject/inject.ts`）也先 `await` 它，失败就不注入，只在图标上提示。
- **面板必须先接上**：调用方是面板时，除方法表里标了 `beforeAttach` 的 `panel.attach`，dispatcher 还要求发送方就是本 tab 登记表里已接上的文档（`sender.tab.id` + `sender.documentId`），否则返回 `forbidden`。`panel.html` 是 web 可访问资源，任何得知其 URL 的页面都能加载它，所以「是面板页」本身证明不了什么。新增的面板方法自动受这条约束，不要给它加 `beforeAttach`。
- 新增方法的顺序：方法表登记 → background 的 handlers 里实现（类型会强制补齐）→ 给 dispatcher 写测试，尤其是应被拒绝的调用方。
- 列表只暴露变更面（add / update / remove / move / setDefault），没有「把整个数组存回去」。返回的视图（`contract/rpc.ts` 的 `listView`）带着全部判断：默认项、认不出的行数、读取状态、这次是否回退了默认项。界面只渲染，判断放在 domain。
- 面板只拿它要用的东西：读模型用 `models.current`，只有菜单（名称）和正在用的那个模型的配置；`models.list` 带着全部 Key，只给设置页。给面板新增方法时同样收窄输出：不要直接复用存储 schema（`z.looseObject` 会让未知字段穿透），逐字段映射到专门的 `z.object`（如 `PanelModelConfig`），它会丢掉 handler 多塞的字段。
- 面板唯一能调用的配置变更是 `models.choose`（计划 §8 的例外）；Prompt 的一切变更、备份的读取与删除只接受设置页。面板读通用设置用 `settings.current`（只有裁剪策略），`settings.get` 只给设置页。
- 面板的对话快照经 `snapshot.get` / `snapshot.save`，参数里没有标签页和页面：后台按发送方的标签页、登记表里挂载时的页面键取（页面键在 `content.hello` 时由浏览器报告的标签页 URL `sender.tab.url` 算出，`domain/page-key.ts`；`sender.url` 是文档载入时的 URL，不随 `pushState` 变化，不能用来认页面）。不要给它们加页面参数。页面没有重新载入就换成了另一页（SPA），内容脚本关闭面板（`panel-host/host.ts`，Navigation API 的 `currententrychange`），挂载时也核对 `content.hello` 返回的页面键。
- 结果取决于到达顺序的 RPC 在面板里经 `features/panel/latest-only.ts` 发送（目前是换默认模型）：一次一个，只认最新的。后台先检查发送方再入队，两个同时发出的请求可能以任意顺序进写队列。
- 保存对话（`snapshot.save`）不排队，而是带着本面板的序号 `revision` 立即发出：后台按发送方的面板文档与序号只留最新的一次，晚到的旧保存返回 `stored: false`。面板上已完成的对话一变（回答完成、重新总结清空、重做去掉最后一轮）就保存，不等下一个回答。
- 扩展页面用 `callRpc`，它会校验返回值。内容脚本用 `callRpcLite`（`src/platform/rpc/lite-client.ts`），不引入 zod；通道名和请求 / 回复的形状在不依赖 zod 的 `contract/rpc-wire.ts` 里（从 `rpc.ts` 取常量会把全部 schema 带进内容脚本）。

## 凭据与日志

- 展示给用户的错误详情一律经 `redact(detail, requestSecrets(config))`（`src/domain/llm/`）：Key、每个请求头的值、base URL 的查询参数都算凭据，不论长短。
- 日志里不写凭据，也不写完整 URL：base URL 的查询参数可能带 key，页面 URL 可能带 token。只记 origin（或权限模式）。
- 离开扩展的数据（目前是备份导出）默认经 `withoutCredentials`（`src/domain/credentials.ts`）剔除 `apiKey`、`headers` 与 `baseURL` 的查询参数，用户勾选后才包含；设置页显示原始数据时一律经过它。
- 主机访问权：申请必须在设置页的点击 / 提交回调里、任何 `await` 之前调用 `requestOriginAccess`（浏览器只在用户手势里弹出提示）。回收由 SW 的模型列表服务在变更写入后、同一个队列槽内完成，只回收不再被任何行（含认不出的行）使用的 origin。

## 测试约定

- 单测在 node 环境跑，不加载浏览器 API；存储用 `tests/helpers/memory-store.ts`，它每次操作都让出事件循环，能复现并发交错。
- 新增行为必须有测试。测自己的语义，不重复测 zod、React 这些第三方库本身。
- E2E 要断言存储里的数据或刷新后的状态，不能只看界面。
- E2E 跑的是 E2E 构建；打开面板用 `openPanel` fixture（等同点工具栏图标），本地页面与假服务由 `e2e/fake-llm/` 提供。面板的宿主是 closed shadow root，Playwright 的定位器进不去：面板内容通过 `panelFrame` 拿到 iframe 再找，宿主外壳的按钮按坐标点。
- E2E 里预置数据用 `e2e/fixtures.ts` 的 `storeModels`（可带 `contextWindow`）/ `storePrompts` / `storeDefaults` / `storeSettings`，读回存储用 `stored`（`storage.local`）与 `session`（`storage.session`：面板登记与快照）。删除前的确认框用 `page.once('dialog', …)` 接受或拒绝。
- Playwright 的视口模拟下，离视口底部约 100 px 以内对跨站 iframe 的鼠标点击会丢（普通跨站 iframe 也一样，与面板无关）。面板底部的追问框用键盘操作（`fill` 后 `press('Enter')`）；非点不可时先把视口调高。
- 面板的对话逻辑在 `features/panel/conversation.ts`（不依赖 React，单测用假的 RPC 与流）；`use-panel.ts` 只负责接线。控制器里每个 `await` 之后的继续都要确认自己仍属于最新的那次操作（`action`），面板离开（`dispose`）后的结果不再派发；新增等待步骤照此办理，并补「中途用户做了别的 / 已经 dispose」的测试。假服务的场景：`scenario:chat`（追问的回答写出问题）、`scenario:no-usage`、`scenario:context-limit`（超过约 2,000 字就以超长拒绝），长文页面是 `/long.html`。
- E2E 里通过 `serviceWorker` fixture 拿 SW，不要自己取 `context.serviceWorkers()`：Playwright 可能在浏览器装好扩展 API 之前就报告这个 worker（此时 `chrome` 里只有 `csi`、`loadTimes`，约 1/20 的概率），fixture 会等到 `chrome.storage.local` 可用再交给测试。
- 模型输出只经 `src/features/markdown/render.ts` 变成 HTML，`dangerouslySetInnerHTML` 只用于它的结果。计划 §8 列出的注入回归用例在 `tests/features/markdown/render.test.ts` 里，改渲染器时它们必须仍然通过；要放行新的语法或属性，先补用例并更新测试里的白名单。

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
