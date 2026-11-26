# 参与贡献 · Contributing

[中文](#中文) · [English](#english)

## 中文

感谢你愿意帮助一瞥变得更好。

### 提问题与建议

- **Bug**：在 [Issues](https://github.com/lonemoonspace/YiPie/issues) 里写明浏览器与版本、一瞥的版本（`chrome://extensions` 里能看到）、复现步骤、期望与实际结果。截图很有帮助，但请先遮住 API Key 和网址里的敏感参数。
- **功能建议**：说清楚你想解决的问题，而不只是想要的做法。
- **安全问题**：不要公开提 Issue，按 [SECURITY.md](SECURITY.md) 私下报告。

### 提交代码

1. Fork 仓库，从 `main` 拉一个分支。
2. 需要 Node 22.18 或更高版本：`npm ci`。
3. 改代码，并为新行为补测试。架构分层、存储与 RPC 约定见 [AGENTS.md](AGENTS.md)，很多约束由 ESLint 和 CI 强制检查。
4. 提交前运行 `npm run gate`（类型检查、单测、lint、格式检查），必须全绿；改了界面或交互，再跑 `npm run build:e2e && npm run test:e2e`。
5. 提交信息用 `type(scope): 说明`，type 是 `feat / fix / refactor / test / docs / chore / perf / ci` 之一。用户能感知的变化，记进 `CHANGELOG.md` 的 `[Unreleased]`。
6. 开 PR，说明改了什么、为什么改、怎么验证的。CI 会跑完整的质量检查。

### 新增权限

一瞥坚持最小权限。新增 manifest 权限或主机权限需要在 PR 里说明理由，并同步修改 `docs/development-plan.md` 附录 C 与 `scripts/lib/manifest-policy.ts`。

## English

Thanks for helping make YiPie better.

### Issues and ideas

- **Bugs**: open an [issue](https://github.com/lonemoonspace/YiPie/issues) with your browser and version, the YiPie version (shown in `chrome://extensions`), steps to reproduce, and what you expected versus what happened. Screenshots help, but hide API keys and sensitive URL parameters first.
- **Feature ideas**: describe the problem you want solved, not only the solution you have in mind.
- **Security issues**: please don't open a public issue. Report them privately as described in [SECURITY.md](SECURITY.md).

### Pull requests

1. Fork the repository and branch from `main`.
2. Use Node 22.18 or later and run `npm ci`.
3. Make your change and add tests for new behavior. Layering, storage and RPC conventions are in [AGENTS.md](AGENTS.md) (in Chinese); many of them are enforced by ESLint and CI.
4. Run `npm run gate` (type check, unit tests, lint, format check) before committing; it must pass. For UI or interaction changes, also run `npm run build:e2e && npm run test:e2e`.
5. Write commit messages as `type(scope): summary`, with a type from `feat / fix / refactor / test / docs / chore / perf / ci`. Add user-visible changes to `[Unreleased]` in `CHANGELOG.md`.
6. Open a pull request explaining what changed, why, and how you tested it. CI runs the full quality workflow.

### New permissions

YiPie keeps its permissions minimal. A new manifest or host permission needs a justification in the PR and matching updates to appendix C of `docs/development-plan.md` and `scripts/lib/manifest-policy.ts`.
