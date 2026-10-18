# tools（开发期工具，不随包发布）

这些脚本**不进入 npm 包**（`plugin/package.json` 的 `files` 白名单没有包含它们），
放在仓库里是为了让改动可复现、可复查。

## 日常会用的

| 脚本 | 用途 |
|---|---|
| `smoke-client.mjs` | **必跑**。用最小 React/DOM 桩真正执行 `client.js` 的 factory + `apply()`。`node --check` 查不出「语法合法但导入即崩」（比如 CSS 模板里一个反引号提前闭合了字符串） |
| `check-live-settings.mjs` | **只读**地检查真实 profile 里的配置：哪些字段缺失或非法。默认不写；要修复必须显式 `--force`，且只补缺失项 |
| `find-backticks.mjs` | 定位 CSS 模板字符串里多余的 `` ` `` |
| `repro-import.mjs` | 复现「导入即崩」并把报错行号映射回源码行 |
| `prepare-publish.mjs` | 补齐 npm 发布所需元信息（author / repository / prepublishOnly 等） |

## 一次性迁移脚本（已执行完，保留作历史记录）

这些是某个版本改架构时的批量改动工具，**不需要再运行**：

`drop-surfaces.mjs`、`drop-scan-calls.mjs`、`finish-v5.mjs`、`finish-v7.mjs`、
`fix-paint.mjs`、`merge-watchers.mjs`、`relabel-glaze.mjs`、`tune-defaults.mjs`、
`tune-glass.mjs`、`update-harness-labels.mjs`

> 它们按当时的源码文本做精确匹配，现在源码已经变了，直接运行会抛「no match」——
> 这是预期行为，不是 bug。

## 一次性迁移脚本（改机器状态，谨慎）

| 脚本 | 说明 |
|---|---|
| `migrate-profile.mjs` | 把真实 profile 从 `dsh-skin` 迁移到 `dsh-glaze`（改 package.json、node_modules junction、配置行 id、壁纸目录）。**只跑过一次**；重复运行是幂等的，但会动真实 profile，跑前请确认 |
