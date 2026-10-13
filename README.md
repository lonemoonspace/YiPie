# 一瞥 YiPie

用你自己配置的 OpenAI 兼容模型服务，在浏览器侧边栏里总结当前网页，并能就这一页继续追问。

- 只支持 OpenAI Chat Completions 兼容接口：OpenAI、DeepSeek、OpenRouter、Ollama、vLLM 等，填 base URL、Key 和模型名即可
- 数据只在浏览器和你自己的模型服务之间流动：没有中间服务器，没有遥测
- 安装时不申请任何站点权限；只在你点工具栏图标、右键菜单或按快捷键时读取当前页
- 支持 Chrome / Edge

## 当前状态

规划阶段，还没有可用版本。路线图、技术决定与验收标准见 [docs/development-plan.md](docs/development-plan.md)。

## 许可证

[MIT](LICENSE)
