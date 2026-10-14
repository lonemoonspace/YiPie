# 一瞥 YiPie

用你自己配置的 OpenAI 兼容模型服务，在页面上的浮动面板里总结当前网页，并能就这一页继续追问。

- 只支持 OpenAI Chat Completions 兼容接口：OpenAI、DeepSeek、OpenRouter、Ollama、vLLM 等，填 base URL、Key 和模型名即可
- 数据只在浏览器和你自己的模型服务之间流动：没有中间服务器，没有遥测
- 安装时不申请任何站点权限；只在你点工具栏图标、右键菜单或按快捷键时读取当前页
- 支持 Chrome / Edge

## 当前状态

阶段 2（配置管理）已完成：可以配置多个模型与多个 Prompt 并选默认项，在面板里切换模型；存储里认不出的数据不会丢，覆盖前留下的备份可以在设置页查看、导出与删除。阶段 1 已在真实服务上试用。追问、刷新后恢复、右键菜单等在后续阶段。路线图、技术决定与验收标准见 [docs/development-plan.md](docs/development-plan.md)。

## 使用

1. 按下面「开发」一节构建并加载扩展。
2. 打开扩展的设置页（`chrome://extensions` 里本扩展的「详细信息」→「扩展程序选项」），在「模型」里填 base URL（例如 `https://api.openai.com/v1`）、API Key 和模型名，保存。浏览器询问是否允许访问这个服务时，选允许。可以添加多个模型，点「设为默认」选默认的那个。
3. 在网页上点工具栏的「一瞥」图标，或按 `Alt+Shift+Y`。面板出现在页面右上角，用默认模型和默认 Prompt 开始总结；工具栏的下拉框可以换模型（换了就成为新的默认）。可以停止、重新总结，拖动标题栏移动面板，点 × 关闭。
4. 想换一种总结方式：在设置页的「Prompt」里编辑内置的「网页总结」，或新增一个并设为默认。

- 浏览器内置页面（`chrome://`、新标签页）、扩展商店等页面打不开面板，图标上会显示「!」。
- 用本地 Ollama 时，base URL 填 `http://localhost:11434/v1`；Ollama 拒绝扩展的请求时，启动前设置环境变量 `OLLAMA_ORIGINS=chrome-extension://*`。

## 开发

需要 Node 22.18 或更高版本。

```sh
npm ci
npm run gate    # 类型检查、单测、lint、格式检查
npm run build   # 产物在 .output/chrome-mv3
```

在 Chrome 打开 `chrome://extensions`，开启「开发者模式」，点「加载已解压的扩展程序」，选择 `.output/chrome-mv3`。开发约定见 [AGENTS.md](AGENTS.md)。

## 许可证

[MIT](LICENSE)
