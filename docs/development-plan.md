# 一瞥 YiPie · 开发计划

> **版本**：v4.4（2026-10-15），历次改动见附录 F
> **状态**：阶段 0、1、2 已完成。阶段 3（对话与恢复）自动化验收全部通过（§4.4），待你跑附录 H 中阶段 1、3 的手工冒烟（含阶段 1 留下的 Edge 与当前 Chrome 稳定版复核）。之后是阶段 4
> **权威性**：本文档是路线图的唯一权威来源。`README.md` 的路线图表格、`CHANGELOG.md` 的条目都是摘要，与本文冲突时以本文为准。
> **维护规则**：调整阶段划分、交付物、验收标准、§1.3 的技术决定或 §11 的已决事项，必须在本文内改，并在附录 F 记一行；不要只改 README。

## 1. 产品定义

把当前网页交给**你自己配置的 OpenAI 兼容模型服务**，在页面上的浮动面板里拿回一份可以直接读的总结，并能就这一页继续追问。

| 项目     | 决定                                                                                                                                                                                         |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 形态     | Chrome / Edge（Manifest V3）浏览器扩展；界面是嵌在页面里的浮动面板（扩展 iframe）                                                                                                            |
| 模型接口 | 只支持 OpenAI Chat Completions 兼容接口：`POST {baseURL}/chat/completions` + SSE 流式。OpenAI、DeepSeek、OpenRouter、Ollama、vLLM 等一律以「base URL + Key + 模型名」接入，不为任何一家写专用分支 |
| 数据流向 | 浏览器 →（用户自己的）模型服务。没有中间服务器                                                                                                                                               |
| 凭据     | API Key 只存在 `browser.storage.local`，且该存储区只对扩展自己的页面开放（内容脚本读不到）；不入日志、不入快照、导出时默认剔除                                                                |
| 界面语言 | 中文与英文，设置里可切换                                                                                                                                                                     |
| 分发     | 只发 GitHub Release 附件（zip），不上架应用商店                                                                                                                                              |
| 许可证   | MIT，公开仓库                                                                                                                                                                                |
| 遥测     | 无。不埋点、不上报崩溃；错误只在面板与设置页可见                                                                                                                                             |
| 成本     | 零服务端成本；token 由用户自付                                                                                                                                                               |

### 1.1 可验证的目标（不是口号）

1. **安装时零站点权限**：manifest 里没有 `host_permissions`，也没有静态 `content_scripts`；`web_accessible_resources` 只有面板页面；`permissions` 与附录 C 的清单逐项一致，由 CI 比对构建产物。模型服务的访问权在用户保存配置时按 origin 运行时申请。
2. **service worker 保持小**：`background.js` < 150 kB（阶段 0 实测 100.88 kB，其中 zod 占 84.66 kB，见 §9）。SW 里既没有 UI，也没有模型请求代码（D4），这条才能长期成立。
3. **用户数据不会被静默改写或删除**：每个持久化值都有 schema 与版本信封；坏数据先隔离备份、再让用户看见；删除只来自用户的显式操作。
4. **端到端可测，且不依赖真实 Key**：阶段 1 起，E2E 在真实 Chromium 里跑通「打开页面 → 触发 → 流式输出 → 停止 / 完成」；阶段 3 起再覆盖「刷新后再次触发 → 恢复上次对话」。模型一侧由本地假服务提供（§6）。Playwright 点不了工具栏图标和右键菜单，这几条触发路径由手工冒烟清单覆盖（附录 H）。
5. **用量如实**：服务返回 `usage` 时显示真实值；拿不到时显示带「≈」的本地估算，绝不把估算当成真实值。

### 1.2 非目标

- 账号体系、云同步、团队协作、分享链接
- 服务端代理（不代付 token、不隐藏来源 IP）
- OpenAI 兼容以外的接口（Anthropic Messages、Gemini 原生、OpenAI Responses 等）。需要时由用户自己的兼容网关转换
- 工具调用 / function calling / 让模型联网：页面内容会影响模型输出，给模型任何工具，都等于让被总结的页面驱动外发请求
- 精确分词。将来若确有需要，在面板页面里按需加载词表，绝不放进 SW
- popup、浏览器侧边栏、多开面板：界面只有页面内的浮动面板（D4）
- 常驻或全站的站点权限，以及依赖它们的「换页自动总结」「新页面自动打开面板」（D3）
- Firefox、Safari
- 应用商店上架
- 从其他扩展导入配置
- 移动端 / 桌面端 / 浏览器以外的形态

### 1.3 关键技术决定

每条决定都写明代价和推翻条件。推翻时在附录 F 记录。

**D1　只支持 OpenAI 兼容接口。** 一个协议覆盖绝大多数服务，服务之间的差异收敛成三个可配置项：base URL、headers、extraBody。代价是各家原生接口的独有能力用不了，总结场景用不到它们。

**D2　不用 Vercel AI SDK，自写最小客户端。** 只有一个协议时，真正需要的只有四件事：构造请求、解析 SSE、把 delta / usage / 错误归一、取消。SSE 帧解析交给 `eventsource-parser`，其余自写。

依据（2026-10-13 实测，rolldown minified）：

- 自写原型 110 行，连同 `eventsource-parser` 打包后 5.4 kB。它对着本地假 SSE 服务跑通了：SSE 注释行、`reasoning_content`、被网络分块切开的 UTF-8 字符、带缓存 token 的 usage、401 错误、流中错误事件、用户中止；
- AI SDK 全套（`streamText` + `@ai-sdk/openai-compatible` + `useChat`，不含 React）323 kB；
- 客户端跑在面板页面里，体积不是决定性因素。决定性的是：兼容差异的处理完全在我们手里（附录 D），不受 SDK 大版本改接口的牵连，也不用逐个覆盖与我们需要不符的默认值（`maxRetries` 默认 2、`includeUsage` 默认关、`maxOutputTokens` 会被映射成 OpenAI 推理模型不接受的 `max_tokens`）。

代价：边界情况要自己负责，靠 SSE 语料单测和本地假服务兜住；完整版预计 400–600 行（不含测试）。
推翻条件：阶段 4 结束时，客户端仍有语料覆盖不了的兼容问题，或代码超过约 800 行（不含测试）→ 改用 `@ai-sdk/openai-compatible`，并相应上调面板入口的预算。

**D3　按需注入，不常驻。** 触发方式有三种：点工具栏图标（直接在页面里打开面板并开始总结，没有 popup）、右键菜单、快捷键。这三种手势都会授予当前页的 activeTab，SW 借此用 `scripting.executeScript` 注入内容脚本。由此带来的后果（已写进各阶段的验收）：

- 刷新后，注入的脚本已经不在，而我们不持有该站点的常驻权限，所以面板不会自己回来。用户再触发一次，面板再从快照恢复。**已定**：不做「允许读取所有网站」开关，也不做按站点授权；
- 不做「换页自动总结」「新页面自动打开面板」——它们都需要全站权限；
- Playwright 点不了工具栏和右键菜单，E2E 改用只存在于测试构建里的 host 权限和触发入口（§6）。

**D4　面板是嵌在页面里的扩展 iframe，模型请求在面板文档里发起。** 内容脚本只负责三件事：宿主外壳（closed Shadow DOM 里的拖拽、缩放、关闭）、正文提取、页面内定位。面板 UI 和模型请求都在 `panel.html`（扩展 origin）里运行。这样：

- 模型请求不经过 SW。SW 的回收规则（30 秒无活动、fetch 响应超过 30 秒才到达）和长时间流式无关，不需要 port 桥、帧协议和保活；
- 关闭面板或离开页面时 iframe 销毁，请求随之结束，没有孤儿请求；
- 用户在面板里输入的追问位于独立文档，页面脚本监听不到这些键盘事件；页面 CSS 也影响不到面板；
- 凭据只出现在扩展进程里，内容脚本和页面进程都拿不到；
- React 只出现在扩展页面（面板与设置页共享一个 chunk），内容脚本不带 React。

代价：

- `panel.html` 要列入 `web_accessible_resources`（开 `use_dynamic_url`，并且面板只在后台登记过的标签页里工作）。若 `use_dynamic_url` 下出现兼容问题，退回静态 URL，代价是网站可以借此探测到扩展已安装；
- 每个打开的面板多一个扩展进程帧；
- iframe 首次加载需要时间，所以外壳先由内容脚本立即画出。

阶段 1 必须先验证两件事：

- 带 COEP 或严格 CSP 的页面能否嵌入；
- 嵌在公网页面里的扩展 iframe 请求 `localhost`（Ollama 等）时，是否受 Chrome「本地网络访问」限制。Chromium 扩展团队在 chromium-extensions 论坛答复过：有对应 host 权限的扩展不受影响；但没有专门说明嵌入式 iframe 的情况。

推翻条件：

- 本地网络验证不通过且无法规避 → 本地地址的请求改为经 SW 代发（只对 loopback / 私网 origin 启用，并配心跳保活）；
- 相当一部分页面无法嵌入 iframe → 这些页面改用浏览器侧边栏显示同一个面板页面。面板本来就是扩展页面，换容器的成本很小。

被否决的方案：

- 页面内 Shadow DOM 面板 + SW 代发请求（v1）：需要流式桥与保活，每次注入的内容脚本要带 React 等全套 UI，页面能监听到面板里的输入；
- 浏览器侧边栏：工程上最干净，但面板不再浮在页面上、还会挤窄页面。按你的偏好不选，只保留为上面的退路。

**D5　不做精确分词。** 预算用保守近似（`domain/token-estimate.ts`）；显示用量时优先用服务商返回的 `usage`。

## 2. 架构基线

### 2.1 一次总结的完整路径

1. 用户手势：点工具栏图标、右键菜单或快捷键（都会授予当前页的 activeTab）。
2. SW 先等隔离闸门（`storage.local` 关上之前不注入，失败就不注入），再用 `executeScript` 注入内容脚本。受限页面不注入，在工具栏图标上给出提示。
3. 内容脚本立即画出宿主外壳，经 `content.hello` 取得一个新 nonce（每挂载一次面板 iframe 换一个，登记在 `storage.session`），在外壳里嵌入 `panel.html#<nonce>`。iframe 带 `credentialless`，带 COEP 的页面也能加载（附录 F）。后台同时记下这次挂载的页面键（阶段 3 起，由浏览器报告的 `sender.url` 算出，不信任内容脚本自己报的 URL）。
4. 面板的第一个 RPC 是 `panel.attach(nonce)`。SW 核对「nonce + 发送方标签页」一致，把 nonce 绑定到这个面板文档（`documentId`）。之后后台只为它服务：除 `panel.attach` 外，面板的每个调用都要求发送方就是这个文档，没接上的面板文档（例如页面自己加载的）什么也拿不到。
5. 面板经 RPC 请求正文：SW 用 `tabs.sendMessage` 问内容脚本（frameId 0），用 schema 校验回复，再转交给面板。
6. 阶段 3 起，面板接上后先读本页的对话快照（`snapshot.get`，后台按发送方的标签页和登记的页面键取）：有就恢复，不发请求；没有才总结。
7. 每次请求，面板经 RPC 并行读取模型菜单与正在用的模型（`models.current`，只带这一个模型的 Key）、Prompt 列表（`prompts.list`）和裁剪策略（`settings.current`），按上下文窗口把正文裁到预算内，用默认 Prompt 的模板渲染消息，后接已有的对话与新问题，`fetch` 用户的服务，流式渲染。阶段 1 起改为经后台读，不直接读 `storage.local`：解读存储的只有一处，读也走隔离闸门（附录 F）。
8. 写入（快照、配置变更）一律经 RPC，交给 SW 的写队列。回答完成后，面板把整段对话（只有回答与追问）经 `snapshot.save` 存进 `storage.session`。

面板、SW、内容脚本之间不用 `window.postMessage`，因为页面可以伪造它。

### 2.2 硬约束及其强制手段

这些不是建议，是 CI 会拦下来的东西。改动前先读 `AGENTS.md`。

| 约束                     | 落地位置                                                   | 由什么强制                                                                                                                                                                                                       |
| ------------------------ | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 契约优先                 | `src/contract/**`                                          | zod schema 同时推导类型、读写校验、存储信封版本                                                                                                                                                                  |
| 分层单向依赖             | `contract → domain → platform → features → entrypoints`    | ESLint `import-x/no-restricted-paths`（反向依赖直接报错）                                                                                                                                                        |
| 运行上下文边界           | 附录 A 中每个 platform 模块都标注了允许的上下文            | ESLint（纯类型导入放行）。**SW**：background 入口不得引用 `features/**`；contract / domain / platform / background 不得在运行时引用 React，所以 SW 能触及的代码里没有 React。**内容脚本**（`entrypoints/injected.ts`、`platform/{panel-host,extract}/**`、`platform/rpc/lite-client.ts`）：不得在运行时引用 React、zod、定义 schema 的 contract 文件、`platform/{storage,llm,settings}`、`features`（内容脚本侧的 RPC 客户端不做 zod 校验，校验在服务端）。都已落地，并用故意违规的临时文件自测过 |
| 单一写队列               | `src/platform/storage/tx.ts`                               | `createRepo(...).update` 在队列内完成读改写；几条记录一起变（列表与默认项）时，在同一个队列任务里用 `updateUnqueued`；`wxt-store` 只允许 `platform/storage/**` 引用（ESLint）                                    |
| RPC 全校验 + 调用方策略  | `platform/rpc/server.ts`；方法表在 `contract/rpc.ts`       | 每个方法声明允许的调用方（设置页 / 面板 / 内容脚本）。服务端统一校验：发送方是本扩展、调用方类型在白名单内、入参通过 zod；未声明即拒绝。调用方是面板时，除 `panel.attach` 外还须是本 tab 已接上的文档 |
| 凭据隔离                 | SW 启动时调用 `storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })`，经 `ensureLocalStorageIsolated()` 闸门使用，失败即关闭（fail closed） | 单测：浏览器确认隔离之前不运行任何 RPC handler、不注入内容脚本，确认失败时 RPC 一律返回 `storage-not-isolated`、注入改为图标提示。E2E：在内容脚本的隔离世界里读 `storage.local` 失败 |
| 模型请求只在扩展页面发起 | `src/platform/llm/**`                                      | 只允许 `features/{panel,settings}` 引用（ESLint，阶段 1 落地）                                                                                                                                                   |
| 权限最小化               | `wxt.config.ts` 的 `manifest`                              | `scripts/check-manifest.ts` 比对产物 manifest 与附录 C（清单在 `scripts/lib/manifest-policy.ts`），多一项或少一项都失败；并扫描产物，确认 E2E 构建专用的触发入口没有混进生产构建                             |
| 体积预算                 | `scripts/check-bundle-budget.ts`                           | 阶段 0 起进 CI，按入口断言（§9）；判定在 `scripts/lib/bundle-budget.ts`                                                                                                                                          |
| 不做精确分词             | `src/domain/token-estimate.ts`                             | 保守近似 + 服务商 `usage`                                                                                                                                                                                        |
| 只读控制面可测           | `platform/storage/types.ts` 的 `StorageLike`               | 业务逻辑依赖窄接口，测试用内存实现（`tests/helpers/memory-store.ts`）                                                                                                                                            |

## 3. 阶段总览

规模是相对量级（S ≈ 一个纵切片，M ≈ 数个纵切片，L ≈ 需要多轮迭代），不是工时承诺。

| 阶段 | 主题                   | 关键交付物                                                                                                                             | 规模 | 需要你手工验证                         | 状态   |
| ---- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---- | -------------------------------------- | ------ |
| 0    | 走骨架（在本仓库重做） | 分层架构、契约层、存储层（信封、写队列、读取三态、隔离备份）、带调用方策略的 RPC 控制面、凭据隔离、工具链与 CI（含 manifest 与体积检查）、E2E 冒烟 | S    | 否                                     | 已完成 |
| 1    | 最小可用纵切片         | 技术验证；单个模型配置 + 权限申请；点图标在页面里打开面板并流式总结；自写客户端；安全 Markdown；本地假服务 E2E                           | L    | 是（真实 Key 总结一次 + 触发路径冒烟） | 已完成（Edge 复核与冒烟并入阶段 3） |
| 2    | 配置管理               | 多模型 / 多 Prompt 的增删改、排序与默认项；列表的数据语义（`unrecognized` 行、隔离备份的查看与删除）；权限生命周期；面板里的模型切换     | M    | 否（附录 H 有一项可选检查）            | 已完成 |
| 3    | 对话与恢复             | 追问；快照与恢复；右键菜单；预算与裁剪；用量显示                                                                                       | M    | 是（触发路径冒烟）                     | 自动化部分已完成，待手工冒烟 |
| 4    | 兼容与健壮性           | 完整错误分类与重试策略；兼容差异矩阵（附录 D）与语料；推理内容；受限页面；扩展更新后的接管                                              | M    | 是（几个真实服务各一次）               | 未开始 |
| 5    | 阅读体验与设置完整化   | 引用定位原文；选区总结；提取降级；主题与字号；测试连接；导入导出；通用设置                                                             | L    | 部分                                   | 未开始 |
| 6    | 硬化与分发             | 无障碍；英文界面与语言切换；权限与体积终审；发版流程；GitHub Release                                                                   | M    | 是（发布前冒烟）                       | 未开始 |

依赖顺序是线性的：0 → 1 → 2 → 3 → 4 → 5 → 6。从阶段 1 起，每个阶段结束时产品都能日常使用。

每个阶段结束时必须能回答三个问题：这阶段证明了什么？怎么复现？还剩什么没做？

## 4. 阶段详情

### 4.1 阶段 0 —— 走骨架（在本仓库重做）

**目标**：证明这套架构能跑通一根真实纵切片，而不是先铺一堆空目录。原型环境里做过一次，代码没有保留下来，在本仓库按本文的约束重做。2026-10-13 完成，实测数据见附录 E。

**交付物**

```
src/contract/      storage.ts（键与信封）· general-settings.ts · rpc.ts（含每个方法允许的调用方）
src/domain/        token-estimate.ts · patch.ts
src/platform/      storage/{types,tx,repo,quarantine,wxt-store,access-level,index}.ts
                   rpc/{messaging,caller-policy,server,client}.ts
                   settings/general-settings-service.ts · logger/index.ts
src/features/      settings/（设置页与 hook）· theme/（颜色 token、应用主题）
src/entrypoints/   background/index.ts（启动时限制 storage.local 的访问级别）· options/*
tests/             契约、领域、存储（队列防丢更新、读取三态、隔离备份）、RPC（调用方策略、分发、客户端）、
                   设置服务、两个检查脚本的判定逻辑
e2e/               fixtures.ts（加载扩展）· smoke.spec.ts（真实 Chromium）
scripts/           check-manifest.ts · check-bundle-budget.ts · lib/（判定逻辑，有单测）
.github/workflows/ quality.yml（gate + build + 两项检查 + E2E）
```

与原计划的出入（附录 F 有记录）：

- 隔离备份（`quarantine.ts`）从阶段 2 提前到这里：读取三态里的 invalid 一旦被下一次保存覆盖，原值就没了，不能等到阶段 2；
- 不做 `contract/index.ts` 汇总导出：按文件引用，免得一处运行时引用把所有 schema 连同 zod 带进不该有它们的入口；
- 检查脚本用 TypeScript 写，由 Node 22 内置的类型剥离直接运行，不再是 `.mjs`。

**验收标准**

- [x] `npm run gate`（compile + test + lint + format）与 `npm run build` 全绿，并在 CI 中可重复
- [x] E2E：扩展能加载 → SW 起得来 → 设置页渲染 → 改一个设置，经后台 RPC 落盘 → **刷新页面后仍在**（排除「只活在 React state 里」的假通过）。另断言了存储里的信封原文，并覆盖了「坏数据 → 设置页提示 → 保存前备份」
- [x] 单测：保存一个设置字段不会重置其它字段（patch 必须逐字段显式 optional，原型环境里抓到过这个缺陷）
- [x] 单测：token 估算按码点计数（用 100 个 emoji 断言；单个 emoji 区分不了「按码点」和「按 UTF-16 单元」，原型环境里也抓到过）
- [x] 单测：未在方法表里声明的调用方被拒绝（包括内容脚本调用不属于它的方法）
- [x] `check-manifest`：产物里只有附录 C 中阶段 0 引入的项
- [x] 体积检查跑出第一份基线：`background.js` 100.88 kB，整包 407.85 kB

**阶段小结**

- **证明了什么**：
  - 分层、唯一写入口、SW 不含界面代码，都由 ESLint 强制，且用故意违规的临时文件验证过会报错；
  - 存储的信封、读取三态、隔离备份、「版本更新的数据只读」，在单测和真实 Chromium 中都成立；
  - RPC 只认浏览器提供的 sender，未登记的调用方被拒绝；
  - 凭据隔离 fail closed：浏览器确认 `storage.local` 只对扩展页面开放之前，RPC 不运行任何 handler，确认失败时一律拒绝（单测；E2E 能读到设置，说明真实 Chromium 里确认成功了）；
  - 「设置页 → RPC → SW 写队列 → 存储 → 刷新后仍在」这条往返在真实浏览器里跑通，CI 可重复。
- **怎么复现**：`npm ci && npm run gate && npm run build && npm run check:manifest && npm run check:bundle && npm run test:e2e`
- **还没做**：
  - 凭据隔离的 E2E 断言（需要内容脚本，阶段 1）；内容脚本的 lint 边界（阶段 1）；
  - 隔离备份在设置页的查看与删除（阶段 2）；
  - 调用方判定目前要求 `sender.url` 的 host 等于扩展 id。面板在 `use_dynamic_url` 下的 `sender.url` 是什么形态，由阶段 1 的技术验证第 1 项确认，必要时调整 `caller-policy.ts`；
  - zod 占 `background.js` 的 84%（见 §9）。目前离预算还远，先记下来。

### 4.2 阶段 1 —— 最小可用纵切片

**目标**：用最短路径做出一个每天能用的版本，同时尽早验证 D3 / D4 的风险点。

**本阶段结束时你能做的事**：在设置页填好一个模型，然后在任意网页点工具栏图标或按快捷键，页面里出现面板并流式输出总结，随时可以停止。

**第一步：技术验证**（结论写进附录 F；任何一项不通过，都先按 §1.3 的推翻条件处理）

1. **iframe 嵌入**：在普通页、带严格 CSP 的页、带 `Cross-Origin-Embedder-Policy: require-corp` 的页上，`use_dynamic_url` 下的 `panel.html` 能否加载；同时记录面板发出的消息里 `sender.url` 是什么形态，调用方判定依赖它。
2. **跨域与本地网络**：面板嵌在 `https` 公网页面中，确认两件事：
   - 对已授权的 `http://localhost:<端口>` 发起的流式请求不被拦截（当前 Chrome 稳定版）；
   - `use_dynamic_url` 下，面板的跨域请求仍享有 host 权限带来的 CORS 豁免。
3. **Edge**：以上两项在 Edge 当前稳定版上是否一致。
4. **就绪耗时**：记录「外壳可见」与「面板可交互」两个时间点的基线。
5. **体积**：按 §9 的口径出第一份实测数，校准预算。

**技术验证结论**（2026-10-14，Playwright 自带的 Chromium 141；详细记录见附录 F 的 v4.2 一行）：

| 项 | 结论 |
| --- | --- |
| 1. iframe 嵌入 | 普通页、严格 CSP（含 `frame-src 'none'`）的页都能加载。**带 COEP 的页不能**，manifest 里声明 COEP 也没用；给 iframe 加 `credentialless` 后能加载，`chrome.storage`、消息和跨域豁免都照常，已采用。面板消息的 `sender.url` 用的是扩展的固定 id（不是动态 GUID），调用方判定无需改动。页面用固定 URL 自行嵌入 `panel.html` 只会得到错误页 |
| 2. 跨域与本地网络 | 让测试页被当作公网页面（`--ip-address-space-overrides`），面板对 `http://localhost` 的流式请求不被拦截；同一个页面自己的脚本去请求 localhost 则被「本地网络访问」拦住，说明该限制是开着的，只是不作用于有主机权限的扩展面板。不带 CORS 头的响应也能读到，主机权限的跨域豁免在 `use_dynamic_url` 下成立。**这是 Chromium 141 的结果，当前 Chrome 稳定版需要你复核** |
| 3. Edge | 需要你在 Edge 当前稳定版上手工验证（附录 H） |
| 4. 就绪耗时 | 外壳可见：脚本里约 4 ms，E2E 里约 18–22 ms（含 Playwright 往返）；面板就绪（接上并读完模型配置）：E2E 里约 150–175 ms |
| 5. 体积 | 见 §9：各入口都远低于预算，预算不变 |

**交付物**

| 文件 | 内容 |
| --- | --- |
| `src/contract/model-config.ts` | `ModelConfig`：id / 名称 / baseURL / apiKey / model / headers / extraBody / contextWindow / 是否请求流式 usage。`contextWindow` 只用于预算，不发送。存储一开始就是列表信封，本阶段界面只编辑其中一条，避免阶段 2 再改 schema |
| `src/contract/page-context.ts` | 提取结果：title / url / lang / text / 是否截断 |
| `src/contract/rpc.ts`（扩展） | 本阶段的方法及其允许的调用方：`content.hello`（内容脚本）、`panel.attach` / `page.getContext`（面板）、`models.add` / `models.update`（设置页） |
| `src/contract/rpc-wire.ts` | 通道名与请求 / 回复的形状，只有常量和类型、不依赖 zod。阶段 0 里它们和 schema 同在 `rpc.ts`，内容脚本若从那里取通道名，会把 zod 和全部 schema 一起带进去 |
| `src/platform/rpc/{server,caller-policy}.ts`（扩展） | 新方法纳入调用方策略 |
| `src/domain/llm/request.ts` | 构造请求。请求体只含 `model`、`messages`、`stream: true` 和可选的 `stream_options`，再合并 extraBody，保留键 `model` / `messages` / `stream` 不可覆盖。头部为 `Authorization`（有 Key 时）加用户 headers |
| `src/domain/llm/stream.ts` | 把 SSE 事件归一为 `content` / `usage` / `error` / `done`（纯函数，用语料单测） |
| `src/domain/llm/errors.ts` | 错误分类 v0：鉴权 / 未授权访问 / 网络 / HTTP / 已取消 / 未知 |
| `src/domain/url.ts` | base URL 规范化（去尾斜杠、去掉误贴的 `/chat/completions`）；origin → 权限匹配模式；可注入 URL 判定 |
| `src/domain/prompt/default-prompt.ts` | 内置的一套总结 Prompt（阶段 2 前不可配置） |
| `src/domain/i18n/**` | 取词函数与中文消息表（纯数据 + 纯函数，各上下文都能用；英文在阶段 6） |
| `src/platform/llm/client.ts` | `fetch` + `eventsource-parser` + `AbortSignal`；空闲看门狗（首字节与流中各一个阈值） |
| `src/platform/permissions/origin-access.ts` | 按 origin 申请与查询；必须在点击回调里、任何 `await` 之前调用 |
| `src/platform/triggers/{action,commands}.ts` | SW 侧：图标与快捷键的回调 |
| `src/platform/inject/inject.ts` | SW 侧：nonce 登记、`executeScript` 注入、受限页面判定与图标提示。注入前先 `await ensureLocalStorageIsolated()`，失败就不注入并在图标上提示：内容脚本只能出现在 `storage.local` 已经关上之后 |
| `src/platform/extract/readability.ts` | 基于 `@mozilla/readability` 的正文提取（降级方案在阶段 5） |
| `src/platform/panel-host/host.ts` | 内容脚本侧：closed Shadow DOM 外壳、iframe 挂载、重复注入守卫。宿主挂在 `<html>` 下，页面重建 body 碰不到它；页面删掉宿主则重挂 |
| `src/features/markdown/**` | 安全渲染管线（规则见 §8） |
| `src/features/panel/**` | 面板 UI 与状态机：`idle → extracting → requesting → streaming → done / stopped / error` |
| `src/entrypoints/{content,panel}/**` | 薄壳 |
| `src/entrypoints/options/**`（扩展） | 单个模型的新增 / 编辑表单 |
| `wxt.config.ts` | 权限、`web_accessible_resources`、`commands`、`extension_pages` CSP（附录 C） |
| `e2e/fake-llm/**` | 本地假 OpenAI 兼容服务 + fixture 页面（§6） |

与上表的出入（附录 F 有记录）：

- 内容脚本的入口叫 `src/entrypoints/injected.ts`（产物 `injected.js`），不是 `content/`：WXT 会把 `content.ts` 当成要写进 manifest 的内容脚本；
- 面板经 `models.list` 从后台读模型配置，不直接读 `storage.local`；为此 RPC 多了 `models.list`（设置页、面板可调用）；
- nonce 在 `content.hello` 时签发（`platform/inject/registry.ts`，登记表的契约在 `contract/panel-registry.ts`），页面删掉宿主后重挂时也能换新的；
- 错误分类 v0 多了「超时」和「流中错误」两类：本阶段就有看门狗，流中错误也要和网络错误分开说；
- 另加：`contract/commands.ts`（快捷键命令名）、`domain/model-form.ts`（设置页表单解析）、`platform/settings/model-configs-service.ts`、`platform/rpc/{lite-client,errors}.ts`、`platform/inject/page-context.ts`、`platform/extract/listener.ts`、`platform/runtime/settings-page.ts`；
- 页面正文的长度上限（6 万字符）放在 `platform/extract`，不在 contract：内容脚本只能从 contract 引用类型。

**关键设计决定**

1. **请求只发协议必需的字段。** 默认不发 `temperature` 和 `max_tokens`：OpenAI 的推理模型不接受 `max_tokens`（要求 `max_completion_tokens`），也不接受自定义温度，而很多兼容服务只认识 `max_tokens`。需要时由用户写进 extraBody——服务是用户的，参数也由用户定。
2. **权限申请不阻塞保存。** 保存时对 base URL 的 origin 调 `permissions.request`；用户拒绝也照样保存，配置标为「未授权」，面板遇到相应错误时给出「去授权」入口。服务本身允许浏览器跨域时，未授权也可能可用，所以「未授权」只是提示，不拦请求。
3. **触发即总结。** 图标、快捷键触发时，面板出现后直接对当前页开始总结（阶段 3 起：本页已有对话就先恢复）。
4. **面板只在登记过的标签页工作。** 页面自己嵌入 `panel.html` 时，`attach` 失败，面板什么也不做。后台也不依赖面板代码自律：没接上的面板文档，除 `panel.attach` 外的调用一律拒绝。
5. **取消是一等公民。** 停止 → `AbortController.abort()` → 停止读取并取消响应体；已收到的内容保留，状态为「已停止」。关闭面板或离开页面时，iframe 销毁，请求随之结束。
6. **重复注入幂等。** 同一文档里多次触发只会复用已有面板：守卫是隔离世界里的标志，加上自己持有的宿主引用，不查 DOM，所以页面预先放置的同名元素挡不住挂载。
7. **本阶段不自动重试。** 重试策略在阶段 4 和完整的错误分类一起定。

**验收标准**

- [ ] 技术验证五项都有结论，已写进附录 F（第 1、2、4、5 项已在 Chromium 141 上有结论；第 3 项 Edge 和第 2 项在当前稳定版上的复核没有单独反馈，并入阶段 3 的手工轮次）
- [x] `npm run gate`、`npm run build`、`npm run test:e2e` 全绿（E2E 连续跑 3 遍全部通过）
- [x] 单测覆盖：
  - 请求体构造：extraBody 合并、保留键不可覆盖、headers 非字符串值被拒；
  - SSE 归一，语料覆盖：普通、分块边界切在多字节字符中间、注释行、`[DONE]`、流中错误、无 usage、末尾 usage；
  - base URL 规范化、可注入 URL 判定、错误分类 v0；
  - 注入等待隔离闸门：闸门未确认时不调用 `executeScript`，确认失败时不注入；
  - 面板必须先接上：未接上的面板文档调用 `models.list`、`page.getContext` 被拒，handler 不运行；
  - 错误详情脱敏：Key（再短也算）、自定义请求头的值、base URL 的查询参数在回显时都被替换；浏览器不会发送的请求头在保存时被拒；日志里的 URL 只记 origin。
- [x] Markdown 安全回归（用例清单见 §8；三处防线分别故意破坏，测试都会失败）
- [x] E2E：fixture 页 → 触发 → 面板出现 → 文本逐步流出 → 停止后内容保留；另有一条正常完成的路径
- [x] E2E：在内容脚本的隔离世界里调用 `storage.local.get` 失败
- [x] E2E：直接打开 `panel.html`（无从接上）时，从面板里发出的 `models.list`、`page.getContext` 都被拒，回复里没有 Key
- [x] E2E：页面预置同名元素时面板仍能挂载；页面清空并替换 body 时面板原样不动、不用重挂（宿主挂在 `<html>` 下）；页面删掉宿主后面板重新挂载并换新的 nonce；页面自行嵌入 `panel.html` 时连页面都加载不出来，也就无从 `attach`
- [ ] 手工冒烟：附录 H 中阶段 1 的各项（日常试用里没有发现问题，但没有逐项反馈；与阶段 3 的冒烟一起跑）
- [x] 手工：你用真实 Key 在真实页面上总结一次，结论写进 CHANGELOG（2026-10-14：装上试用，没有大问题，启动速度好）

**阶段小结**（自动化部分）

- **证明了什么**：
  - D3 / D4 的主要风险在 Chromium 141 上都过了：按需注入、页面内扩展 iframe（含严格 CSP 与 COEP 页面）、本地模型、主机权限的跨域豁免；
  - 完整路径「触发 → 外壳 → 面板接上 → 读正文 → 流式请求 → 安全渲染 → 停止 / 完成」在真实浏览器里跑通，假服务不带 CORS 头，请求靠的就是主机权限；
  - 凭据隔离 fail closed：内容脚本读不到 `storage.local`，闸门不通过就不注入；
  - 后台只为已接上的面板服务，错误详情和日志里不出现凭据（PR #2 审阅后补上，见附录 F）；
  - 模型输出注入不了标记，也让面板加载不了图片。
- **怎么复现**：`npm ci && npm run gate && npm run build && npm run check:manifest && npm run check:bundle && npm run build:e2e && npm run test:e2e`
- **还没做**：
  - Edge 与当前 Chrome 稳定版上的复核、附录 H 的逐项冒烟（并入阶段 3 的手工轮次）；
  - 扩展更新后，页面里残留的旧宿主（阶段 4）；
  - 正文上限是固定的 6 万字符，按上下文窗口裁剪在阶段 3；
  - 面板主题只跟随系统，跟随设置在阶段 5。

### 4.3 阶段 2 —— 配置管理

**目标**：把「用户配置」这个领域补齐——多个模型、多个 Prompt、默认项，以及它们的存储语义，让 UI 只负责渲染，不含业务判断。

**本阶段结束时你能做的事**：在设置页管理多个模型与多个 Prompt（新增、编辑、删除、排序、设为默认）；在面板里切换模型；数据无法识别时，在设置页查看、导出、删除覆盖前留下的备份。2026-10-14 完成。

**新增文件**

| 文件 | 内容 |
| --- | --- |
| `src/contract/prompt-config.ts` | `PromptConfig`：id / 名称 / system 模板 / user 模板 |
| `src/contract/selection.ts` | 默认模型 id、默认 Prompt id |
| `src/contract/mutations.ts` | 变更入参：`add` / `update`（显式 patch）/ `remove` / `move` / `setDefault` |
| `src/domain/list-mutations.ts` | 列表变更的纯函数（含默认项回退） |
| `src/domain/prompt/render.ts` | `{{var}}` 渲染器 |
| `src/platform/settings/{model-configs,prompt-configs,selection}-service.ts` | 读取；变更（走写队列）；首次安装时播种内置 Prompt |
| `src/platform/storage/quarantine.ts`（扩展） | 阶段 0 已就位（整值损坏时备份）；本阶段接上列表，并让设置页能查看、导出、删除备份（§7） |
| `src/features/settings/**` | 模型列表、Prompt 列表的基本 CRUD 界面 |
| `src/features/panel/**`（扩展） | 模型下拉 |

与上表的出入（附录 F 有记录）：

- 没有单独的 `selection-service.ts`：默认项跟着它的列表走。模型与 Prompt 共用 `platform/settings/config-list-service.ts`，每次变更在写队列的同一个槽里改列表、（需要时）写默认项、回收访问权；两个列表的默认项同在 `local:selection` 一条记录里；
- 「首次安装时播种内置 Prompt」改为：Prompt 列表还没写过时，它的内容就是内置 Prompt，第一次变更时连同变更一起写下。从阶段 1 升级的用户（从没存过 Prompt）同样有它，也不需要监听 `runtime.onInstalled`；
- `mutations.ts` 只放更新、删除、移动、设为默认的入参；新增用各自的草稿 schema（`ModelConfigDraft`、`PromptConfigDraft`）；
- 面板不用 `models.list` 读模型，改用新增的 `models.current`（菜单只有名称，外加正在用的那个模型的完整配置），模型菜单用 `models.choose` 设默认项；`models.list`、`models.setDefault` 只给设置页（见下面第 8 条）；
- 另加：`contract/backups.ts`；`domain/{origins,credentials,prompt-form}.ts`、`domain/prompt/messages.ts`；`platform/storage/{list-repo,watch}.ts`；`platform/settings/backups-service.ts`；设置页的 `features/settings/{editable-list,list-parts,fields,model-form,prompt-form,prompt-section,backups-section,use-config-list,use-origin-access,download}.*`。

**关键设计决定**

1. **只暴露变更面，不暴露整表覆盖。** 后台在写队列内「读全量 → 改 → 写全量」，任何上下文都没有「把整个数组传回去」的能力，并发期间新增的行不可能被覆盖掉。
2. **宽容读取 + 原样保留。** 认不出的行被隔离在 `unrecognized`，不参与业务、UI 不显示，写回时原样保留在末尾。
3. **Prompt 渲染器自写，不引入 Mustache。**
   - 变量白名单：`{{title}}` `{{url}}` `{{content}}` `{{selection}}` `{{language}}`；
   - 只替换一遍，替换进来的值不再解析；
   - 不做 HTML 转义（这是给模型的纯文本）；
   - 未知变量原样保留，并在编辑器里标出；
   - 没有任何变量能读到配置或凭据。
4. **默认项回退。** 删除当前默认模型 / Prompt 时，回退到列表首项并明确告知；列表为空时就没有默认项，面板引导用户去设置页。
5. **权限生命周期。** 新增配置或改 base URL 时申请对应 origin；删除配置或改 URL 后，只回收不再被任何配置引用的 origin（引用计数）。
6. **写路径封口。** ESLint 禁止 `platform/storage/**` 以外的代码引用 `platform/storage/wxt-store`（阶段 0 已落地，并用故意违规的临时文件自测过）；本阶段新增的服务也只通过 repo 写入。
7. **面板里的模型下拉写全局默认项**，切换即生效；Prompt 只在设置页改，减少误改默认项的机会。

实现中定下的细节：

1. **认不出的行**：一行通不过 schema，或者它的 id 与前面某行重复，就放进 `unrecognized`（`platform/storage/list-repo.ts`）；写回时原样放在已识别的行之后。只有整个值不是信封、或者不是数组时才算 `invalid`。设置页只说「另有 N 条记录当前版本无法识别，已原样保留」。
2. **默认项**：选中的 id 不在列表里（被删了、那一行损坏、从阶段 1 升级还没选过）时，以首项为默认，不会出现「有模型却没有默认项」。默认项只在一次变更会让它变化时才写下：被删时回退到首项并告知；把别的项移到最前时，把原来隐含的默认项钉住（`domain/list-mutations.ts` 的 `defaultAfterChange`）。默认项记录是更新版本写的（只读）而这次变更又要写它时，在写任何东西之前拒绝，不留半截状态。列表本身是更新版本写的（只读）时，设默认项也拒绝：那个版本对默认项的理解可能不同（PR #3 审阅意见）。
3. **移动是相对的**（上移 / 下移一步）：列表在别处变了，移动的仍是用户指的那一项。
4. **编辑只发送改过的字段**（`domain/patch.ts` 的 `changedFields`）：另一个标签页同时改了同一项的其它字段，不会被这一页改回去。
5. **回收访问权在 SW 里做**，在变更写入之后、同一个队列槽内：比较变更前后全部行（含认不出的行）引用的 origin，只回收不再被引用的；逐个回收，浏览器拒绝的（E2E 构建里的必需权限）只记日志，不影响变更本身。已知限制：另一个设置页标签页恰好在这之间为同一个 origin 申请权限并新增配置时，权限会被收回；那一行会显示「未授权」与「授权访问」，点一次即可恢复。
6. **模板**：占位符是双花括号之间的任何文字，前后可以有空格；白名单之外的都算未知，原样发送，编辑器里逐条列出，两个模板都不含 `{{content}}` 时也提示（都不阻止保存）。`{{language}}` 是回答用的语言，阶段 5 之前固定为简体中文；`{{selection}}` 在阶段 5 之前总是空的。正文被截断时，说明附在 `{{content}}` 末尾，任何 Prompt 都会带上。系统模板渲染后为空时不发 system 消息。
7. **备份**：只列用户自己的四条记录（模型、Prompt、默认项、通用设置）的备份；`storage.session` 里的面板登记表是扩展自己的簿记，不列。设置页预览一律不显示凭据；导出文件默认剔除 `apiKey`、`headers` 与 `baseURL` 的查询参数，勾选后才包含（§8）。其它区块的保存刚备份了旧数据时，备份区块经 `storage.onChanged` 得到信号，再经 RPC 重新读取（存储仍只由后台解读）。
8. **面板只拿到它要用的那个 Key**：面板经 `models.current` 读模型，得到菜单（只有名称）和正在用的那个模型的配置；`models.list` 带着全部 Key，只给设置页。这份配置是只含请求所需已知字段的 `PanelModelConfig`：`forPanel` 逐字段复制，schema 是 `z.object`，存储行上的其它字段（更新版本加的、异常数据里的）都带不过去，handler 多塞的字段也会被丢掉（PR #3 审阅意见）。面板本身是扩展页面，本来就能直接读 `storage.local`，所以这挡不住面板里的 XSS；它做的是数据最小化：面板代码出错（例如把配置写进了错误信息）时，最多牵连正在用的那一个 Key。阶段 1 的 PR 里说过阶段 2 这样做。
9. **面板的模型菜单**：选另一个模型时，当前请求立即结束、之后的报告不再显示，经 `models.choose` 写全局默认项，再用它重新总结。这是面板唯一能做的变更（§8 的例外）。快速连续切换时一次只发一个 `models.choose`，按点选的顺序：两个同时发出的选择可能以任意顺序进写队列（后台先要检查发送方）。轮到时已被更新的选择取代的不再发送，只有最新的选择会触发总结或报错（`features/panel/model-switcher.ts`；PR #3 审阅意见）。

**验收标准**

- [x] 列表里塞一条 `{"foo":1}` 的脏行后：读取不炸、UI 不显示它、写回后它仍在（单测：`list-repo` 与两个列表服务；E2E：`settings.spec.ts`）
- [x] 整个值损坏时：读取降级、设置页有可见提示；下一次保存覆盖前，原值已备份到隔离键（单测覆盖模型、Prompt 列表与默认项；E2E 覆盖模型列表与通用设置）
- [x] 设置页能看到隔离备份，可以导出、可以删除（E2E 断言了导出文件的内容：默认不含凭据，勾选后原样；删除后隔离键消失）
- [x] 保存单个字段不影响其它字段（服务单测扩展到列表；E2E：另一个标签页改了 Key，这一页改名后 Key 仍在）
- [x] 删除默认项后回退正确，且有提示（删除前的确认就说明默认项会改成谁；单测 + E2E）
- [x] 删除一个配置时，仍被其它配置使用的 origin 不被回收（单测；认不出的行也算引用）。E2E 做不到：E2E 构建里 127.0.0.1 是必需的主机权限，回收不了，可选权限的授权提示 Playwright 也点不了；附录 H 加了一项可选的手工检查
- [x] 渲染器：未知变量保留；值里含 `{{…}}` 不被二次替换；特殊字符不被转义（另有：原型链上的名字算未知、`$&` 等替换模式原样插入）
- [x] 并发：设置页和面板同时发起变更，没有更新丢失（队列测试：改名、新增与面板设默认同时发生；模型与 Prompt 的默认项同时设置）
- [x] `wxt-store` 只在 `platform/storage/**` 被引用（ESLint；本阶段在 `features/settings` 与 `platform/settings` 各放一个故意违规的临时文件自测，都被拦下）

**阶段小结**

- **证明了什么**：
  - 列表的数据语义在单测与真实 Chromium 里都成立：认不出的行不显示、不丢；整值损坏先备份再覆盖；备份能看、能导出（默认不含凭据）、能删，删除只来自用户；
  - 只暴露变更面：设置页与面板同时变更不丢更新；列表与默认项在同一个队列槽里写，默认项只读时不会写出半截状态；
  - 默认项的回退、钉住与提示由 domain 的同一条规则决定，设置页删除前的确认也用它；
  - Prompt 渲染器的注入面（二次替换、原型链名字、替换模式）有回归用例；面板用默认 Prompt 与默认模型，模型菜单写全局默认项；
  - 面板只拿到正在用的那个模型的 Key：单测，加上 E2E 里从已接上的面板文档内部发出的请求；
  - 面板就绪时间没有变化（E2E 里 144–164 ms，两张列表并行读取）。
- **怎么复现**：`npm ci && npm run gate && npm run build && npm run check:manifest && npm run check:bundle && npm run build:e2e && npm run test:e2e`
- **还没做**：
  - 访问权回收的端到端验证只能手工做（附录 H，可选）；
  - 消息表整张打进了 SW 与内容脚本（见 §9），阶段 6 加英文表之前按上下文拆分；
  - 完整的 Prompt 编辑器（变量提示、渲染预览）、测试连接、导入导出都在阶段 5。

### 4.4 阶段 3 —— 对话与恢复

**目标**：从「一次性总结」变成「可以就这一页继续聊，刷新后还能接着看」。

**本阶段结束时你能做的事**：总结之后在面板底部继续追问；刷新或关掉面板后再触发一次，上次的对话原样回来，不会重新总结；右键菜单也能打开面板；正文太长时按设置里的策略裁剪，面板说明保留了多少；每个回答下面有用量和「复制」。2026-10-15 完成自动化部分，手工冒烟待你验证。

**新增文件**

| 文件 | 内容 |
| --- | --- |
| `src/contract/snapshot.ts` | 快照：pageKey / 消息（只含 assistant 回答与用户追问）/ updatedAt / 字节数 |
| `src/domain/page-key.ts` | 去掉页内锚点后的 URL（`#/`、`#!` 开头的 hash 路由保留） |
| `src/domain/budget.ts` | 输入预算 = contextWindow − 输出预留 − Prompt 与历史开销；四种裁剪策略 |
| `src/platform/snapshot/store.ts` | SW 侧：全局字节预算 + 跨标签页 LRU；标签页关闭时删除 |
| `src/platform/triggers/context-menu.ts` | 右键菜单「总结此页」 |
| `src/features/panel/**`（扩展） | 追问输入、历史、复制总结、用量显示、裁剪提示 |

**关键设计决定**

1. **快照存在 `storage.session`**（只在内存里，扩展更新或浏览器重启即清空），只存 assistant 回答与用户追问，不存带整页正文的 system / user 消息。恢复后再追问时，重新提取正文。
2. **配额按全局算。** `storage.session` 的 10 MB 由所有标签页共享，所以快照预算也是全局的（例如 6 MB），超出时跨标签页按最近使用时间驱逐。单页另设上限，超出时截断最早的消息，并在面板中标注。写失败要在面板里可见，不静默吞掉。
3. **恢复需要用户再触发一次**（D3）：刷新 → 再次触发 → 注入 → 面板读取本页快照并恢复。触发时本页已有对话就先恢复，没有才开始新的总结。
4. **裁剪策略是可见的用户设置**（`front` / `middle` / `back` / `nothing`）。发生裁剪时，面板显示「已按某策略保留约 N tokens」。`nothing` 是「原样发送」的显式选择：服务以超长拒绝时，面板给出「裁剪后重试」按钮，不自动重试。
5. **用量**：有 `usage` 就显示真实值，没有就显示「≈」估算，两者不混用。
6. **同一面板同时只有一条流**：新的总结或追问会先终止旧请求。

与上表的出入（附录 F 有记录）：

- 快照的字节数记在索引里，不在快照本身：每段对话一个键（`session:snapshot:<id>`），另有一个小索引 `session:snapshots` 记标签页、页面键、最近使用时间、字节数和「已驱逐」标记。全部快照放在一个键里，每保存一次就要重写几 MB，`storage.onChanged` 还会把新旧两份广播给每个扩展页面；
- 页面键不由面板提供：内容脚本 `content.hello` 时，后台用浏览器报告的 `sender.url` 算出页面键，记在面板登记表里；`snapshot.get` / `snapshot.save` 不带标签页和页面参数，后台按发送方的标签页和登记的页面取。面板碰不到别的标签页或别的页面的对话；
- 另加：`features/panel/{conversation,latest-only,clipboard}.ts`（对话控制器从 hook 里独立出来，可在 node 里测试；串行、只认最新的发送从 `model-switcher` 抽出）、`domain/llm/usage.ts`、`platform/snapshot/tab-closed.ts`；RPC 新增 `settings.current`（面板只拿到裁剪策略，逐字段映射）、`snapshot.get`、`snapshot.save`；repo 加 `removeUnqueued`（只给扩展按设计管理寿命的记录用）；
- 右键菜单的标题是「用一瞥总结此页」：页面的右键菜单里有别的扩展，带上名字才分得清；
- 提取上限从 6 万字放宽到契约允许的 20 万字：裁多少改由面板按预算决定，「截掉开头」「截掉中间」需要完整的正文。

实现中定下的细节：

1. **预算**：输入预算 = 上下文窗口 − 为回答预留的部分（窗口的四分之一，至少 1,024、至多 8,192 tokens，只是余量，不发送 `max_tokens`）− Prompt、对话历史与新问题。只裁正文，Prompt 与历史不裁；连它们都放不下时不发送，说明原因并建议重新总结。模型没填上下文窗口时按 64,000 tokens 估算，面板和设置页都写明这是估算。裁剪按 `estimateTokens` 的同一套计费逐码点进行（`fitTokens`），不会切开一个字符；截断处写明少了什么（结尾、中间或开头），模型知道正文不完整。多处 `{{content}}` 平分预算；整条消息的估算偶尔比各部分之和多一点，裁完再量一次，不够就继续收缩。
2. **策略名表示截掉哪一部分**：`back` 截掉结尾（默认，与阶段 1、2 一样保留开头）、`middle` 截掉中间、`front` 截掉开头、`nothing` 不裁剪。加字段不升版本（§7）。
3. **「裁剪后重试」**：只在「不裁剪」的请求被服务以超长拒绝时出现，这一次按截掉结尾裁，设置不变。超长的识别：400 / 413 / 422 加上下文长度的措辞（OpenAI 的 `context_length_exceeded` 与「maximum context length」、Anthropic 网关的「prompt is too long」、Gemini 的「exceeds the maximum number of tokens」），流中错误同样识别；429 提到 token 是限流，不算。阶段 4 再并入完整的错误分类。按预算裁过仍被拒时，提示去设置页改上下文窗口。
4. **对话怎么拼**：每次请求都用当前的默认 Prompt 和重新读取的正文渲染，后面接已完成的回答与追问，再接新问题；正文与 Prompt 都不进快照。内置 Prompt 加了一句：之后的追问只依据正文直接回答，不必再写一遍总结。
5. **哪些轮次算数**：回答完成，或停止时已有内容，才进入对话历史并保存；失败的、停止时还没有内容的不算，可以重试，或直接问下一个问题（它被替换）。模型返回空回答算失败。
6. **换模型 = 用新模型重做最近一轮**：只有总结时就是重新总结（阶段 2 的行为不变）；有追问时只重做最后一个回答，之前的对话保留。「重新总结」清空这一页的对话重新开始。
7. **保存**：存下的始终是面板上已完成的对话，变了就立即保存：回答完成时、「重新总结」清空时、重做去掉最后一轮时，都不等下一个回答（PR #4 审阅意见）。每次保存都是整段对话，立即发出，带着本面板的序号（revision）；后台按发送方的面板文档与序号只留最新的一次，晚到的旧保存被忽略，所以保存之间不必排队，也不会让刷新恢复出已经清掉的内容。清空的对话读作「没有保存」。保存失败、保存时截掉了最早的消息、恢复时发现最早的部分没有保存、上次的对话被驱逐了、读取失败，都在面板里说明，只说最新那次保存的结果。
8. **生命周期**：要等待的步骤（恢复上次的对话、换模型时写默认项）只属于发起它的那次操作，之后用户做了别的（总结、追问、重试、换模型、再次打开），或面板已离开，就不再继续。面板离开后，在途请求结束，在途保存的结果也不再显示；已发出的保存照常存下，那就是对话本身（PR #4 审阅意见）。
9. **存储一侧**：全局 6 MB、单页 512 kB（按 UTF-8 JSON 计）。驱逐跨标签页按最近使用时间，恢复也算使用；被驱逐的对话在索引里留下记号（最多 200 条），面板据此说明，而不是悄悄重新总结。单页超限时从最早的问答开始丢，保证对话仍以回答开头；连最新的回答都放不下时报错。会话键写失败时把索引改回原样再报错；索引先于会话键写入、晚于会话键删除，任何时刻都没有索引不知道的键占着内存。关闭标签页时删除它的全部快照与面板登记（每次关标签页都会唤醒 SW）。
10. **面板界面**：每轮一个区块（问题、回答、用量、「复制」）；追问框固定在面板底部，Enter 发送、Shift+Enter 换行，输入法选词时的 Enter 不发送；追问的回答流式输出时视图跟随，除非用户自己滚走了；只有总结时不自动滚动，从开头读。
11. **复制**：面板 iframe 的 `allow="clipboard-write"` 默认只授予 `src` 的 origin，也就是 `use_dynamic_url` 的动态 origin，而面板文档以扩展的固定 origin 提交，所以阶段 1 起这个授权一直没生效；改为写明扩展的 origin。页面用 Permissions-Policy 禁止时，按钮显示「复制失败」。

**验收标准**

- [x] 预算与裁剪测试：四种策略 × 「放得下 / 放不下 / 连 Prompt 都放不下」的边界（`tests/domain/budget.test.ts`，另有保留哪一部分、多处 `{{content}}`、继续收缩、放不下注释时放弃）
- [x] 快照：全局预算触发跨标签页驱逐；单页超限时截断并标注；写失败可见（`tests/platform/snapshot/store.test.ts`；面板一侧的提示在 `tests/features/panel/conversation.test.ts`）
- [x] E2E：总结 → 追问 → 刷新 → 再次触发 → 面板恢复两轮对话（没有新请求；存储里没有正文和 Key；恢复后接着追问，请求带上两轮对话和重新读取的正文）
- [x] E2E：关闭标签页后，该标签页的快照被删除（它的面板登记也删除，别的标签页的不动）
- [x] 用量：语料覆盖「有 usage」「无 usage」两种，分别显示真实值和 ≈ 估算（单测与 E2E）
- [ ] 手工冒烟：附录 H 中阶段 3 的各项（另有阶段 1 留下的 Edge 与当前 Chrome 稳定版复核）

**阶段小结**（自动化部分）

- **证明了什么**：
  - 对话与恢复的完整路径在真实 Chromium 里跑通：总结、追问、刷新、再次触发、恢复、接着追问；关掉标签页后它的对话随之删除；
  - 快照里只有回答与追问，没有正文、Prompt 和凭据；面板只能读写自己标签页、自己页面的对话；
  - 预算按计划的边界逐一测过，裁剪不切开字符、标明缺了哪部分；「不裁剪」被拒后可以裁剪重试；
  - 用量真实值与估算分开显示，从不混用；
  - 同一面板只有一条流：迟到的片段不会混进新的回答（单测里故意让旧请求在新请求进行中吐出文字）；
  - 面板就绪时间没有变化（E2E 里热启动 139–152 ms；浏览器里第一次打开约 350–400 ms，`main` 上同样如此）。
- **怎么复现**：`npm ci && npm run gate && npm run build && npm run check:manifest && npm run check:bundle && npm run build:e2e && npm run test:e2e`
- **还没做**：
  - 手工冒烟（附录 H 阶段 1、3 的各项，含右键菜单、真实页面上的复制，以及鼠标点面板底部的追问框，见下一条）；
  - Playwright 的视口模拟下，离视口底部约 100 px 以内对跨站 iframe 的鼠标点击会丢（普通的跨站 iframe 也一样），追问框正好在那里，E2E 改用键盘发送，点按钮的那条把视口调高。真实浏览器里应当没有这个问题，需要你在附录 H 里确认一次；
  - SPA 用 `pushState` 换页后，打开着的面板仍属于原来的页面（追问时读的是新正文）；关掉面板再触发一次就按新页面处理；
  - 消息表又涨了约 2.5 kB，SW 到了预算的 93%（§9）：拆分消息表提前到阶段 4 开头做，不等阶段 6；
  - 扩展更新后页面里残留的旧宿主（阶段 4）。

### 4.5 阶段 4 —— 兼容与健壮性

**目标**：让「OpenAI 兼容」在真实世界的各种实现上都稳定，出错时给出人话。

**新增 / 扩展**

| 文件 | 内容 |
| --- | --- |
| `src/domain/llm/errors.ts`（完整版） | 鉴权 / 未授权访问 / 限流 / 额度不足 / 超长 / 请求无效 / 服务端错误 / 超时 / 网络 / 已取消 / 未知；每类给出用户文案、是否可重试、建议动作 |
| `src/domain/llm/stream.ts`（扩展） | 推理内容的几种形态归一（附录 D） |
| `tests/fixtures/sse/**` | 兼容差异语料：附录 D 的每一行至少一条 |
| `src/platform/panel-host/orphan.ts` | 扩展更新后的接管：旧实例发现上下文失效就移除宿主；新注入的实例替换残留宿主 |
| `src/domain/url.ts`（扩展） | 受限页面清单：`chrome://`、`edge://`、其他扩展页、应用商店、内置 PDF 查看器、`view-source:` 等 |
| `src/domain/i18n/**`（拆分） | 按运行上下文拆分消息表：SW 与内容脚本只带自己用到的几条（从阶段 6 提前到本阶段开头，见 §9 阶段 3 的观察） |

**关键设计决定**

1. **不做自动重试风暴。** 只有在尚未收到任何内容时，429（遵守 `Retry-After`，上限 10 秒）、5xx 和网络错误才自动重试，且只重试一次。鉴权、未授权、超长、请求无效一律不重试。
2. **`stream_options` 自动降级。** 默认请求流式 usage；服务以 400 拒绝这个字段时，关闭该配置的这一项并重试一次。结果持久化，设置页可见、可改。
3. **推理内容**折叠显示，不进快照，复制总结时也不包含。
4. **凭据脱敏**：错误信息与日志共用一处脱敏规则，避免两套规则漂移。
5. **受限页面**：不尝试注入；没有 popup 可以显示说明，所以在该标签页的工具栏图标上显示角标，并把「此页面无法总结」写进图标的悬停文字，页面跳转后清除。

**验收标准**

- [ ] 错误映射：401 / 403 / 404（模型不存在）/ 429 / 5xx / 超时 / 网络中断 / 超长，各有独立断言
- [ ] 附录 D 每一行至少一条语料测试
- [ ] E2E：
  - 假服务先返回 429 再成功 → 只重试一次；
  - 返回 `stream_options` 相关的 400 → 降级后重试成功，且该设置被记住。
- [ ] E2E：重载扩展（`runtime.reload()`）后再次触发，面板能正常挂载，没有残留的旧宿主
- [ ] 手工：你用 3–4 个真实服务（例如 OpenAI、DeepSeek、OpenRouter、本地 Ollama）各总结一次，结果追加到附录 D

### 4.6 阶段 5 —— 阅读体验与设置完整化

**目标**：把常用的进阶能力和设置补齐，让用户不读文档也能把配置改对。

**阅读体验**

- **引用定位原文**：
  - 内置 Prompt 约定引用格式（照抄原文片段）；
  - 渲染为可点击的引用标记，占位符只在文本上下文里替换，跳过标签内部；
  - 点击后，面板经后台请内容脚本在页面中查找并滚动定位，用 CSS Custom Highlight API 高亮（样式经 `scripting.insertCSS` 注入，不改页面 DOM）；
  - 找不到时明确提示。
- **选区总结**：右键菜单「总结选中内容」，对应 `{{selection}}` 变量。
- **提取降级**：Readability 拿不到正文时，降级为启发式提取；正文仍然过短时，再尝试展开 open shadow root 与同源 iframe（有深度上限）。
- **主题与字号**：颜色、字体 token 只有一套（扩展页面共用 `:root`），只有一个主色；面板正文字号四档。
- **复制页面正文**：面板里的按钮。

**设置页**

- **模型**：列表、排序、设为默认、测试连接（先请求 `GET {baseURL}/models`；服务不支持时，提示可以做一次真实请求，会消耗少量 token）
- **Prompt**：编辑器（变量提示、未知变量标红、渲染预览）
- **通用设置**：主题、字号、裁剪策略、总结语言、日志级别
- **导入导出**：
  - JSON 格式；默认剔除 `apiKey` 与 `headers`，要带凭据须显式勾选；
  - 导入前预览「将新增 N 条 / 跳过 M 条无法识别」；
  - 导入的条目一律分配新 id 追加在末尾，不覆盖现有条目；
  - 全部无法识别时整体拒绝。
- **base URL 快捷填写**：常用服务只给名称 + URL，不带图标

**验收标准**

- [ ] 提取管线用固定的 HTML fixture（文章页 / 列表页 / 正文极短 / 无正文 / 正文在 open shadow root / 正文在同源 iframe）断言输出结构，不依赖网络
- [ ] 引用定位：找到 / 找不到 / 跨元素边界 / 空白差异各有用例；高亮不修改页面 DOM
- [ ] 表单校验在提交前拦下非法输入：headers 非字符串、base URL 非法、extraBody 含保留键、id 冲突
- [ ] 删除 / 覆盖类操作有二次确认，确认文案说明后果（是否连同默认项一起回退）
- [ ] 导入导出往返测试：导出 → 导入 → 列表一致（凭据按选择保留或剔除）
- [ ] 键盘可达：所有控件可 Tab 到达、有可见 focus；`eslint-plugin-jsx-a11y` 无 error
- [ ] 主题 / 字号切换后，刷新仍然生效

### 4.7 阶段 6 —— 硬化与分发

**目标**：把「能用」变成「可发布、可维护」。

- **i18n**：补齐英文消息表，设置里可切换界面语言
- **无障碍**：键盘走查 + 对比度检查 + `jsx-a11y` 全绿
- **权限与体积终审**：逐条复核附录 C 与 §9，每一条都要能回答「去掉它会怎样」
- **发版流程**：见下方固定步骤，写进 `AGENTS.md`
- **分发**：只发 GitHub Release 附件

**发版固定步骤**

1. `npm version <version> --no-git-tag-version`：同时改 `package.json` 与 `package-lock.json` 里的所有版本字段，不要手改
2. `CHANGELOG.md` 增加对应版本条目
3. 跑完整闸门：`npm run gate` && `npm run build` && `npm run test:e2e`
4. 清掉 `.output/*-chrome.zip`，避免旧包被误拷进新版本目录
5. `npm run zip`
6. `scripts/verify-release.ts` 校验产物：
   - 解开 zip，`manifest.json` 的 `version` 等于 `package.json`；
   - `.output/chrome-mv3/manifest.json` 也是目标版本；
   - 权限与附录 C 一致；
   - 不含 source map、`.env*`、E2E 钩子与测试构建才有的 host 权限。
7. 跑一遍附录 H 的手工冒烟清单（Chrome 与 Edge 各一次）
8. 提交、打 tag `v<version>`、推送，用 `gh release create` 发 Release，说明取自 `CHANGELOG.md`

**验收标准**

- [ ] 体积闸门与 manifest 比对在本地和 CI 中都能失败、也能通过（各用一次故意违规的改动验证它真的会拦）
- [ ] 从零克隆 → `npm ci` → `npm run build` → 在干净的 Chrome 里加载 → 完成一次真实总结（发布前的手工冒烟）
- [ ] 发布产物里不含源码映射、`.env*`、测试残留和 E2E 钩子

## 5. 通用完成定义（DoD）

每个阶段、每个提交都必须满足的底线：

- [ ] `npm run gate`（compile + test + lint + format）与 `npm run build` 全绿；**新增行为必须有测试**，而不是「以后补」
- [ ] 涉及 SW / 面板 / 内容脚本之间往返的改动，`e2e/` 有覆盖，或在本文里写清为什么没有
- [ ] 涉及触发路径（图标、右键菜单、快捷键）的改动，附录 H 的冒烟清单同步更新
- [ ] 契约有变化 → 改过 `contract/**`；新的 RPC 方法已在 `contract/rpc.ts` 登记，并声明了允许的调用方
- [ ] 持久化结构有变化 → 版本号与升级函数同时到位，且有幂等测试
- [ ] 新增 manifest 权限 → 先在附录 C 写好理由，同步 `check-manifest` 清单
- [ ] 用户可见行为有变化 → 同步 `README.md` 的「当前状态」与 `CHANGELOG.md` 的 `[Unreleased]`
- [ ] 架构约束有变化 → 同步 `AGENTS.md` 的硬约束表（否则下一个人会照着旧规则写）
- [ ] 不留 `eslint-disable`、不用 TODO 注释代替实现、不用 `any` 逃逸类型
- [ ] 提交信息说明「为什么」，而不只是「改了什么」

## 6. 测试策略

| 层       | 工具                                                 | 覆盖什么                                                         | 门槛                                                |
| -------- | ---------------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------- |
| 契约单测 | Vitest（node 环境）                                  | 默认值、patch 语义、升级函数幂等、脏数据兼容                     | 每个 contract 文件必配；测自己的语义，不测 zod 本身 |
| 领域单测 | Vitest（node 环境）                                  | 估算、预算、裁剪、URL、SSE 归一、错误分类、Prompt 渲染           | 关键分支全覆盖，边界值优先                          |
| 平台单测 | Vitest + 内存 store / 假 fetch                       | 服务层（读改写、队列、三态、隔离备份、快照驱逐）、模型客户端     | 不加载任何浏览器 API，保证能在 node 里跑            |
| 组件测试 | Vitest + jsdom（逐文件 `@vitest-environment jsdom`） | Markdown 安全管线、面板状态机                                    | 每个安全分支一个用例                                |
| E2E      | Playwright + 真实 Chromium + 构建产物 + 本地假服务   | 注入、面板、流式、停止、快照恢复、凭据隔离、调用方策略、权限面   | 不依赖真实 API Key                                  |
| 手工     | 你 + 真实 Key                                        | 触发路径与 Edge（附录 H）、真实服务的连通性、错误提示是否人话    | 阶段 1、3、4、6 各一轮，结论写进 CHANGELOG          |

**本地假服务（`e2e/fake-llm/`）**：一个 Node HTTP 服务，监听 `127.0.0.1` 的随机端口，每个 Playwright worker 一个。响应**不带** CORS 头：面板的请求靠主机权限的跨域豁免，和生产环境一样。

- `POST /v1/chat/completions`：按请求里的场景名（把 `model` 设为 `scenario:<名字>`）返回脚本化的 SSE，并记下收到的请求头、请求体，以及客户端是否提前断开。阶段 1 有：正常（含注释行与末尾 usage）、慢速流、流中错误、不安全的 Markdown、回显 Key 的 401；阶段 3 加了不带 usage 的、按问题作答的对话（追问的回答写出问题本身）、超过约 2,000 字就以 `context_length_exceeded` 拒绝的小上下文服务。首字节延迟、推理内容、429（含 `Retry-After`）/ 500、拒绝 `stream_options` 的 400 随阶段 4 加入；
- `GET /v1/models`：给测试连接用（阶段 5）；
- `GET /*.html`：fixture 页面（普通文章、严格 CSP、COEP、预置同名元素、自行嵌入面板；阶段 3 加了约 6,000 字的长文）。

它走的是真实客户端代码路径（请求构造、SSE 解析、错误映射），生产包里也没有任何测试专用的 provider 代码。

**测试构建与生产构建只有两处差别**（`npm run build:e2e`，即 `wxt build --mode e2e`，产物在 `.output/chrome-mv3-e2e`）：

1. manifest 增加 `host_permissions: ["http://127.0.0.1/*", "http://localhost/*"]`，因为 Playwright 点不了工具栏和右键菜单，拿不到 activeTab；
2. SW 在 `globalThis.__yipieE2E.openPanel(tabId)` 上暴露与图标、快捷键相同的触发入口（只在该模式编译进去）。

`check-manifest` 断言生产产物里这两样都不存在（扫描全部脚本）；`verify-release` 在阶段 6 再查一遍。

**在内容脚本的上下文里断言**：E2E 通过 SW 调用 `chrome.scripting.executeScript({ func })`，函数运行在与内容脚本相同的隔离世界，用来验证「读不到 `storage.local`」这类约束。

**不做的事**：不为「覆盖率数字」写测试；不用测试去验证第三方库；不用 E2E 覆盖本该用单测覆盖的纯逻辑。

## 7. 数据契约、升级与兼容

**信封**：每个 key 独立存 `{ version, data }`。版本跟着 payload 走，没有全局迁移计数器——一个 key 的升级不会被另一个 key 卡住，也不会出现「全局版本对了，但某个 key 还是旧形状」。

**读时升级**：每个 key 有一串纯函数升级器（v1 → v2 → …）。读取时在内存里升级到当前版本；下一次写入时（在写队列内）才把新版本写回。升级器是纯函数，天然幂等，不需要单独的迁移执行器。现在所有 key 都是 v1，没有升级器；第一次真实的 schema 变更时再写第一个（挂在 `RecordDefinition.upgrade` 上）。

**什么时候升版本**：

- **加字段不升版本**：存储 schema 用 `z.looseObject`，新字段带默认值。旧数据读出来自动补上默认值；认不出的字段原样保留，所以装回旧版本再升级回来，新字段也不会丢；
- **改名、删字段、改语义才升版本**，同时写升级器和幂等测试。

**部分更新**：patch 的 schema 逐字段写 `.optional()`，不带默认值，也不从存储 schema `.partial()` 派生。派生出来的 patch 会带上默认值，保存一个字段就会把其它字段静默重置成默认值（原型环境里抓到过，阶段 0 有回归测试）。

**读取三态**：`ok` / `missing` / `invalid`。把 `invalid` 当成 `missing` 处理正是数据丢失的起点。`invalid` 必须被记录（含 zod issues），并让用户可见地降级。

| 情形                       | 处理                                                                                                                                                                         |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 单条记录坏（列表里的一行） | 隔离到 `unrecognized`（id 与前面某行重复的也算），不参与业务、设置页不显示，写回时原样放在已识别的行之后（阶段 2 起，`platform/storage/list-repo.ts`）                       |
| 整个值坏（不是信封，或不符合 schema） | 本次降级为默认值，写日志（含 zod issues），设置页给出提示。用户下一次保存要覆盖它之前，先把原值连同时间追加到隔离键 `<区域>:quarantine:<key>`（例如 `local:quarantine:general-settings`，一个列表，同一个 key 只保留最近 3 份；隔离键本身损坏时，它的原值也作为一份留在列表里）；设置页可查看、导出、手动删除（阶段 2） |
| 存储里的版本比当前代码新   | 该 key 只读：不覆盖、不猜测，提示用户（可能是降级安装）。repo 拒绝写入，RPC 返回 `read-only`                                                                                 |
| 未知 / 已废弃的 key        | 不自动删除；清理必须是显式的升级步骤，并记在 CHANGELOG                                                                                                                       |
| 导入时全部无法识别         | 整体拒绝并报错，不做「部分成功」                                                                                                                                             |

**原则**：任何路径都不允许静默删除或覆盖用户数据。删除只有一种来源——用户的显式操作。

**存储分区**（键常量定义在 `contract/**`，业务代码不写裸字面量）

| 区域              | 内容                                                   | 谁能读 / 谁能写                                                  |
| ----------------- | ------------------------------------------------------ | ---------------------------------------------------------------- |
| `storage.local`   | 通用设置、模型列表、Prompt 列表、默认项、隔离备份      | 扩展页面与 SW 可读；只有 SW 写；内容脚本无权访问                 |
| `storage.session` | 注入登记（tabId → nonce 与页面键）、面板快照（每段对话一个键 `session:snapshot:<id>`，另有索引 `session:snapshots`，供全局 LRU 与按标签页删除） | 扩展页面与 SW 可读；只有 SW 写；内容脚本默认无权访问             |

## 8. 安全与隐私清单

每个阶段结束时过一遍，与本阶段相关的项必须仍然成立：

- [ ] **RPC 调用方策略**：发送方必须是本扩展（`sender.id`）；调用方类型（由 `sender.url` 的协议与路径、`sender.tab`、`frameId` 判定）必须在该方法的白名单内；调用方是面板时，除 `panel.attach` 外还须是本 tab 已接上的文档；入参通过 zod 解析。内容脚本只能调用登记握手和「打开设置页」；配置变更与导出只接受设置页，例外逐条列在 `contract/rpc.ts`（如面板里切换默认模型、面板记录 `stream_options` 降级）
- [ ] **凭据隔离**：`storage.local` 只对扩展页面开放，且 fail closed：浏览器确认之前不处理 RPC、不注入内容脚本，确认失败时拒绝（下一次请求再重试）；凭据不进内容脚本、不进日志、不进快照（阶段 3 起：快照只有回答与追问，没有正文与 Prompt，E2E 断言存储里没有 Key）；面板只拿到正在用的那个模型的 Key，且只含请求所需的字段（阶段 2 起，`models.current`）；导出时默认剔除（阶段 2 的备份导出起：`apiKey`、`headers` 与 `baseURL` 的查询参数，勾选后才包含；设置页的备份预览一律不显示）。展示给用户的错误详情按配置里的全部凭据脱敏（Key、每个请求头的值、base URL 的查询参数，不论长短）；日志里的 URL 只记 origin：base URL 的查询参数可能带 key，页面 URL 可能带 token
- [ ] **不加 `externally_connectable`**：一旦加上，发送方校验就从「纵深防御」变成「唯一屏障」，需要重新评估
- [ ] **面板嵌入校验**：`panel.html` 以 `use_dynamic_url` 暴露，是唯一的 web 可访问资源；面板只在后台登记过的标签页里工作。任何得知其 URL 的页面都能加载它，所以「是面板页」本身证明不了什么：后台只为已接上的面板文档服务。面板读写的对话只属于它自己的标签页和挂载时的页面（阶段 3 起，`snapshot.get` / `snapshot.save` 不带这两个参数）；iframe 只把 `clipboard-write` 授予扩展自己的 origin
- [ ] **Markdown 注入面**：
  - `html` token 一律转义；
  - `link` 只放行 `http(s)` / `mailto` 并转义，悬停时显示真实目标；
  - `image` 不渲染 `<img>`，只输出转义后的 alt 文本（模型输出受页面影响，渲染图片等于让页面驱动一次真实的外发请求）；
  - 引用占位符只在文本上下文里替换。

  回归用例至少包括：原始 HTML、`[x](javascript:…)`、实体编码的 `javascript:`、`data:` 链接、`![<img src=x onerror=…>](javascript:…)`、远程图片、引号逃逸、位于属性内的引用占位符
- [ ] **扩展页面 CSP 纵深防御**：`extension_pages` 额外设置 `img-src 'self' data:`、`frame-src 'none'`、`form-action 'none'`、`base-uri 'none'`、`object-src 'none'`。即使渲染管线出了漏洞，也加载不了远程图片、嵌不了框架、提交不了表单
- [ ] **不自动请求第三方资源**：页面内容不得触发任何新请求（包括相对路径命中被访站点）
- [ ] **模型没有任何工具**：页面内容一律视为不可信数据
- [ ] **权限最小化**：与附录 C 一致；新权限必须先写理由
- [ ] **无遥测、无第三方统计**：任何「顺手加个上报」的提议都按产品决定处理，默认拒绝
- [ ] **依赖审计**：`npm audit` 的已知告警逐条记录处置理由（有修复的升级，无修复的记录影响面），不为了清零而盲目降级或替换依赖
- [ ] **内容脚本只做它需要做的事**：外壳、提取、定位；不读取无关 DOM，不采集页面元数据

## 9. 性能与体积预算

口径：minified、未压缩（Chrome 解析的就是这个体积），1 kB = 1000 字节。依赖体积有两种来源：标「实测」的，是阶段 0 的构建产物按 source map 归因到各个包的结果；其余是 2026-10-13 用 rolldown 单独打包的估计值。两者有出入时以实测为准，阶段 0 的实测明显比估计大（zod 80–85 kB 对 56 kB，React 一系 219 kB 对 190 kB）。

| 指标                                 | 预算                       | 依据 / 当前                                                                                         | 由什么看守          |
| ------------------------------------ | -------------------------- | --------------------------------------------------------------------------------------------------- | ------------------- |
| `background.js`                      | < 150 kB                   | 阶段 3 实测 139.61 kB，预算的 93%（阶段 2 为 128.84 kB，阶段 1 为 116.72 kB，阶段 0 为 100.88 kB，其中 zod 84.66 kB）；SW 不含 UI 与模型请求代码。其中约 12.1 kB 是整张消息表（见下） | CI（阶段 0 起）     |
| 内容脚本 `injected.js`               | < 100 kB                   | 阶段 3 实测 52.85 kB（阶段 2 为 49.68 kB，阶段 1 为 45.48 kB）：Readability、外壳、提取；不含 React 与 zod；增加的部分全是消息表（见下） | CI                  |
| 扩展页面的共享 chunk                 | < 450 kB                   | 阶段 3 实测 334.14 kB（阶段 2 为 325.63 kB，阶段 1 为 318.91 kB）：react-dom、react、scheduler、zod 与共用代码（阶段 0 实测 react-dom 207.00 kB、zod 79.88 kB） | CI                  |
| `panel` 入口（不含共享 chunk）       | < 150 kB                   | 阶段 3 实测 70.48 kB（阶段 2 为 61.98 kB）：marked、eventsource-parser、客户端、Markdown 管线、面板与对话控制器 | CI                  |
| 整包 `.output/chrome-mv3`            | < 900 kB                   | 阶段 3 实测 628.95 kB（阶段 2 为 596.14 kB；其中设置页入口 22.14 kB）；按各项估算，完成后约 700–800 kB | CI                  |
| SW 冷启动引入的静态资源              | 不得出现 > 100 kB 的新资源 | 无词表                                                                                              | review + 体积报告   |
| 外壳可见（注入 → 外壳出现）          | < 50 ms                    | 阶段 1：脚本里约 4 ms；E2E 里约 18–22 ms（含 Playwright 往返）                                      | 阶段 1 基准；E2E 只设宽松上限 |
| 面板可交互（注入 → 面板就绪）        | < 300 ms                   | 阶段 1：E2E 里约 150–175 ms（接上并读完模型配置，含 Playwright 往返）；阶段 3：热启动 139–152 ms（先读快照，再读模型、Prompt 与设置）。浏览器里第一次打开面板约 350–400 ms，阶段 2 的 `main` 上同样如此，只是此前没有单独记录                               | 阶段 1 基准，记录不卡 CI |
| 单测总时长                           | < 10 s                     | 阶段 3 实测约 5.9 s（49 文件 / 592 用例；阶段 2 约 4.5 s）                                          | CI 时长             |
| E2E 单场景                           | < 60 s                     | 阶段 3 实测每条约 0.7–3 s（47 条共约 57 s）                                                       | Playwright timeout  |

阶段 1 结束时用实测值校准过一次：各入口都远低于预算，预算不变；「面板可交互」定为 300 ms。之后要上调必须在附录 F 写明理由。

阶段 0 的观察：zod 占 `background.js` 的 84%，SW 里其余部分只有约 16 kB。阶段 1–3 还会往 SW 里加注入、触发、快照，如果 `background.js` 逼近预算，第一个要评估的是 contract 改用 `zod/mini`（可摇树，按用到的校验器计体积），然后才是别的办法。

阶段 2 的观察：消息表（`domain/i18n/zh.ts`）整张打进每个用到 `t()` 的包。阶段 2 加了设置页的文案，表从约 4.8 kB 涨到约 9 kB，SW 与内容脚本各多出约 4 kB，而它们实际只用到两三条。仍在预算内（SW 已到预算的 85%）；阶段 6 加英文表之前，先按上下文拆分消息表（内容脚本与 SW 只带自己用到的条目），否则这两处各要再涨约 9 kB。

阶段 3 的观察：面板的文案让消息表涨到约 12.1 kB，SW 到了预算的 93%，而 SW 实际只用到四五条（受限页面提示、右键菜单标题、内置 Prompt 的名称）。阶段 4 还要加错误分类的文案和 SW 代码，所以拆分消息表提前到阶段 4 开头做，预计 SW 与内容脚本各省约 11 kB；仍然不够时，再按上面说的评估 `zod/mini`。

超预算时的处理顺序：先看是不是引入了大的静态数据（词表、图标集、全量语言包）；其次看是不是把只有某个入口需要的依赖打进了别的入口；**最后**才考虑换实现。注意 SW 不能使用动态 `import()`，「改成懒加载」这条路对 SW 不存在。

## 10. 风险登记表

| #   | 风险                                                                              | 影响                                     | 缓解                                                                           | 状态     |
| --- | --------------------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------ | -------- |
| 1   | TypeScript 7 与类型感知 lint 目前只能二选一                                       | 想升 TS 7，就得放弃最有价值的一类规则    | 停在 TS 6.x；上游放宽 `typescript-eslint` 的 peer 范围后重评                   | 已接受   |
| 2   | ESLint 10 暂不可用（`jsx-a11y` 未声明支持）                                       | 停在 9.x，会收到 maintenance 警告        | 记录在 `AGENTS.md`；等上游                                                     | 已接受   |
| 3   | 部分页面无法嵌入扩展 iframe（COEP、严格 CSP），或从嵌入式 iframe 请求本地地址受限 | 这些页面上面板不可用，或本地模型不可用   | Chromium 141 已验证：严格 CSP 不影响；COEP 页面靠 `credentialless` 解决；本地网络访问不拦有主机权限的面板。仍保留 D4 的推翻条件 | 待复核（当前稳定版、Edge） |
| 4   | OpenAI 兼容服务的实现差异（usage、推理字段、错误格式、`stream_options`）          | 用量缺失、推理内容混进正文、错误不可读   | 附录 D 矩阵 + 语料 + 假服务；`stream_options` 自动降级                         | 阶段 4   |
| 5   | 自写客户端低估了边界情况                                                          | 部分服务流式异常                         | 语料驱动；D2 的推翻条件                                                        | 待观察   |
| 6   | 页面移除或隐藏面板宿主                                                            | 面板消失                                 | MutationObserver 重挂；关键样式内联并加 `!important`；剩下的情形记为已知限制   | 部分无解 |
| 7   | 触发路径（图标、右键菜单、快捷键）无法自动化测试                                  | 这部分的回归只能靠人发现                 | 附录 H 手工冒烟清单，相关阶段与每次发版各跑一次                                | 已接受   |
| 8   | 快照配额被占满                                                                    | 新对话保存失败                           | 全局预算 6 MB + 跨标签页 LRU + 单页上限 512 kB；被驱逐的对话留下记号；保存失败在面板里可见（阶段 3 落地，有单测） | 已缓解   |
| 9   | 本地服务拒绝扩展来源，或静默截断超长输入（例如 Ollama）                           | 本地模型不可用，或总结不完整             | 错误提示给出 `OLLAMA_ORIGINS` 的设置方法；设置页提示如实填写上下文窗口         | 已记录   |
| 10  | 范围蔓延（再加 provider、侧边栏、工具调用、全站权限）                             | 硬约束被一点点侵蚀                       | §1.2 非目标与 §11 已决事项；任何扩展都先改本文                                 | 待观察   |

## 11. 已决事项与开放问题

**已决事项（2026-10-13）**

| 事项                 | 决定                                                                                     |
| -------------------- | ---------------------------------------------------------------------------------------- |
| 界面形态（D4）       | 页面内的扩展 iframe 浮动面板（v3 误记为侧边栏，v4 已更正）                               |
| 工具栏图标           | 点击后直接在页面里打开面板并开始总结，不要 popup                                         |
| 换页后的访问权（D3） | 靠图标、右键菜单或快捷键再触发；不做全站权限开关，也不做按站点授权                       |
| 请求客户端（D2）     | 自写（你没有偏好，按建议）                                                               |
| 阶段 0               | 原型代码未保留，在本仓库重做                                                             |
| 仓库与许可证         | 公开仓库，MIT                                                                            |
| 分发                 | 只发 GitHub Release                                                                      |
| 浏览器               | 只做 Chrome / Edge                                                                       |
| 界面语言             | 中文 + 英文，设置里可切换                                                                |

**开放问题**：暂无。新问题出现时追加在这里，并附我的建议。

## 12. 工作方式

**推进方式**：每次按「契约 → 平台 → 壳 → 测试 → 文档」的顺序做**一个纵切片**，每个切片都能独立跑通、通过闸门、独立提交。不做「先铺完所有文件再接线」的大提交。

**我每阶段交付什么**

1. 改动摘要（哪些文件、为什么）
2. **实跑证据**：命令与输出（`gate` / `build` / `e2e` 的执行结果），失败或跳过的项明确写出来
3. 已知限制与没做的事
4. 下一阶段的入口，以及需要你决定的问题

**我需要你提供的**

- **手工验证**：真实 API Key 的调用、附录 H 的冒烟清单，由你执行并反馈结果；我不会读取、保存或写入你的密钥
- **新的开放问题的决定**：出现时追加在 §11

**我不会做的**：不运行 `npm run dev`（常驻进程，需要时通知你手动跑）；不为了让闸门变绿而放宽规则、跳过测试或加类型抑制。

## 附录 A —— 目标目录结构（阶段 6 时预期）

```
src/
  contract/      唯一事实来源：schema + 类型 + 信封版本 + RPC 方法表（含允许的调用方）；按文件引用，不设汇总导出
    storage.ts · general-settings.ts · model-config.ts · prompt-config.ts · selection.ts
    mutations.ts · backups.ts · page-context.ts · panel-registry.ts · snapshot.ts · commands.ts
    rpc.ts · rpc-wire.ts（不依赖 zod，内容脚本能用）
  domain/        纯函数，零环境依赖，必须能在 node 里 100% 单测
    token-estimate.ts · patch.ts · budget.ts · page-key.ts · url.ts · list-mutations.ts
    origins.ts · credentials.ts · model-form.ts · prompt-form.ts
    prompt/{default-prompt,render,messages}.ts · llm/{request,stream,errors,usage}.ts
    i18n/**
  platform/      唯一允许调用浏览器 API 的层；括号内是允许运行的上下文
    storage/{types,tx,repo,list-repo,quarantine,wxt-store,access-level,index}.ts
                                                             （写：SW；读：SW 与扩展页面）
    storage/watch.ts                                         （扩展页面：变化的信号，值仍经 RPC 读）
    rpc/{messaging,server,errors,caller-policy}.ts           （SW）
    rpc/client.ts                                            （扩展页面）
    rpc/lite-client.ts                                       （内容脚本，不带 zod）
    settings/{general-settings,model-configs,prompt-configs,config-list,backups}-service.ts
                                                             （SW）
    permissions/origin-access.ts                             （申请与查询：设置页；回收：SW）
    triggers/{action,context-menu,commands}.ts               （SW）
    inject/{inject,registry,page-context}.ts                 （SW）
    snapshot/{store,tab-closed}.ts                           （SW）
    llm/client.ts                                            （面板、设置页）
    extract/{readability,listener,dom-heuristic,flatten}.ts  （内容脚本）
    panel-host/{host,orphan}.ts                              （内容脚本）
    locate/scroll-to-text.ts                                 （内容脚本）
    runtime/settings-page.ts                                 （扩展页面）
    logger/index.ts                                          （各上下文）
  features/      与界面绑定的逻辑（React 组件、状态、渲染管线），只在扩展页面里运行
    panel/** · markdown/** · settings/** · theme/**
  entrypoints/   薄壳，只做装配
    background/index.ts · injected.ts（内容脚本）· panel/** · options/**
tests/           Vitest（node 为主，组件测试逐文件 opt-in jsdom）；fixtures/sse/** 为兼容语料
e2e/             Playwright（真实 Chromium + 构建产物）；fake-llm/ 为本地假服务
scripts/         check-manifest.ts · check-bundle-budget.ts · verify-release.ts · lib/（判定逻辑，有单测）
docs/            development-plan.md（本文）
```

分层方向由 ESLint 强制：`contract → domain → platform → features → entrypoints`。运行上下文边界同样由 ESLint 强制（§2.2）。

## 附录 B —— 命名与提交规范

- **文件 / 目录**：kebab-case；一个文件一个明确职责；契约文件与存储 key 一一对应
- **导出**：类型与运行时值同名导出（`export const X = z.object(...)` + `export type X = z.infer<typeof X>`）
- **RPC 方法**：`<领域>.<动作>`（例如 `models.add`、`panel.attach`）；在 `contract/rpc.ts` 登记时同时声明允许的调用方
- **storage key**：一律带 `local:` / `session:` 前缀，常量定义在 `contract/**`，业务代码不写裸字面量
- **提交信息**：`type(scope): 说明`，type ∈ `feat / fix / refactor / test / docs / chore / perf / ci`；正文说「为什么」，中文可
- **分支**：`main` 为主；开发用 `feat/<主题>`；发布打 tag `v<version>`
- **测试文件**：`tests/<层>/<被测文件>.test.ts`，与源码路径同构，改了实现该改哪个测试一眼可见

## 附录 C —— 权限与 manifest 清单

`scripts/check-manifest.ts` 以本表为准（清单写在 `scripts/lib/manifest-policy.ts`，与本表同一提交修改）：产物 manifest 里多出或缺少任何一项，CI 都会失败。

| 项                                                                    | 用途                                                              | 去掉会怎样                         | 引入阶段 |
| --------------------------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------- | -------- |
| `permissions: storage`                                                | 设置、模型、Prompt、快照                                          | 什么都存不了                       | 0        |
| `permissions: activeTab`                                              | 用户触发时，临时获得当前标签页的访问权                            | 只能改用全站权限注入               | 1        |
| `permissions: scripting`                                              | 用 `executeScript` 按需注入；用 `insertCSS` 注入高亮样式          | 面板无法注入                       | 1        |
| `permissions: contextMenus`                                           | 右键菜单「用一瞥总结此页」（阶段 3）；「总结选中内容」在阶段 5 加入；菜单项在安装或更新时创建 | 只能通过图标或快捷键触发           | 3        |
| `optional_host_permissions: https://*/*, http://*/*`                  | 按 origin 运行时申请模型服务的访问权，只申请用户配置过的 origin    | 只有本身允许浏览器跨域的服务可用   | 1        |
| `web_accessible_resources: panel.html`（`use_dynamic_url: true`）     | 在页面里嵌入面板 iframe                                           | 面板无法出现在页面中               | 1        |
| `action`（不设 `default_popup`）                                      | 点图标触发 `action.onClicked`，在页面里打开面板                   | 少了主要的触发方式                 | 1        |
| `commands`（manifest 键，不是权限）                                   | 快捷键触发，同时会授予 activeTab；默认 `Alt+Shift+Y`，可在 `chrome://extensions/shortcuts` 改 | 少一种触发方式                     | 1        |
| `content_security_policy.extension_pages`                             | 纵深防御（§8）                                                    | 渲染管线出漏洞时没有第二道防线     | 1        |

**明确不要的**：

- `host_permissions`；
- 静态 `content_scripts`；
- `tabs`（不需要读取任意标签页的 URL）；
- `sidePanel`（D4 选的是页面内面板）；
- `declarativeNetRequest*`（有 host 权限时，扩展页面的请求本来就不受 CORS 限制）；
- `externally_connectable`；
- `unlimitedStorage`。

E2E 构建（`--mode e2e`）额外带 `host_permissions: http://127.0.0.1/*, http://localhost/*`，只给测试用；生产构建里出现它，check-manifest 就会失败（§6）。

## 附录 D —— OpenAI 兼容服务的已知差异

| 差异                                   | 常见情形                                                                         | 处理                                                                                                 |
| -------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 流式响应默认不带 `usage`               | 遵循 OpenAI 规范的服务                                                           | 默认发送 `stream_options: { include_usage: true }`                                                   |
| 不认识 `stream_options`，直接返回 400  | 部分老网关 / 代理                                                                | 识别后关闭该配置的这一项，重试一次并记住（阶段 4）                                                    |
| 推理内容的字段不统一                   | `delta.reasoning_content`、`delta.reasoning`，或以 `<think>…</think>` 混在正文里 | 统一归一为推理流；折叠显示，不进快照、不进复制                                                        |
| SSE 注释行 / 心跳                      | 部分服务在排队或处理时发送注释行                                                 | 解析器忽略内容，但算作「有数据」，用来重置空闲看门狗                                                  |
| 200 流中途发来错误事件                 | 部分聚合服务                                                                     | 视为错误，保留已经收到的内容                                                                          |
| 错误体格式不统一                       | `{"error":{message,type,code}}`、纯文本、网关的 HTML 页                          | 尽力解析；截断后展示原文摘要                                                                          |
| 超长上下文                             | 400 + `context_length_exceeded` 或类似文案；本地服务可能静默截断                 | 归为「超长」；对本地服务，在设置页提示如实填写上下文窗口                                              |
| 拒绝 `chrome-extension://` 来源        | Ollama 默认返回 403                                                              | 错误提示给出 `OLLAMA_ORIGINS=chrome-extension://*`                                                   |
| 首字节很慢                             | 本地模型冷加载、长 Prompt 预填充、推理模型                                       | 首字节超时与流中空闲超时分开设置，前者默认更宽                                                        |
| `max_tokens` / `temperature` 的兼容性  | OpenAI 推理模型要求 `max_completion_tokens`，且不接受自定义温度                  | 默认都不发送；需要时由用户写进 extraBody                                                              |
| base URL 写法不一                      | 漏写 `/v1`、多贴了 `/chat/completions`                                           | 去掉末尾的 `/chat/completions` 与斜杠；不自动补 `/v1`（不是所有服务都用它），测试连接失败时给出提示   |

阶段 4 的手工验证结果（服务、日期、结论）追加在本表之后。

## 附录 E —— 阶段 0 的实测数据

**本仓库（2026-10-13，阶段 0 完成时）**

| 检查                          | 命令                     | 结果                                                                                                   |
| ----------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------ |
| 类型检查 + 单测 + lint + 格式 | `npm run gate`           | 通过（`Test Files 13 passed` / `Tests 89 passed`，单测 1.38 s）                                        |
| 构建                          | `npm run build`          | 通过，`Σ Total size: 407.85 kB`；`background.js` 100.88 kB，`chunks/options` 304.32 kB                 |
| 产物权限面                    | `npm run check:manifest` | 通过：`permissions: ["storage"]`，没有 host 权限、内容脚本和 web 可访问资源                             |
| 体积预算                      | `npm run check:bundle`   | 通过；基线写在 `.output/bundle-report.json`，按包的归因见 §9                                           |
| E2E（真实 Chromium 加载扩展） | `npm run test:e2e`       | 3 条通过（CI 上共 2.9 s）。环境搭建见 `AGENTS.md`「开发环境备注」                                      |
| CI                            | quality 工作流           | 第一次运行就全绿，用时约 1 分钟：[run 38466798577](https://github.com/lonemoonspace/YiPie/actions/runs/38466798577) |
| E2E 稳定性                    | 单条重复跑 `--repeat-each` | 第 3 次 CI 运行暴露了一个竞态：Playwright 报告 SW 时，浏览器可能还没把扩展 API 装进去（`chrome` 里只有 `csi`、`loadTimes`）。本地重复 40 次复现 3 次；fixture 改为等到 `chrome.storage.local` 可用后，重复 80 次全部通过 |
| 检查真的会拦                  | 故意违规后再撤回         | 反向分层、绕过写入口、SW 引用 React 或 features、`eslint-disable`、`any` 都被 lint 拦下；多加 `tabs` 与 `host_permissions` 时 check:manifest 失败；塞进 1 MB 文件时 check:bundle 失败（整包 1407.41 kB）；撤回后全部通过 |

**原型环境（参考，代码没有保留）**

| 检查                          | 命令                                  | 结果（2026-10-13）                                        |
| ----------------------------- | ------------------------------------- | --------------------------------------------------------- |
| 类型检查 + 单测 + lint + 格式 | `npm run gate`                        | 通过（`Test Files 4 passed` / `Tests 20 passed`）         |
| 构建                          | `npm run build`                       | 通过，`Σ Total size: 377.60 kB`，`background.js 77.90 kB` |
| 产物权限面                    | 读 `.output/chrome-mv3/manifest.json` | `permissions: ["storage"]`，无 `host_permissions`         |
| E2E（真实 Chromium 加载扩展） | `npm run test:e2e`                    | 通过                                                      |

原型环境里测试抓到的两个真缺陷，在本仓库都有回归测试：设置的 patch 会静默重置其它字段；emoji 断言区分不了「按码点」和「按 UTF-16 单元」迭代。

## 附录 F —— 本文档变更记录

| 日期       | 变更 |
| ---------- | ---- |
| 2026-10-13 | v1 初版：阶段 0 小结与证据、阶段 1–6 计划、DoD / 测试策略 / 迁移 / 安全 / 预算 / 风险 / 开放问题 |
| 2026-10-13 | v2，主要改动：<br>· 只支持 OpenAI 兼容接口（D1）；不用 AI SDK，自写客户端（D2）<br>· 面板改为扩展 iframe，模型请求在面板文档内发起，删掉 v1 的「流式通道」阶段（D4）<br>· 阶段改为纵切片，阶段 1 就交付可用版本；体积预算按入口重定，并提前到阶段 1 进 CI<br>· RPC 增加调用方策略；`storage.local` 限制为只有扩展页面可读<br>· 迁移改为逐 key 读时升级 + 隔离备份，去掉全局 `MIGRATION_VERSION`<br>· E2E 改用本地假服务，生产代码里不再放 mock provider<br>· 按全新项目重写，去掉与旧项目的对比和配置迁移<br>· 新增附录 C（权限清单）、D（兼容差异）、G（开发环境） |
| 2026-10-13 | v3：把界面改为浏览器侧边栏。这是误记——D4 的选择是 B（页面内扩展 iframe），见下一行 |
| 2026-10-13 | v4，更正 v3 并落实 §11 的已决事项：<br>· D4 恢复为页面内扩展 iframe 面板；浏览器侧边栏列为被否决方案，并作为「页面无法嵌入 iframe」时的退路<br>· 去掉 popup：点图标直接在页面里打开面板并开始总结；受限页面在图标上提示<br>· 换页后靠图标、右键菜单或快捷键再触发，不做全站权限与按站点授权（D3）<br>· D2 补充原型实测（110 行、5.4 kB）<br>· 阶段 0 改为在本仓库重做，原型环境的数据移到附录 E 作参考；manifest 与体积检查提前到阶段 0<br>· 开放问题全部关闭，改为「已决事项」；只发 GitHub Release，只做 Chrome / Edge，界面中英文可切换<br>· 新增附录 H（触发路径手工冒烟清单） |
| 2026-10-13 | v4.1，阶段 0 完成：<br>· §3、§4.1 标记完成，补上阶段小结；附录 E 换成本仓库的实测数据，原型数据保留作参考<br>· 交付物按实际调整：隔离备份（`quarantine.ts`）从阶段 2 提前到阶段 0；不设 `contract/index.ts` 汇总导出；检查脚本改用 TypeScript（`scripts/*.ts`）<br>· §2.2：SW 的运行上下文边界在阶段 0 落地（ESLint），内容脚本的规则随阶段 1 加入<br>· §4.2：新增 `contract/rpc-wire.ts`，让内容脚本拿通道名时不带上 zod<br>· §4.3：隔离备份的查看、导出、删除归入阶段 2 的验收<br>· §7：隔离键改为每个 key 一个列表 `<区域>:quarantine:<key>`；写明「加字段不升版本」和 patch 的写法<br>· §9：换成构建产物按 source map 归因的实测值。zod 与 React 都比估计大，预算不变；记下 `zod/mini` 作为 SW 逼近预算时第一个评估的办法<br>· 附录 B 增加提交类型 `ci`；附录 G 已迁入 `AGENTS.md`<br>· 凭据隔离改为 fail closed（PR 审阅意见）：§2.2、§4.1 小结、§8 写明浏览器确认之前不运行 RPC handler、确认失败就拒绝；§4.2 的注入与验收加上「先等隔离闸门」 |
| 2026-10-14 | v4.2，阶段 1 实现完成（待手工验证）：<br>· **技术验证**（Playwright 自带的 Chromium 141，用一次性的手写扩展做实验）：<br>　1）严格 CSP（含 `frame-src 'none'`）的页面能嵌入 `use_dynamic_url` 的 `panel.html`；带 `Cross-Origin-Embedder-Policy: require-corp` 或 `credentialless` 的页面不能，在 manifest 声明 `cross_origin_embedder_policy` 也不行，给 iframe 加 `credentialless` 后可以，且 `chrome.storage`、消息、主机权限的跨域豁免都照常（连 COOP + COEP 完全跨源隔离的页面也行）；面板消息的 `sender.url` 是扩展的固定 id，`documentId` 可用；页面用固定 URL 嵌入面板只得到错误页<br>　2）把 https 测试页设为公网地址（`--ip-address-space-overrides`）：面板对 `http://localhost` 的流式请求成功，带不带 CORS 头都行；同一页面自己的脚本请求 localhost 被「本地网络访问」拦下，关掉该功能后才通过，说明限制开着、只是不管有主机权限的扩展面板<br>　3）按 tab 设置的角标与标题在跨文档导航、刷新时由 Chrome 清除，因此不监听 `tabs.onUpdated`（否则每次页面加载都会唤醒 SW）<br>　4）含端口的匹配模式（`http://localhost:11434/*`）能被 `permissions.contains` 接受，也能匹配更宽的授权<br>　5）就绪与体积见 §9<br>· **与交付物表的出入**：内容脚本入口叫 `injected.ts`（WXT 会把 `content.ts` 写进 manifest）；面板经 `models.list` 读模型配置，不直接读 `storage.local`；nonce 在 `content.hello` 时签发，页面删掉宿主后能换新的；错误分类 v0 加了超时与流中错误；正文长度上限放在 `platform/extract`<br>· §2.1、§2.2、§6、§9（预算不变，「面板可交互」定为 300 ms）、§10 风险 3、附录 A、C、H 同步更新<br>· **PR #2 审阅意见**（3 项安全问题，已修复）：1）后台只为已接上的面板文档服务，此前 `models.list` 对任何 `panel.html` 文档都开放，只靠面板代码不在接上前调用；2）错误详情按配置里的全部凭据脱敏（Key、每个请求头的值、base URL 的查询参数），短 key 不再跳过；浏览器不会发送的请求头（`Cookie`、`Host`、`Proxy-*`、`Sec-*` 等）在保存时拒绝；3）日志里的 URL 只记 origin。§2.1、§2.2、§4.2、§8、§9 同步 |
| 2026-10-14 | v4.3，阶段 1 手工反馈、阶段 2 完成：<br>· **阶段 1**：你在自己的浏览器里装上试用，没有大问题，启动速度好；「真实 Key 总结一次」完成。Edge 与当前 Chrome 稳定版上的复核、附录 H 的逐项冒烟没有单独反馈，并入阶段 3 的手工轮次；阶段 1 标为完成<br>· **阶段 2 与交付物表的出入**：没有单独的 selection 服务，模型与 Prompt 共用 `config-list-service`，默认项同在 `local:selection`；内置 Prompt 不在安装时写入，而是列表还没写过时它就是列表的内容，第一次变更时一起写下（从阶段 1 升级的用户同样有它）；`mutations.ts` 只放更新、删除、移动、设为默认的入参<br>· **阶段 2 定下的细节**（§4.3）：id 重复的行也算认不出；默认项缺失时用首项，只在变更会让它变化时写下，只读时整次变更拒绝；移动是相对的一步；编辑只发送改过的字段；访问权在 SW 里、同一个队列槽内回收，认不出的行也算引用；模板占位符允许空格，`{{language}}` 阶段 5 前固定为简体中文，截断说明附在 `{{content}}` 末尾；备份预览不显示凭据，导出默认剔除；面板经新增的 `models.current` 只拿到菜单与正在用的那个模型的 Key（`models.list` 只给设置页），模型菜单经 `models.choose` 写默认项，是面板唯一的变更<br>· **PR #3 审阅意见**（3 项，已修复）：1）列表由更新版本写入时，`setDefault` 绕过只读、仍能写默认项；2）面板收到的模型配置复用了 `z.looseObject` 的 `ModelConfig`，存储行上的未知字段会进入面板，改为逐字段映射的 `PanelModelConfig`；3）快速连续切换模型的竞态：回调不认新旧，且两个选择可能乱序入队，改为一次只发一个、只认最新的<br>· §2.1、§2.2、§7、§8、§9（实测值；消息表整张进 SW 与内容脚本，阶段 6 前拆分）、附录 A、附录 H（一项可选的访问权回收检查）同步更新 |
| 2026-10-15 | v4.4，阶段 3 自动化部分完成（待手工冒烟）：<br>· **与交付物表的出入**（§4.4）：快照每段对话一个键，另有小索引记字节数、最近使用时间与「已驱逐」标记；页面键由后台从 `content.hello` 的 `sender.url` 算出，记在面板登记表里，`snapshot.get` / `snapshot.save` 不带标签页和页面参数；对话控制器从 hook 里独立出来（`features/panel/conversation.ts`），串行只认最新的发送抽成 `latest-only.ts`，保存也用它；新增 `settings.current`（面板只拿裁剪策略）；repo 加 `removeUnqueued`；右键菜单标题为「用一瞥总结此页」；提取上限从 6 万字放宽到 20 万字，由面板按预算裁剪<br>· **定下的细节**（§4.4）：回答预留为窗口的四分之一（1,024–8,192 tokens），没填窗口按 64,000 估算并写明；只裁正文，Prompt 与历史放不下时不发送；策略名表示截掉哪一部分，默认 `back`；「裁剪后重试」只给被拒的「不裁剪」请求，超长按 400 / 413 / 422 加措辞识别（429 不算）；回答完成或停止时已有内容才算数；换模型改为用新模型重做最近一轮；全局 6 MB、单页 512 kB，被驱逐的对话留下记号；关标签页删除快照与登记；视图跟随追问的回答<br>· **修了阶段 1 留下的问题**：面板 iframe 的 `allow="clipboard-write"` 默认只授予动态 URL 的 origin，而面板文档以扩展的固定 origin 提交，一直没生效；改为写明扩展的 origin<br>· **E2E 环境的已知问题**：Playwright 的视口模拟下，离视口底部约 100 px 以内对跨站 iframe 的鼠标点击会丢，普通跨站 iframe 同样如此；追问用键盘发送，点按钮的那条把视口调高，附录 H 加一项鼠标点击的手工确认<br>· **范围调整**：拆分消息表从阶段 6 提前到阶段 4 开头（SW 已到预算的 93%，见 §9），写进 §4.5<br>· **PR #4 审阅意见**（3 项，已修复）：1）面板离开后，在途保存与换模型的结果仍会派发到面板，换模型还会再发起一次请求；2）恢复还在等待时，用户新发起的总结会被恢复出的旧对话覆盖，重复打开同理；3）重新总结或重做后，旧对话的保存仍可能先于新状态落库，刷新会恢复已经清掉的内容。改为：等待中的步骤只属于发起它的那次操作；保存带本面板的序号立即发出，后台按面板文档与序号只留最新的；重新总结与重做立即保存新状态（§4.4 细节 7、8）<br>· §2.1、§3、§6、§7、§8、§9、§10 风险 8、附录 A、C、H 同步更新 |

## 附录 G —— 开发环境备注（已迁入 `AGENTS.md`）

无 root 沙箱里跑 E2E 的步骤不属于路线图，已迁入 `AGENTS.md` 的「开发环境备注」。CI 不需要这些步骤：`quality.yml` 用 `npx playwright install --with-deps chromium` 装齐依赖。

## 附录 H —— 触发路径手工冒烟清单

Playwright 点不了工具栏图标和右键菜单，以下各项在对应阶段结束时与每次发版前，在 Chrome 与 Edge 上各跑一次，结果写进 CHANGELOG。

**阶段 1 的准备**：`npm ci && npm run build`，在 `chrome://extensions`（Edge 是 `edge://extensions`）打开开发者模式，「加载已解压的扩展程序」选 `.output/chrome-mv3`；在扩展的「扩展程序选项」里填一个模型并保存，浏览器提示授权时选允许。顺带复核阶段 1 的技术验证：至少用一个本地模型（例如 Ollama 的 `http://localhost:11434/v1`，需要 `OLLAMA_ORIGINS=chrome-extension://*`）在一个 https 公网页面上总结一次。

| 阶段起 | 操作                                       | 期望                                                                 |
| ------ | ------------------------------------------ | -------------------------------------------------------------------- |
| 1      | 在普通文章页点工具栏图标                   | 页面里出现面板，并开始流式总结                                       |
| 1      | 按快捷键                                   | 同上                                                                 |
| 1      | 总结进行中点面板的关闭按钮                 | 面板消失，请求随之结束，没有报错                                     |
| 1      | 在 `chrome://`、应用商店等受限页面点图标   | 不注入；图标上出现角标，悬停提示「此页面无法总结」                   |
| 1      | 刷新页面后再点图标                         | 面板重新出现（阶段 3 起恢复上次对话）                                |
| 2      | （可选）在设置页删除最后一个使用某个服务的模型 | 扩展详情页「网站访问权限」里不再列出这个服务；还有别的模型用它时仍在。E2E 做不到（§4.3） |
| 3      | 在页面空白处右键，选「用一瞥总结此页」     | 面板出现，并开始总结（本页已有对话时恢复）                           |
| 3      | 总结并追问后刷新，再点图标                 | 恢复两轮对话，不重新总结；状态栏显示「已恢复上次的对话」             |
| 3      | 用鼠标点面板底部的追问框，输入后点「发送」 | 能输入，点击即发送。E2E 在这里只能用键盘（§4.4 阶段小结）            |
| 3      | 点回答下面的「复制」，粘贴到别处           | 粘贴出的是这条回答的 Markdown 原文                                   |
| 3      | 关闭标签页后，在新标签页打开同一页并触发   | 重新总结，不恢复关掉的那个标签页里的对话                             |
| 5      | 点引用标记                                 | 页面滚动到原文并高亮                                                 |
| 5      | 选中一段文字，右键「总结选中内容」         | 只总结选中的部分                                                     |
