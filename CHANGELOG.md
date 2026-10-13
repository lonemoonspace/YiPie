# 更新日志

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循语义化版本。尚未发布任何版本。

## [Unreleased]

### 阶段 0：骨架

- 分层骨架：contract → domain → platform → features → entrypoints，ESLint 强制依赖方向和「SW 不含界面代码」，不允许 `eslint-disable` 与 `any`
- 存储：带版本的信封、唯一写队列、读取三态（ok / missing / invalid）；覆盖无法识别的数据前自动备份；更新版本写入的数据只读
- 后台 RPC：每个方法在方法表登记，声明允许的调用方；入参与出参都经过校验
- 凭据隔离：`storage.local` 只对扩展自己的页面开放，内容脚本读不到
- 设置页：主题（浅色 / 深色 / 跟随系统）与日志级别，经后台保存，刷新后仍在
- CI：gate、构建、manifest 与计划附录 C 比对、体积预算、E2E（真实 Chromium）
- 原型环境里抓到的两个缺陷已写成回归测试：保存一个设置字段会重置其它字段；emoji 断言区分不了「按码点」和「按 UTF-16 单元」计数
