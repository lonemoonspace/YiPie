# 安全政策 · Security Policy

[中文](#中文) · [English](#english)

## 中文

### 支持的版本

只有最新发布的版本（[Latest release](https://github.com/lonemoonspace/YiPie/releases/latest)，与 Chrome 应用商店、Edge 加载项商店上的版本相同）会收到安全修复。

### 报告漏洞

请**不要**在公开的 Issue 里描述漏洞。请在本仓库的 **Security** 标签页点 **Report a vulnerability**，通过 GitHub 私下报告。

请尽量写明：受影响的版本、复现步骤或概念验证、可能造成的影响。我们会在 7 天内回复，确认问题后尽快发布修复版本，并在发布说明里致谢（除非你希望匿名）。

### 我们特别关心

- API Key 或其他凭据泄露给模型服务以外的任何一方
- 网页内容能够冒充扩展或模型的指令、越过面板的隔离
- 扩展在用户没有触发时读取网页
- 模型输出被渲染成可执行的脚本或可加载外部资源的 HTML

## English

### Supported versions

Only the latest release ([Latest release](https://github.com/lonemoonspace/YiPie/releases/latest), the same version as on the Chrome Web Store and Edge Add-ons) receives security fixes.

### Reporting a vulnerability

Please **do not** describe vulnerabilities in public issues. Report them privately through GitHub: open the **Security** tab of this repository and click **Report a vulnerability**.

Please include the affected version, steps to reproduce or a proof of concept, and the potential impact. We aim to respond within 7 days, ship a fix as soon as the issue is confirmed, and credit you in the release notes unless you prefer to stay anonymous.

### What we care about most

- API keys or other credentials leaking to anyone other than the configured model service
- Page content impersonating instructions to the extension or model, or escaping the panel's isolation
- The extension reading a page without a user action
- Model output being rendered as executable script or HTML that loads external resources
