# 隐私政策 · Privacy Policy

一瞥 YiPie 浏览器扩展 · 生效日期 2026-10-16 · [English below](#english)

## 简体中文

一瞥把你正在看的网页交给**你自己配置的** OpenAI 兼容模型服务，并在页面上显示回答。开发者不运营任何服务器，也收不到你的任何数据。

### 扩展处理哪些数据

| 数据 | 什么时候 | 去向 |
| --- | --- | --- |
| 当前网页的正文、标题与网址（或你选中的文字） | 只在你点工具栏图标、右键菜单或按快捷键时读取 | 只发给你在设置里配置的模型服务，用来生成这一次的总结；正文本身不保存 |
| 你在面板里输入的追问 | 你发送时 | 同上，发给你配置的模型服务 |
| 模型配置：Base URL、API Key、请求头、模型名等 | 你在设置页保存时 | 只存在本机浏览器的扩展存储（`storage.local`），只有扩展自己的页面能读；请求模型服务时随请求发给那个服务 |
| Prompt 与通用设置（主题、字号、语言等） | 你在设置页保存时 | 只存在本机浏览器的扩展存储 |
| 对话记录（回答与追问） | 每次回答完成后 | 只存在本机浏览器的会话存储（`storage.session`），关闭标签页或关闭浏览器后删除；不含网页正文、Prompt 和任何凭据 |

### 扩展不做的事

- 没有遥测、统计或崩溃上报；不使用任何第三方分析服务。
- 不把数据发给开发者或除你配置的模型服务以外的任何人；不出售、不转让你的数据，也不用于广告、信用评估或与总结网页无关的用途。
- 不在后台读取网页：没有常驻的站点权限，也没有自动注入的脚本。
- 不加载远程代码，不在回答里加载图片等外部资源。
- 日志只写在本机浏览器的开发者控制台，不含 API Key，也不含完整网址。

### 你的模型服务

网页内容会发给你选择的服务（例如 OpenAI、DeepSeek、OpenRouter，或本机的 Ollama）。那个服务如何处理这些数据，由它自己的隐私政策决定，与本扩展无关。访问某个服务地址的权限，在你保存这个模型配置时由浏览器向你申请；不再有配置使用它时，扩展会自动交还。

### 导出与删除

- 设置页的导出默认**不含** API Key、请求头与 Base URL 的查询参数，只有你勾选后才包含。
- 在设置页删除模型或 Prompt 即删除对应数据；卸载扩展会删除扩展存储里的全部数据。

### 联系

问题或疑虑请在 [GitHub Issues](https://github.com/lonemoonspace/YiPie/issues) 提出。本政策如有变化，会更新在本页并注明生效日期。

---

## English

YiPie sends the web page you are reading to an OpenAI-compatible model service **that you configure yourself**, and shows the answer on the page. The developer runs no servers and receives none of your data.

### What the extension handles

| Data | When | Where it goes |
| --- | --- | --- |
| The current page's text, title and URL (or the text you selected) | Only when you click the toolbar icon, use the context menu or press the shortcut | Only to the model service you configured, to produce that summary; the page text itself is not stored |
| Follow-up questions you type in the panel | When you send them | Same as above |
| Model configurations: base URL, API key, headers, model name | When you save them in the settings | Only in the browser's extension storage on your device (`storage.local`), readable only by the extension's own pages; sent to that service with each request to it |
| Prompts and general settings (theme, font size, language) | When you save them | Only in the browser's extension storage on your device |
| Conversations (answers and follow-ups) | After each answer | Only in the browser's session storage (`storage.session`), deleted when the tab or the browser closes; never the page text, the prompt or any credential |

### What the extension does not do

- No telemetry, analytics or crash reporting; no third-party analytics of any kind.
- It sends nothing to the developer or to anyone other than the model service you configured. Your data is not sold or transferred, and not used for advertising, creditworthiness or anything unrelated to summarizing the page.
- It does not read pages in the background: it holds no standing site access and injects no scripts on its own.
- It loads no remote code, and loads no images or other external resources from answers.
- Logs go only to the browser's developer console on your device, without API keys or full URLs.

### Your model service

Page content goes to the service you choose (for example OpenAI, DeepSeek, OpenRouter, or Ollama on your own computer). How that service handles it is governed by its own privacy policy. The browser asks you for access to a service's address when you save a configuration that uses it; the extension gives that access back once no configuration uses it.

### Export and deletion

- Exports from the settings page leave out API keys, headers and base-URL query parameters unless you tick the box to include them.
- Deleting a model or prompt in the settings deletes it; uninstalling the extension deletes everything in its storage.

### Contact

Questions or concerns: [GitHub Issues](https://github.com/lonemoonspace/YiPie/issues). Changes to this policy are published on this page with a new effective date.
