# 一瞥 YiPie

用你自己配置的 OpenAI 兼容模型服务，在页面上的浮动面板里总结当前网页，并能就这一页继续追问。

- 只支持 OpenAI Chat Completions 兼容接口：OpenAI、DeepSeek、OpenRouter、Ollama、vLLM 等，填 base URL、Key 和模型名即可
- 数据只在浏览器和你自己的模型服务之间流动：没有中间服务器，没有遥测
- 安装时不申请任何站点权限；只在你点工具栏图标、右键菜单或按快捷键时读取当前页
- 支持 Chrome / Edge

## 当前状态

阶段 0（骨架）已完成：扩展能加载，设置页目前只有主题和日志级别两项，**还不能总结网页**。第一个可用版本在阶段 1 结束时出现。路线图、技术决定与验收标准见 [docs/development-plan.md](docs/development-plan.md)。

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
