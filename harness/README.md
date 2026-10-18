# DSH skin — visual verification harness

A repeatable way to **see** a DSH skin plugin rendered in a real DeepSeek Harness
Web GUI, without touching the running desktop app.

Three scripts and one Playwright driver give you: a disposable DSH instance with
your plugin mounted, authenticated screenshots, and a machine-readable dump of
what the page actually contains.

---

## TL;DR

```powershell
cd C:\Users\Administrator\Documents\deepseek-harness\default-workspace\dsh-glaze\harness

# 1. start a throwaway instance with the skin plugin mounted (returns in ~6 s)
.\start-test-instance.ps1 -PluginPath "C:\Users\Administrator\Documents\deepseek-harness\default-workspace\dsh-glaze\plugin"

# 2. screenshot it (7 PNGs + state JSON + console log)
.\capture.ps1

# 3. shut the instance down; the desktop app is never touched
.\stop-test-instance.ps1
```

Screenshots land in `shots\`. The authenticated URL is printed by
`start-test-instance.ps1` and also written to `state\url.txt` and
`%TEMP%\dsh-glaze-test-url.txt`.

---

## What each piece does

### `start-test-instance.ps1`

Boots a **second** `dsh web` instance that is fully isolated from the desktop app:

| concern | how it is isolated |
|---|---|
| user data | its own `DSH_HOME` (`%TEMP%\dsh-glaze-harness\home` by default) |
| profile | its own throwaway profile (`skin-test`), never `desktop` |
| port | `59821` by default, refuses to start if already bound |
| process | launched through WMI so it is re-parented outside the caller's job object; tracked by PID |
| logs | `logs\<timestamp>.out.log` / `.err.log` |
| plugin | directory-junctioned into the profile's `node_modules` (no copy, no network) |

Key parameters:

| parameter | default | meaning |
|---|---|---|
| `-PluginPath` | *(none)* | plugin package dir. Omitted, or missing `package.json` → boots a clean **baseline** GUI instead |
| `-Port` | `59821` | listen port |
| `-HomeDir` | `%TEMP%\dsh-glaze-harness\home` | isolated `DSH_HOME` |
| `-ProfileName` | `skin-test` | throwaway profile name (refuses `desktop`) |
| `-ResetHome` | off | wipe the isolated home first (clears wallpaper, settings, sessions) |

It writes the authenticated URL (with `?token=...`) to `state\url.txt` and the
server PID to `state\pid.txt`, then returns immediately — the instance keeps
running detached.

**Why no `pnpm install` is needed.** Bundle resolution in `dsh-app-boot` is
*installation-first*: every `@deepseek-ai/*` bundle resolves from the dsh
installation inside `app.asar`, not from the profile. A throwaway profile
therefore only needs a `package.json` naming the bundle list. The sole thing the
profile itself must supply is the third-party skin package — and that is
satisfied with a directory junction, so nothing is copied, installed, or
downloaded. If the junction cannot be created (cross-volume, policy), the script
falls back to a plain copy.

### `capture.ps1`

Drives an installed Chrome through the `playwright-core` copy already present in
the desktop profile's `node_modules` (nothing is installed), using the tokenized
URL from `state\url.txt`.

| step | produces |
|---|---|
| `home` | `shots\<name>-01-home.png` — home screen, first-run modals dismissed |
| `settings` | `-02-settings.png`, `-03-settings-skin.png` (Settings → 皮肤) |
| `wallpaper` | uploads a test wallpaper via `POST /dsh-glaze/upload`, shoots `-04-home-wallpaper.png`, `-05-home-wallpaper-esc.png` |
| `tune` | drives the 界面不透明度 slider (e.g. 55 → 12), shoots `-06-settings-skin-tuned.png`, `-07-home-tuned.png` |
| `scroll` | opens Settings → 皮肤 and scrolls the dialog to the bottom, shoots `-08-settings-skin-bottom.png` plus a tight `-09-skin-bottom-rows.png` crop, and records whether the last row is clipped |

`-Steps` selects a subset (`home,settings,wallpaper,tune,scroll`, or `all` — the
default). Alongside the PNGs it always writes:

- `shots\<name>-state.json` — url, html/body attributes, `style[data-plugin-css]`
  inventory, skin CSS variables, the backdrop element and its `background-image`,
  `dsh-glaze` boot-graph membership, settings nav labels, and for `scroll` the
  measured `scrollHeight`/`clientHeight`/`atBottom`/`lastRowFullyVisible`;
- `shots\console-<name>.log` — every `console.*`, uncaught `pageerror`,
  `requestfailed`, and non-2xx response.

Exit code `2` means a `dsh-glaze`-related browser problem was recorded, so the
script is usable as a regression gate.

### `stop-test-instance.ps1`

Kills **only** the PID this harness recorded, and only after re-reading that
process's command line to confirm it is the harness instance. It hard-refuses:

- the desktop host PID (or any process whose command line contains
  `dsh-desktop-host` / `--expose-internals`), and
- any PID whose command line is not
  `@deepseek-ai\dsh\lib\bin.js … --profile skin-test`.

It then clears the recorded state so a stale PID can never be reused.

### `lib\capture-driver.cjs`

The Playwright script the capture step runs. It is a separate `.cjs` file on
purpose: Windows PowerShell 5.1 decodes BOM-less UTF-8 as ANSI, which would
mangle the CJK label literals if they lived inside a `.ps1` here-string. The
driver therefore holds every non-ASCII string as a `\u` escape and stays pure
ASCII.

It **navigates first, then preflights**. That order matters: the authenticated
URL's `?token=` is what installs the session cookie, so a same-origin `fetch()`
before `page.goto` runs on `about:blank` and fails every time. After navigating,
the driver probes `/dsh-glaze/state` to distinguish three cases:

| nav | plugin route | meaning | action |
|---|---|---|---|
| 200 | 200 | healthy, plugin mounted | continue |
| 200 | 404 | healthy, plugin **not** mounted (baseline) | continue |
| 401 | any | token is stale (instance restarted) | fail with a clear message |
| — | 0 | instance unreachable | fail with a clear message |

### `ab-legibility.ps1`

Sweeps opacity/scrim/blur combinations and captures one home screen per variant
(`shots\ab-<label>-home.png`). Each variant is written into the isolated
**home** patch, which outranks the profile patch and so survives the restart.
Note that this makes the variant values non-writable from the UI while it is in
effect — use it for comparison shots, then clear the block.

---

## Prerequisites

Nothing to install. The scripts rely on what the machine already has:

- the DeepSeek Harness installation (default
  `D:\Users\Administrator\AppData\Local\Programs\DeepSeek Harness`; override with
  `-InstallDir`),
- `node` on `PATH`,
- a Chrome or Edge install (for the browser channel), and
- `playwright-core` inside the desktop profile's `node_modules` (override with
  `-PlaywrightRoot`).

Pass `-BrowserChannel msedge` to `capture.ps1` to use Edge, or `bundled` to force
Playwright's own Chromium if one has been downloaded.

### Settings is gated in a fresh home

A brand-new isolated `DSH_HOME` shows the "sign in / add an API key" onboarding
gate, which blocks the Settings dialog. The harness home patch
(`<HomeDir>\cordis.patch.yml`) unlocks it with:

```yaml
- id: ui-settings-models
  disabled: true
```

Keep that block in the home patch. Do **not** put plugin config there as well:
the home overlay outranks the profile patch, and the Host refuses a form write
that the overlay would immediately override (which surfaces as a "保存失败"
banner in the skin page).


---

## How the harness was proved

Everything below was run against the real, running installation.

1. **Baseline proof (no plugin).** A throwaway home + `skin-test` profile on port
   59821 booted a full default GUI and printed

   ```
   dsh web: http://127.0.0.1:59821/?token=...
   ```

   Captured as **`shots\00-baseline.png`** — the default home screen, no plugin
   mounted.

2. **Plugin proof.** The same flow with
   `-PluginPath …\dsh-glaze\plugin` mounted `dsh-glaze` (bundle layer inserts row id
   `dsh-glaze`; profile's `dependencies` gains
   `"dsh-glaze": "link:C:/…/dsh-glaze/plugin"`). `capture.ps1 -Steps all` then
   produced `shots\skin-01…07-*.png` with **zero** console errors and **zero**
   non-2xx responses.

3. **What the run confirmed** (all from `shots\skin-state.json` and the images):

   - `dsh-glaze` is in `window.__DSH_BOOT__.entries`;
   - `style[data-plugin-css="dsh-glaze/glaze.css"]` is injected;
   - `html` carries `class="dsh-glaze-active"`;
   - `#dsh-glaze-backdrop` and `#dsh-glaze-dim` exist, the backdrop has
     `data-visible="true"` and
     `background-image: url("http://127.0.0.1:59821/dsh-glaze/image?v=1")`;
   - `POST /dsh-glaze/upload` → `200 {"present":true,"revision":1,"mime":"image/png","name":"test-wallpaper.png","bytes":239428}`;
   - `GET /dsh-glaze/state` returns the same revision;
   - the **皮肤** item appears in Settings and opens the plugin's own section;
   - driving 界面不透明度 immediately updated the live theme variables
     (`--dsw-specific-sidebar-fill: color-mix(in srgb, #f9fafb 45%, transparent)`)
     and persisted to `dsh.profile` config.

4. **Layout proof (`-Steps scroll`).** On the final build the Settings dialog
   scroller measured `scrollHeight 1016 / clientHeight 746`; after scrolling,
   `atBottom=true`, with 11 skin rows present, the last row's bottom edge at 802px
   in a 900px viewport (`lastRowFullyVisible=true`). The bottom rows
   (填充方式 / 对齐位置 / 作用范围 / 默认 + 恢复默认值) render with no clipping and no
   horizontal scrollbar.

5. **Isolation proof.** Throughout all of the above, the desktop host (PID 16044)
   and its Electron children kept running, nothing under
   `C:\Users\Administrator\.dsh\profiles\desktop` was modified, and
   `stop-test-instance.ps1` only ever signalled the recorded harness PID.

### Screenshot index

| file | shows |
|---|---|
| `00-baseline.png` | default GUI, no plugin — the harness itself working |
| `skin-01-home.png` | plugin mounted, skin active, no wallpaper |
| `skin-02-settings.png` | Settings dialog open (translucent over the wallpaper) |
| `skin-03-settings-skin.png` | Settings → 皮肤 page, all controls |
| `skin-04-home-wallpaper.png` | wallpaper set, Settings still animating open |
| `skin-05-home-wallpaper-esc.png` | wallpaper set, clean home screen |
| `skin-06-settings-skin-tuned.png` | 皮肤 page after driving a slider |
| `skin-07-home-tuned.png` | home screen at low opacity — wallpaper clearly visible |
| `skin-08-settings-skin-bottom.png` | 皮肤 page scrolled to the bottom (layout check) |
| `skin-09-skin-bottom-rows.png` | tight crop of the last rows, clipping check |

Older `NN-*.png` files in `shots\` are earlier captures from the plugin author's
own iterations, not produced by these scripts.

---

## Notes and gotchas

- **`-ResetHome` for a clean slate.** The isolated `DSH_HOME` persists between
  runs, so an uploaded wallpaper and saved settings survive a restart (that is
  the plugin's own persistence working). Pass `-ResetHome` to start blank.
- **Wallpaper polling.** The client polls `/dsh-glaze/state` every 4 s, so a
  wallpaper uploaded *out of band* (as `capture.ps1` does, straight to the HTTP
  route) can take a few seconds to appear. The driver waits up to 15 s for
  `#dsh-glaze-backdrop[data-visible="true"]` to have a `/dsh-glaze/` background
  before shooting. In-app uploads paint immediately.
- **Port band.** The harness stays in 59821–59839. `stop-test-instance.ps1`
  reports anything still listening in that band.
- **`-ResetHome` after a crash.** If a previous instance died without recording
  state, its port may still be bound. `stop-test-instance.ps1` will find nothing
  to stop; locate the leftover with
  `Get-NetTCPConnection -LocalPort 59821` and confirm its command line mentions
  `skin-test` before killing it.
- **StrictMode-safe.** All scripts are pure ASCII (Windows PowerShell 5.1 reads
  BOM-less UTF-8 as ANSI, which would mangle CJK literals into invalid syntax),
  run under `Set-StrictMode -Version Latest`, and are syntax-checked.
- **Don't run two captures at once.** Each capture launches its own Chrome and
  reads the URL from `state\`, so a concurrent `start-test-instance.ps1` will
  invalidate the token mid-run. The driver now fails clearly (401 → "token is
  stale") instead of dying with an opaque `Failed to fetch`.

## File map

```
harness\
  start-test-instance.ps1   boot the disposable instance
  stop-test-instance.ps1    stop it, safely
  capture.ps1               screenshot + state dump
  ab-legibility.ps1         opacity/scrim/blur comparison sweep
  README.md                 this file
  lib\capture-driver.cjs    Playwright driver (ASCII-only, CJK via \u escapes)
  fixtures\smoke-skin\      minimal known-good plugin (self-test, see below)
  state\                    url.txt, pid.txt, state.json, capture-job.json
  logs\                     instance stdout/stderr, one pair per start
  shots\                    PNGs, state JSON, console logs, fixtures\
```

### `fixtures\smoke-skin`

A dependency-free client-only plugin that paints a green "SMOKE SKIN ACTIVE"
badge and a green frame. It exists so the harness can be proved independently of
the real plugin:

```powershell
.\start-test-instance.ps1 -PluginPath .\fixtures\smoke-skin
.\capture.ps1 -Steps home -Name smoke
```

If the badge appears in `shots\smoke-01-home.png` and
`style[data-plugin-css="dsh-glaze-smoke-fixture/skin.css"]` shows up in the state
dump, the harness plumbing (profile composition, plugin link, client-module
serving, screenshotting) is all working and any later failure belongs to the
plugin under test.
