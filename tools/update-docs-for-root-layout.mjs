/**
 * Update the docs after the package moved from plugin/ to the repository root.
 *
 * The bulk path rewrite in the restructure script only handled real paths
 * ("...\dsh-glaze\plugin"); these are prose references to the directory in tree
 * diagrams and "run this in plugin/" style instructions.
 *
 * Run:  node tools/update-docs-for-root-layout.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'

const ROOT = new URL('../', import.meta.url)

const EDITS = [
  // docs/INSTALL.md — this doc is for people who were handed a plugin/ folder
  [
    'docs/INSTALL.md',
    '> 本文是给**已经拿到 `plugin/` 目录**的人的安装步骤。',
    '> 本文是给**已经拿到这个仓库**的人的安装步骤。包本体就在仓库根目录。',
  ],
  // docs/PUBLISH.md — commands now run at the repo root
  ['docs/PUBLISH.md', '在 `plugin/` 目录：', '在**仓库根目录**：'],
  [
    'docs/PUBLISH.md',
    '建议把整个仓库推到 GitHub（`plugin/` 保持在子目录里也行）：',
    '把整个仓库推到 GitHub 即可（包就在仓库根，这样别人才能直接用仓库地址安装）：',
  ],
  [
    'docs/PUBLISH.md',
    `├── plugin/          ← 包本体（package.json 在这里）
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
└── screenshots/`,
    `├── package.json     ← 包清单（必须在仓库根，git 安装就靠它）
├── index.js         Host 半边
├── client.js        客户端半边
├── cordis.patch.yml 配置行 patch
├── README.md        ← npm 页面与 GitHub 首页显示这个
├── preview.png
├── LICENSE
├── icon.svg
├── test-host.mjs
├── docs/            ← 不发布
│   ├── PUBLISH.md   （本文件）
│   ├── INSTALL.md
│   ├── TECHNICAL.md
│   └── contract-spec.md
├── tools/           ← 发布前自检脚本，不发布
├── harness/         ← 测试实例驱动，不发布
└── screenshots/     ← 不发布`,
  ],
  // docs/TECHNICAL.md — structure diagram and test commands
  [
    'docs/TECHNICAL.md',
    '把 `plugin/` 目录放到任意位置，然后按方式 A 用 `link:<该目录绝对路径>` 挂进 profile。',
    '把仓库放到任意位置，然后按方式 A 用 `link:<仓库根绝对路径>` 挂进 profile。',
  ],
  ['docs/TECHNICAL.md', 'node plugin/test-host.mjs       # Host 半边，29 项', 'node test-host.mjs              # Host 半边，29 项'],
]

let changed = 0
for (const [file, from, to] of EDITS) {
  const url = new URL(file, ROOT)
  let text
  try {
    text = readFileSync(url, 'utf8')
  } catch {
    console.log('skip (missing):', file)
    continue
  }
  if (!text.includes(from)) {
    console.log('skip (no match):', file, '->', from.slice(0, 40))
    continue
  }
  writeFileSync(url, text.split(from).join(to), 'utf8')
  changed += 1
}
console.log(`updated ${changed} doc edits`)
