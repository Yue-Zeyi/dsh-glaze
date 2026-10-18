# 安装与启用

> 本文是给**已经拿到 `plugin/` 目录**的人的安装步骤。
> 功能说明见 [../README.md](../README.md)。

## 当前状态（本机）

已经为你装好了。确认信息：

| 项目 | 值 |
|---|---|
| 插件位置 | `C:\Users\Administrator\Documents\deepseek-harness\default-workspace\dsh-glaze\plugin` |
| profile | `C:\Users\Administrator\.dsh\profiles\desktop` |
| `node_modules\dsh-glaze` | Junction → 插件目录（软链，不复制） |
| `package.json` | `dsh.profile.bundles` 含 `dsh-glaze`；`dependencies` 含 `link:...` |
| `cordis.patch.yml` | 含 `- id: dsh-glaze` 行与默认配置 |
| Host 半边 | **已热加载成功**（`GET /dsh-glaze/state` → 200） |
| Client 半边 | **需要重启一次 Harness** 才会出现在设置里 |

备份文件（如需回滚）：
- `~/.dsh/profiles/desktop/package.json.dsh-glaze-bak`
- `~/.dsh/profiles/desktop/cordis.patch.yml.dsh-glaze-bak`

---

## 第一次启用：重启 Harness

关闭 DeepSeek Harness，再重新打开。

重启后：

1. 打开 **设置**（左下角「更多」→ 设置，或 `Ctrl+,`）
2. 左侧应出现 **皮肤** 这一项
3. 点 **选择图片…**，挑一张背景图即可

> 为什么必须重启一次？客户端插件清单在页面启动时固化在
> `window.__DSH_BOOT__` 里。Host 半边（HTTP 路由、配置 schema）能被 HMR 热加载，
> 但新的**客户端** bundle 要被引导图收录，必须重新走一次页面启动。

---

## 从零安装到另一个 profile

```powershell
$pluginDir = 'C:\Users\Administrator\Documents\deepseek-harness\default-workspace\dsh-glaze\plugin'
$profile   = "$env:USERPROFILE\.dsh\profiles\desktop"

# 1) package.json：加入 bundle 与 link 依赖
node -e @"
const fs=require('fs');
const p='$($profile -replace '\\','/')/package.json';
const pkg=JSON.parse(fs.readFileSync(p,'utf8'));
if(!pkg.dsh.profile.bundles.includes('dsh-glaze')) pkg.dsh.profile.bundles.push('dsh-glaze');
pkg.dependencies['dsh-glaze']='link:$($pluginDir -replace '\\','/')';
fs.writeFileSync(p, JSON.stringify(pkg,null,2)+'\n');
"@

# 2) 让 node_modules 能解析到它（任选其一）
#    a) pnpm install（推荐，走正常依赖解析）
cd $profile; pnpm install
#    b) 或直接建 junction（无需联网，立即可用）
cmd /c mklink /J "$profile\node_modules\dsh-glaze" "$pluginDir"

# 3) 在 cordis.patch.yml 末尾追加配置行
Add-Content "$profile\cordis.patch.yml" @"

- id: dsh-glaze
  name: dsh-glaze
  config:
    enabled: true
    frosted: true
    opacity: 35
    blur: 22
    scrim: 10
    dim: 0
    fit: cover
    position: center
"@

# 4) 重启 Harness
```

> 从 npm 装包时不需要手写这一段：包自带的 `cordis.patch.yml` 会自动插入这一行。
> 上面的写法只在「用 link 指向本地目录」时才需要手动补。

---

## 验证安装成功

```powershell
# Host 半边是否在跑（应返回 200 + JSON）
Invoke-WebRequest http://127.0.0.1:59813/dsh-glaze/state -UseBasicParsing | Select-Object -Expand Content

# 期望输出类似：
# {"present":false,"revision":0,"generation":0,"mime":null,"name":null,"bytes":0}

# 插件文件是否已进入 profile
node -e "console.log(require('C:/Users/Administrator/.dsh/profiles/desktop/package.json').dsh.profile.bundles)"
```

在 GUI 里：**设置 → 皮肤** 能看到页面 = Client 半边也成功了。

---

## 卸载 / 回滚

```powershell
$profile = "$env:USERPROFILE\.dsh\profiles\desktop"

# 1) 还原配置备份
Copy-Item "$profile\package.json.dsh-glaze-bak" "$profile\package.json" -Force
Copy-Item "$profile\cordis.patch.yml.dsh-glaze-bak" "$profile\cordis.patch.yml" -Force

# 2) 去掉链接
Remove-Item "$profile\node_modules\dsh-glaze" -Force -Recurse

# 3) 可选：删掉已保存的壁纸与设置
Remove-Item "$env:USERPROFILE\.dsh\dsh-glaze" -Recurse -Force -ErrorAction SilentlyContinue

# 4) 重启 Harness
```

---

## 常见问题

**设置里没有「皮肤」**
Client 半边没加载。先确认重启过 Harness；再确认 `package.json` 的
`dsh.profile.bundles` 里有 `dsh-glaze`，且 `node_modules/dsh-glaze` 存在。

**页面上滑杆能拖，但重启后回到默认值**
说明 Host 的 `Config` 字段没有 `.volatile()`。检查 `index.js` 的 `Config` 定义——
Harness 的 settings 只把 volatile 字段当成可编辑/可持久化字段。

**拖动滑杆时提示「保存失败，已回退到上次的取值」**
有更高优先级的配置层（`$DSH_HOME/cordis.patch.yml` 或命令行 `--patch`）也在设置
同一个字段。Harness 会拒绝这种「写进去也会被立即覆盖」的写入。把那一层里
`dsh-glaze` 的 config 删掉即可。

**背景图没显示**
- 检查 `GET /dsh-glaze/state` 是否 `"present":true`
- 检查「启用皮肤」开关是否打开
- 如果界面不透明度是 100%，背景图会被完全挡住——调低它

**图片存到哪儿了？**
`%USERPROFILE%\.dsh\dsh-glaze\wallpaper.<ext>`，旁边的 `meta.json` 记录元信息。
删除这个目录等于清空壁纸（设置值仍留在 profile 里）。
