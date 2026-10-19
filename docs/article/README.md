# 公众号文章素材

正文在 [`wechat.md`](./wechat.md)，配图在 [`images/`](./images/)。

## 图片清单

| 文件 | 尺寸 | 用在正文哪里 |
|---|---|---|
| `cover.png` | 1410×600（2.35:1） | **不是正文图**，是公众号后台的「封面」 |
| `fig-05-compare.png` | 1824×785 | 「它和调透明度的区别」一节，全文最重要的一张 |
| `fig-01-light.png` | 1800×1125 | 开头引入 |
| `fig-02-dark.png` | 1800×1125 | 深色主题 |
| `fig-03-settings.png` | 1800×1125 | 设置页 |
| `fig-04-stock.png` | 1800×1125 | 「关掉就恢复原样」 |

正文里的顺序是：封面（后台上传）→ fig-01 → fig-05 → fig-02 → fig-03 → fig-04。

## 怎么发

1. **封面**：公众号后台「封面」处上传 `cover.png`。微信会按 2.35:1 裁切，这张已经是这个比例，不会被裁掉字。
2. **正文**：公众号编辑器不认 Markdown。两种做法：
   - **推荐**：用 [Md2All](https://md2all.douban.fm/) 或 秀米 的 Markdown 导入，把 `wechat.md` 整篇粘进去，再把图片逐个替换成上传后的微信图。
   - 或者直接在编辑器里排版，对着 `wechat.md` 抄文字，图片手动插入。
3. **图片**：微信不允许正文引用外链图片，必须在本地上传。上传时用原图（不要勾「压缩」），这组图是按 1800px 宽做的，在手机上足够清晰。
4. **代码块**：`https://github.com/...` 那两段建议用编辑器的「代码」样式，或直接正文加粗，别用引用块（手机上左右边距会很窄）。

## 发布前检查

- [ ] 三处仓库地址一致：`https://github.com/Yue-Zeyi/dsh-glaze`
- [ ] 标题从三个备选里挑了（或自己改了）
- [ ] 摘要（公众号「摘要」栏）填一句，例如：*给 DeepSeek Harness 换壁纸，并让界面真的透出一层毛玻璃。开源，MIT。*
- [ ] 文章末尾的免责声明保留（第三方插件、与官方无关）

## 配图是怎么来的

全部由脚本生成，可复现：

```powershell
$py = "C:\Users\Administrator\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe"

# 1) 生成两张壁纸（纯渐变，不含任何个人内容）
& $py tools/article/make-wallpapers.py

# 2) 用隔离的测试实例截图（不会碰真实 Harness）
.\harness\start-test-instance.ps1 -PluginPath (Get-Location).Path
node tools/article/capture-article-shots.cjs

# 3) 缩放 + 拼对比图 + 生成封面
& $py tools/article/compose-figures.py

.\harness\stop-test-instance.ps1
```

目录职责：

| 目录 | 内容 | 是否入库 |
|---|---|---|
| `tools/article/assets/` | 生成的壁纸 | 是（截图要用） |
| `tools/article/raw/` | 2x 原始抓图 | 否，已 gitignore |
| `docs/article/images/` | 成品图 + 封面 | 是 |

> 截图用的是自己生成的渐变壁纸，**不是**本机正在用的那张个人照片——避免把私人内容带进公开文章。
