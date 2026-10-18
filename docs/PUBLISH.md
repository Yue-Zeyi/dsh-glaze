# 发布指南

把这个插件发布出去，让别人能直接装上。

---

## 1. DSH 认什么

两件事决定了「别人能不能装」：

| 机制 | 内容 |
|---|---|
| **分发方式** | 发布到 **npm**。DSH 的插件管家会探测 `registry.npmjs.org` 与 `registry.npmmirror.com`（取最先返回 2xx 的源），然后按包名安装 |
| **插件声明** | 包必须在 `package.json` 里声明 `dsh.bundle.patch`，指向自带的 YAML patch。DSH 的官方文档原话：*"A bundle is a package whose `package.json` declares `dsh.bundle.patch`"* |

这两条 `dsh-glaze` 都已经满足：

```json
{
  "name": "dsh-glaze",
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "platform": "web", "immediately": true, "inject": ["..."] }
  }
}
```

配置行由包里的 `cordis.patch.yml` 自动插入，用户**不需要手写任何配置**。

> 关键点：patch 里的行 `id` 必须全局唯一（这里是 `dsh-glaze`）。`id` 同时是配置存
> 放的位置，改了它等于换了一套设置。

---

## 2. 发布前置

```powershell
npm login                    # 或 npm adduser
npm whoami                   # 确认已登录
npm config get registry      # 应为 https://registry.npmjs.org/
```

需要 npm 账号并开启 **2FA**（发布时会被要求输入一次性验证码）。

**包名已确认可用**（未占用时会返回 404）：

```powershell
npm view dsh-glaze version   # 现在返回 404 = 名字空着
```

---

## 3. 发布前自检

在 `plugin/` 目录：

```powershell
# a) 静态与导入期检查（CSS 模板完整性 + factory 真跑一遍）
node ../tools/smoke-client.mjs

# b) Host 半边单元测试
node test-host.mjs

# c) 看真正会被打进去的文件
npm pack --dry-run
```

`npm pack` 的清单应该是这 9 个（`files` 白名单控制，harness / tools / screenshots 不会进去）：

```
LICENSE  README.md  preview.png  client.js  index.js  cordis.patch.yml  icon.svg  test-host.mjs  package.json
```

打包体积约 **75 kB**，解包 **155 kB**。

`prepublishOnly` 已经配好，`npm publish` 时会自动先跑测试 —— **测试不过就发布不出去**：

```json
"prepublishOnly": "node test-host.mjs && node --check index.js && node --check client.js && node ../tools/smoke-client.mjs"
```

---

## 4. 版本号

用 semver。当前 `0.14.0`，`0.x` 阶段表示「外观与配置字段还可能调整」：

| 改动 | 版本 |
|---|---|
| 修 bug | `0.14.1` |
| 加设置项 / 新功能 | `0.15.0` |
| 改配置字段名、删设置项（会重置用户配置） | `0.16.0` 起，且要在 README 写明 |
| 觉得稳定了，愿意长期兼容配置 | 升 `1.0.0` |

```powershell
npm version patch   # 或 minor / major，会自动改 package.json 并打 git tag
```

---

## 5. 发布

```powershell
cd plugin
npm publish
```

`publishConfig.access = "public"` 已设置，非 scoped 包本来也默认 public。

发布完立刻验证：

```powershell
npm view dsh-glaze                       # 能看到版本与依赖信息
npm view dsh-glaze dist.tarball          # 能拿到 tarball 地址
```

---

## 6. 别人怎么装

### A. 通过插件管家（最省事）

DSH 插件管家 / 市场里搜索 `dsh-glaze`，安装后**重启 Harness**。

### B. 手动装进 profile

```powershell
$profile = "$env:USERPROFILE\.dsh\profiles\desktop"
cd $profile
npm install dsh-glaze --save-exact

node -e "const fs=require('fs');const p='package.json';const pkg=JSON.parse(fs.readFileSync(p,'utf8'));if(!pkg.dsh.profile.bundles.includes('dsh-glaze'))pkg.dsh.profile.bundles.push('dsh-glaze');fs.writeFileSync(p,JSON.stringify(pkg,null,2)+'\n')"
```

然后重启 Harness。设置页会出现 **外观** 一节。

### C. 从 GitHub 装（还没发 npm 时）

```powershell
npm install github:Yue-Zeyi/dsh-glaze --save-exact
```

需要仓库根就是包根（即 `package.json` 在仓库根），否则要写成
`github:Yue-Zeyi/dsh-glaze#subdirectory=plugin`。

---

## 7. 更新与回滚

```powershell
npm deprecate dsh-glaze@0.14.1 "有 bug，请升级到 0.14.2"   # 标记某版本弃用（推荐）
npm unpublish dsh-glaze@0.14.1                             # 删除单个版本（72 小时内）
npm unpublish dsh-glaze --force                            # 删整包，慎用
```

> npm 的策略：发布 **72 小时**内可以完全删除；超过之后只能 `deprecate`，或者发一个新版本。
> 所以发布前一定先跑 `npm publish --dry-run`。

---

## 8. 仓库与文档

建议把整个仓库推到 GitHub（`plugin/` 保持在子目录里也行）：

```
dsh-glaze/
├── plugin/          ← 包本体（package.json 在这里）
│   ├── README.md    ← npm 页面显示这个
│   ├── preview.png
│   ├── LICENSE
│   ├── index.js     Host 半边
│   ├── client.js    客户端半边
│   └── cordis.patch.yml
├── docs/
│   ├── PUBLISH.md   （本文件）
│   ├── INSTALL.md
│   └── contract-spec.md
├── tools/           ← 发布前自检脚本，不发布
├── harness/         ← 测试实例驱动，不发布
└── screenshots/
```

`package.json` 里已经填好：

```
author      YueZeyi
repository  git+https://github.com/Yue-Zeyi/dsh-glaze.git
homepage    https://github.com/Yue-Zeyi/dsh-glaze#readme
bugs        https://github.com/Yue-Zeyi/dsh-glaze/issues
```

**如果仓库地址不是这个，发布前务必改掉**，否则 npm 页面的链接全是死的。

---

## 9. 安全与合规

发布前值得替用户想一遍：

- **壁纸不上传**。图片存在用户本机的 `$DSH_HOME/dsh-glaze/`，插件只在本机 HTTP 路由里读它。
- **路由有信任围栏**。`/dsh-glaze/*` 只接受 loopback 与受信来源，并拒绝跨站请求。这是防
  DNS-rebinding / 跨站，不是认证；README 里已写明。
- **上传有上限**。32 MB，超了直接拒。
- **不静默改设置**。只有设置页的控件会写配置；插件启动时只读。
- **MIT 许可**，`LICENSE` 随包发布。

---

## 10. 发布清单

```
[ ] npm whoami 确认登录、开了 2FA
[ ] npm view dsh-glaze 返回 404（名字还空着）
[ ] repository / homepage / bugs 指向真实仓库
[ ] node ../tools/smoke-client.mjs 通过
[ ] node test-host.mjs 通过
[ ] npm pack --dry-run 清单里没有 harness/ tools/ screenshots/
[ ] README 里的安装步骤和当前配置字段一致（没有已删除的选项）
[ ] 版本号已按 semver 调整
[ ] npm publish
[ ] npm view dsh-glaze 能看到
[ ] 在一台干净机器 / 新 profile 上按第 6 节装一遍，确认设置页出现「外观」
```
