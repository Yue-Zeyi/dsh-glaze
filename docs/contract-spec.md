# DSH plugin API — contract spec for a custom-skin client+host plugin

Scope: exact contracts the `dsh-glaze` plugin must code against, read out of the shipped
DSH 0.2.1-rc.2 build (`app.asar`, host PID 16044, Web GUI `http://127.0.0.1:59813`).
Every claim below is cited to the packed source under
`C:\Users\Administrator\Documents\deepseek-harness\dsh-src-ref\dsh\node_modules\@deepseek-ai\`
(abbreviated `ROOT` below; paths are `ROOT/<pkg>/lib/...`).

Third-party reference implementations used as ground truth:
`D:\dsh-glm-quota` (client-only) and
`C:\Users\Administrator\.dsh\profiles\desktop\node_modules\dsh-better-sidebar` (full `src/` TS, settings page + host routes).

---

## 1. Client plugin entry contract

### 1.1 What the bundle must do

A browser bundle is a **classic script** (served from `exports["./client"]`) that calls
`window.__ModuleLoader__.load(...)` exactly once. Executing the script only **registers** a
factory; **all side effects — including CSS injection — must live inside the factory closure**
and run at materialization time (`ROOT/dsh-client-modules/lib/client.js:16-23`).

The facade installed by the host into `<head>` is:

```js
// ROOT/dsh-client-modules/lib/index.js:21662 (bootInjections, `queue` string)
window.__ModuleLoader__={
  mode:"queue",
  pendingQueue,
  load(registration){pendingQueue.push(registration)},
  create(options){ ... }
}
```

`load` accepts exactly **three** keys (`ROOT/dsh-client-modules/lib/client.js:702-713`):

| key | required | meaning |
|---|---|---|
| `id` | yes | package id. `<id>/client` is normalized to `<id>` (`stripClientSuffix`, `client.js:98-100`); a mismatch means the row "loaded without registering" and boot fails. |
| `factory` | yes | `(require) => exports`. Called once at materialization, memoized in `loadCache`. |
| `chunk` | no | internal: package-local split chunk (`client.<name>.js`); only for `require.async("./client.x.js")` outputs. Do **not** set it for a normal entry. |

`id` must look like `"dsh-glaze"` (the bare package name from `package.json.name`), **not**
`"@scope/x"`-style unless that is the real name — the host composes graph rows keyed by the
package name it resolved from the manifest and the browser Loader creates the entry with that
same id.

### 1.2 What the factory may `require`

The synchronous `require` handed to the factory resolves in this order
(`ROOT/dsh-client-modules/lib/client.js:832-840`, `879-887`):

1. the **platform seed table**,
2. already-materialized module records,
3. registered bundle factories from the boot graph,
4. else **throws** (`require(...) missed the module table …`).

The platform seed table is fixed at build time in the Vite shell
(`ROOT/dsh-web-frontend/dist/assets/index-CN7NIWNw.js:916075`, function `SZ()`):

```js
{ react, "react/jsx-runtime", "react-dom", "react-dom/client",
  "@deepseek-ai/cordis", zod, "@tanstack/react-virtual",
  "@deepseek-ai/dsh-client-store", "@deepseek-ai/dsh-client-ui-slots",
  "@deepseek-ai/dsh-client-ui-primitives", "@deepseek-ai/dsh-client-ui-dockkit" }
```

So, available to a client plugin **without declaring anything**:
`react`, `react/jsx-runtime`, `react-dom`, `react-dom/client`, `@deepseek-ai/cordis`, `zod`,
`@tanstack/react-virtual`, `@deepseek-ai/dsh-client-store`, `@deepseek-ai/dsh-client-ui-slots`,
`@deepseek-ai/dsh-client-ui-primitives`, `@deepseek-ai/dsh-client-ui-dockkit`.

**`clsx` is NOT in the seed table** — a third-party plugin must inline it or install it
(better-sidebar has `clsx` as its own dependency and its emitted bundle inlines the helper;
`dsh-client-ui-theme/lib/client.js:13-21` shows the same inlined copy). Requiring
`"clsx"` from a plugin factory will throw at materialization unless some other bundled
package registered it.

Anything else must be another package's client half (`require("<pkg>")` or
`require("<pkg>/client")` — same exports), and that package must be a graph row that arrived
first: declare it in `dsh.client.inject` (see §2) or in `dsh.client.external`.

Verified real-world usage — `dsh-better-sidebar/lib/client.js` requires exactly:
`@deepseek-ai/dsh-client-ui-primitives`, `react`, `react-dom`, `react-dom/client`,
`react/jsx-runtime`.

### 1.3 What the returned object may contain

The host treats the bundle exports as a **Cordis plugin object**: any exported names become
the plugin's inject declaration + lifecycle. The two members that matter:

```js
return {
  inject: ['slots', 'locale', ...],   // cordis service names to wait for
  apply(ctx) { ... },                 // activation; ctx is a Cordis Context
}
```

- `apply` may return a disposer / be async; it runs inside the plugin's fiber, so
  `ctx.effect(...)` and `ctx.slots.register(...)` are automatically cleaned up on unload.
- `inject` waits for the *services on that browser Cordis tree* — see §2.2 for the list.
- `apply` is **also** where the plugin's Cordis service keys are provided
  (`ctx.provide('theme', …)` etc.), and where react tree registration happens.
- Exports may also include `Config` (only meaningful on the host half) or extra helpers —
  the browser Loader passes the whole module namespace as the plugin object.

Minimal working skeleton (client-only plugin, verified shape against `D:\dsh-glm-quota\client.js`):

```js
window.__ModuleLoader__.load({
  id: 'dsh-glaze',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const STYLE_ID = 'dsh-glaze/glaze.css'
    const PLUGIN_ID = 'dsh-glaze'

    const CSS = `
      #dsh-glaze-backdrop { position: fixed; inset: 0; z-index: -1; }
    `

    // Side effects belong HERE (materialization), never at script top level.
    function installStyles() {
      if (typeof document === 'undefined') return
      const sel = `style[data-plugin-css=${JSON.stringify(STYLE_ID)}]`
      if (document.querySelector(sel) !== null) return
      const tag = document.createElement('style')
      tag.dataset.pluginCss = STYLE_ID   // identity inside this plugin's bucket
      tag.dataset.plugin = PLUGIN_ID     // bucket: MUST equal the load({id}) value
      tag.textContent = CSS
      document.head.appendChild(tag)
    }

    function SkinPage(props) {
      return h('div', null, 'skin settings')
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        installStyles()
        ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            { name: 'settings.section', id: 'skin', order: 200, label: () => 'Skin' },
            SkinPage,
          ),
        )
      },
    }
  },
})
```

### 1.4 CSS injection + cleanup convention (`data-plugin` / `data-plugin-css`)

The module system owns style cleanup and keys it on **`data-plugin` = the package id**:

```js
// ROOT/dsh-client-modules/lib/client.js:312-315
function removeOwnedStyles(id) {
  if (typeof document === "undefined") return;
  for (const el of document.querySelectorAll("style[data-plugin]"))
    if (el.getAttribute("data-plugin") === id) el.remove();
}
```

```js
// ROOT/dsh-client-modules/lib/client.js:625-631 (claimStyles)
for (const el of untaggedStyles()) if (!before.has(el)) el.setAttribute("data-plugin", id);
for (const el of document.querySelectorAll(`style[data-plugin=${JSON.stringify(id)}]`))
  owned.push(el.getAttribute("data-plugin-css") ?? id);
```

Rules that follow:

- Set **both** `tag.dataset.plugin = '<package id>'` and `tag.dataset.pluginCss = '<pkg>/<file>'`.
  A tag created during factory execution with **no** `data-plugin` is auto-claimed by the
  materializing plugin; that works too, but explicit tagging is what the shipped code does.
- Removing styles happens **after** the plugin's effect cleanup settles, on
  disable/removal/HMR swap; a factory re-execution re-adds them.
- **Do not** create style tags at script top level: the script may run before the plugin is
  imported, styles would be claimed by whoever materializes next, and they'd survive unload.
- Reference implementation conventions: `dsh-client-ui-theme/lib/client.js:1446`
  (`installThemeStyles`, one `ctx.effect` per sheet, `tag.remove()` in the disposer) and
  `dsh-glm-quota/client.js` `installStyles()`.

For a skin the whole stylesheet is usually static; the dynamic part should be **body inline
custom properties** written through `ctx.effect`, because `ui-layout`'s `ThemePresenter`
also writes inline styles (see §5/§6) and inline beats any stylesheet rule.

---

## 2. `package.json` `dsh.client` manifest fields

### 2.1 Parser — every accepted field

The single validator, used by both the host scan and the roster generator:

```js
// ROOT/dsh-client-modules/lib/client.js:61-75  (mirrored in lib/index.js:62)
function parseDshClient(pkgName, value) {
  if (value === void 0) return void 0;
  if (typeof value !== "object" || value === null) throw new Error(`client-modules: ${pkgName} has a non-object dsh.client declaration`);
  const decl = value;
  if (typeof decl.platform !== "string") throw new Error(`client-modules: ${pkgName} dsh.client.platform must be a string`);
  const inject = optionalStringArray(pkgName, "dsh.client.inject", decl.inject);
  const external = optionalStringArray(pkgName, "dsh.client.external", decl.external);
  if (decl.immediately !== void 0 && typeof decl.immediately !== "boolean") throw new Error(`client-modules: ${pkgName} dsh.client.immediately must be a boolean`);
  return { platform: decl.platform, ...inject!==void 0?{inject}:{}, ...external!==void 0?{external}:{}, ...decl.immediately!==void 0?{immediately}:{} };
}
```

Complete field list — **there is no `order` field** (order is the boot graph's own ordering):

| field | type | required | effect |
|---|---|---|---|
| `platform` | string | **yes** | must be `"web"`, otherwise the package is skipped (`lib/index.js:733`: `if (decl === void 0 \|\| decl.platform !== "web") return null`). |
| `inject` | string[] | no | other **client packages** that must be loaded/materialized before this bundle's factory runs; adds graph dependencies and reorders rows. |
| `external` | string[] | no | other client packages whose exports this bundle `require`s dynamically; also ordered as dependencies; `<pkg>/client` is normalized to `<pkg>`. |
| `immediately` | boolean | no | prefetch this bundle's script during boot instead of on first use (`client.js:1393-1395`, `prefetchImmediateTier`). |

Related manifest fields, not part of `dsh.client` but required for a plugin package:

- `exports["./client"]` (string, or `{default: string}`) — **mandatory** when `dsh.client`
  exists, else: `client-modules: <pkg> declares dsh.client but exports no "./client" bundle`
  (`ROOT/dsh-client-modules/lib/index.js:172-181`, `737`).
- `dsh.bundle.patch` — the YAML patch the bundle inserts (host half row), applied when the
  package is a profile bundle.
- the package **name** must match the `id` used in `__ModuleLoader__.load`.

### 2.2 What `inject` does for a client plugin

Two distinct things, and they are easy to confuse:

1. **Bundle arrival / materialization ordering.** `row.inject` is walked before the row
   arrives: each named package row is loaded and materialized first
   (`ROOT/dsh-client-modules/lib/client.js:783-789` `arriveGraphRow`). It is *not* a runtime
   service wait.
2. **`require()` resolution in the factory.** After the dependency has materialized,
   `require("<pkg>")` returns its exports. Without the `inject`/`external` declaration the
   dependency is not guaranteed to be in the table when the factory runs
   (`require(...) missed the module table`).

The `inject`/`apply` pair *inside the returned object* is the **Cordis** inject, which is a
different mechanism (wait for services on the browser context). Client services that actually
exist in this build (grep of `super(ctx, "<name>")` / `ctx.provide("<name>")` in packed
client halves):

| service | provided by |
|---|---|
| `slots` | `dsh-client-ui-renderer/lib/client.js:1305` |
| `locale` | `dsh-client-locale/lib/client.js` |
| `remote`, `remote.settings` | `dsh-api-gateway/lib/client.browser.js`, `dsh-api-remotes` |
| `connection` | `dsh-client-connection/lib/client.browser.js` |
| `modules` | `dsh-client-modules/lib/client.js` |
| `configForms`, `settingsSchema` | `dsh-client-ui-settings/lib/client.js:1252`, `:930` |
| `theme` | `dsh-client-ui-theme/lib/client.js:2029` (`ctx.provide("theme", theme)`) |
| `conversation`, `uiConversation` | `dsh-client-ui-conversation/lib/client.js` |
| `layout` | `dsh-client-ui-layout/lib/client.js` |
| `cordisInspect`, `dynamicCordisRunner`, `timer` | `dsh-cordis-client-runner/lib/client.js` |
| `pluginNavigation` | `dsh-client-ui-plugin-manager/lib/client.js` |

For a skin plugin the correct pair is `inject: ['slots', 'theme']` (add `'locale'` and
`'configForms'` if you localize / persist — see §4).

Shipped examples: `dsh-client-ui-theme` →
`inject = ["slots","locale","remote","configForms"]`; `dsh-client-ui-layout` →
`["slots","theme","locale","shortcuts"]`; `dsh-better-sidebar` →
`['slots','sessions','locale','modules','connection','remote','remote.session']`.

---

## 3. Settings UI surface

### 3.1 Registration call

Third-party pages register into the **`settings.section`** list slot, and the call must be
wrapped in `ctx.slots.inject` because the slot is **declared at runtime** by
`ui-settings-general`:

```js
// C:\Users\Administrator\.dsh\profiles\desktop\node_modules\dsh-better-sidebar\src\client\index.tsx:433
ctx.slots.inject('settings.section', () => ctx.slots.register({
  name: 'settings.section',
  id: 'better-sidebar',
  order: 100,
  label: () => t('settingsNav'),
  inject: () => ({ store: sidebarStore, service }),
}, SideCardSection))
```

### 3.2 Full option set for `settings.section`

From the packed contract catalogue (`ROOT/dsh-cordis-client-runner/lib/client.js:281168`
onwards — key `"settings.section"`, kind `list`, scope `root`) plus the registration code
(`ROOT/dsh-client-ui-renderer/lib/client.js:1603-1620`, `ROOT/dsh-client-ui-slots` `SlotCore.register`
in the frontend bundle at offset ~494207):

| option | type | req | meaning |
|---|---|---|---|
| `name` | `'settings.section'` | yes | slot key; must equal the slot being registered into. |
| `id` | string | yes for list slots | cell key; the shell's nav row id and the `only` filter value. Use your own id. |
| `order` | number | no (0) | nav position, ascending. Shipped: general 0, agent-presets, account, models, plugins. `100` is a safe "after shipped" value. |
| `label` | `string \| (() => string)` | no | nav row text. A thunk is re-read on every projection; re-register (or bump the ledger) on locale change — the ledger version bump is the shell's re-render trigger. |
| `inject` | `() => object` | no | inject face; return value is spread onto the component props (§3.3). May return `{ hooks: {...} }`, which is turned into `use<Name>` hooks. |
| `store` | store handle \| `() => handle` | no | `defineStore` handle → adds `useStore` and `actions` props. |
| `locale` | string | no | locale namespace → adds the `t` prop. |
| `children` | `{ [key]: {kind, scope} }` | no | declare child slots this entry owns. |
| `priority` | number | no (0) | shadowing within the same cell; lowest renders. |
| `registrant` | string | auto | stamped by the registry (`ctx.fiber?.name`). |

`select` / `key` exist for `chain` / `keyed` slots and are invalid here.

### 3.3 EXACT props the component receives

Props are assembled literally as
`{...kit, ...injected, ...slotInjected.props, ...ownerProps}` — later wins:

```js
// ROOT/dsh-client-ui-renderer/lib/client.js:792  renderEntry
function renderEntry(slotKey, Comp, kit, standard, injected, slotInjected, ownerProps, hookContext, hasHookContext) {
  if (slotInjected.slotHookFactories === void 0) return jsx(Comp, {
    ...kit, ...injected, ...slotInjected.props, ...ownerProps
  });
  ...
}
```

- `ownerProps` for `settings.section` is exactly `{ close: () => void }`
  (packed contract: `interface SettingsSectionOwnerProps { close: () => void }` —
  "Close the settings panel"). Rendered with `only: active`, i.e. only the selected
  section's component is mounted (`ROOT/dsh-client-ui-settings-general/lib/client.js:335-338`):
  ```js
  children: active !== void 0 && renderSlot("settings.section", { close: onClose }, { only: active })
  ```
  and `only` filters the list to the entry whose `id` equals the active nav id
  (`ROOT/dsh-client-ui-renderer/lib/client.js:1219`).
- `kit` = standard seats + `renderFactorySlot`, and conditionally
  `t`, `useStore`/`actions`, `renderSlot`/`SessionProvider`
  (`ROOT/dsh-client-ui-renderer/lib/client.js:736-780` `standardKit`).
  Because the shipped registration always passes `locale: NS`, your page gets
  **`t(key, params)`** whenever you also pass `locale`.
- `standard` seats (root scope, always present) materialized at
  `ROOT/dsh-client-ui-renderer/lib/client.js:680` via `standardHookPropName(name)` =
  `use` + capitalized name: `useRemoteAccess`, `useResource`, `useWorkspaces`,
  `usePanelInfo`, `useSessions`, `useSessionStatus`, `useSessionRetainInfo`,
  `useSessionAccess`, `useWorkspaceAccess`.
- `injected` = the return value of **your** `inject()` factory, with `hooks`/`keyedHooks`
  turned into hook props (`bindInjectSources`, `client.js:441-455`). Everything else is
  passed through verbatim — e.g. better-sidebar's page reads `props.store`, `props.service`.

So a skin page's props are exactly:

```ts
{
  close: () => void,
  t: (key: string, params?: object) => string,      // only if locale: '<ns>' was passed
  useStore, actions,                                 // only if store: <handle> was passed
  renderSlot,                                        // only if children were declared
  ...yourInjectReturn,
  // plus the 9 standard use* seats listed above
}
```

The better-sidebar TS types confirm the shape:
`SideCardSectionProps = PropsRuntime<'settings.section'> & { store: SidebarStore; service: BetterSidebarService }`
(`.../src/client/SideCardSection.tsx:76-78`).

Practical caveat found in the same file: DSH 0.2.x carries **no icon** through
`settings.section` — the shell renders a generic gear for every external section. Painting a
custom nav icon means marking the nav row from outside (better-sidebar does it with a
`registerSettingsNavIcon` effect), not a slot option.

### 3.4 Gate: the slot must already be declared

`settings.section` is **not** a built-in slot. It is declared by the `sidebar.settings`
entry owned by `ui-settings-general`:

```js
// ROOT/dsh-client-ui-settings-general/lib/client.js:1233-1268
ctx.slots.inject("sidebar.settings", () => {
  ...
  const disposeSlot = ctx.slots.register({
    name: "sidebar.settings", locale: NS, store: shellStore,
    children: {
      "settings.launcher": { kind:"single", scope:"root" },
      ...
      "settings.section":  { kind:"list",   scope:"root" },   // line 1258
      "settings.onboarding": { kind:"list", scope:"root" },
    },
    inject: shellInjected,
  }, SettingsRoot)
  ...
})
```

Registration before the declaration **throws**:

```js
// ROOT/dsh-client-ui-slots (SlotCore.register), frontend bundle offset ~494600
if (!r?.spec) throw new Error(`slot "${e.name}" is not declared (a parent entry's children table must declare it)`);
```

Therefore the `ctx.slots.inject('settings.section', …)` wrapper is mandatory — it is the
declaration-lifetime effect: the callback runs immediately if the declaration already exists,
otherwise it runs inside the declaring `register()` call after the declaration commits, and it
is disposed + re-run when the declaration collapses and reappears
(`ROOT/dsh-client-ui-renderer/lib/client.js:1368-1425`, `inject(key, callback)`).
Registering inside your slot's `apply` **without** the wrapper, or calling
`ctx.slots.register` at plugin-apply time, is the classic failure mode
(`slot "settings.section" is not declared`).

---

## 4. Preferences persistence from the client

### 4.1 Service

`ctx.configForms` is provided by `dsh-client-ui-settings`
(`ROOT/dsh-client-ui-settings/lib/client.js:1252-1305`). It is a Cordis `Service` named
`configForms`; add `'configForms'` to the plugin's client `inject` and the client cordis
tree resolves it as `ctx.configForms`.

```js
// ROOT/dsh-client-ui-settings/lib/client.js:1284-1299
/** Get the shared form values and write queue for one Host plugin entry. */
get(entryId) {
  const existing = this.forms.get(entryId);
  if (existing !== void 0) return existing;
  const form = new ConfigFormController(this.owner, { namespace: entryId }, this.mirror, this.schema);
  this.forms.set(entryId, form);
  this.mirror.ensure();
  return form;
}
```

### 4.2 `ConfigForm` API (per entry)

Snapshot (`ROOT/dsh-client-ui-settings/lib/client.js:1122-1127`, `1170-1230`):

```js
getSnapshot() /* => */ {
  status:   'loading' | 'ready' | 'unavailable',
  value:     <resolved config, only volatile fields, or undefined>,
  base:      <inherited value beneath the profile override>,
  user:      <raw user section from the profile patch>,
  revision:  <number | undefined>,   // host revision of this namespace
  writable:  <boolean>,              // from settings.describe.writable
}
subscribe(listener) => disposer
```

Writes (`ROOT/dsh-client-ui-settings/lib/client.js:1141-1187`):

```js
set(field, value)        → mutate([{ op:'set',   path:[field], value }])
unset(field)             → mutate([{ op:'unset', path:[field] }])
mutate(ops, expectedRevision?) → Promise<boolean>
// ops are {op:'set'|'unset', path:[...], value?}; the list is applied atomically.
```

Ordering / conflict semantics, quoted:

```js
mutate(ops, expectedRevision) {
  const ownedOps = structuredClone(ops);
  const generation = ++this.writeGeneration;
  return this.enqueue(async () => {
    const revision = expectedRevision ?? this.pendingRevision ?? this.getSnapshot().revision;
    const response = await this.ctx.remote.settings.mutate(this.spec.namespace, ownedOps, revision);
    if (!response.ok) { await this.recover(generation); return false; }
    ...
  });
}
```

- Writes are **serialized per form** (`enqueue`, `this.tail`); `structuredClone` snapshots the
  ops at call time; concurrent `get(entryId)` callers share one form/write queue.
- Every write carries the latest known revision (`pendingRevision` first). A stale revision
  is refused host-side with `SETTINGS_CONFLICT` → mapped to remote error code
  `settings/conflict` (`ROOT/dsh-api-settings-controller/lib/index.js:484-503`); the client
  folds the fresh view back in (`recover()` → `mirror.load()`), and `mutate` resolves
  **`false`** (no throw). Staged editors re-read the snapshot and re-apply.
- `mutate` resolving `true` means the host accepted it and the local mirror was updated from
  the write answer (`mirror.acceptView(response.value)`).
- `unset` restores inheritance (removes the profile override, falls back to `base`).
- `writable === false` means the host will refuse; check it before enabling controls.

### 4.3 `ctx.configForms.describe()` shape

`describe()` returns the shared mirror (`ROOT/dsh-client-ui-settings/lib/client.js:1287-1292`);
snapshot:

```js
{ status: 'idle'|'loading'|'ready'|'error'|'unavailable',
  view?: { writable: boolean,
           hasDocument: boolean,
           namespaces: NamespaceView[] },
  error: string|null }
```

`NamespaceView` (host-side builder `namespaceView`,
`ROOT/dsh-api-settings-controller/lib/index.js:274-292`):

```js
{ ns: string, autoGenerate: boolean, schema: <schema.toJSON()>,
  value, base?, user?, applies: 'live',
  secrets: [{ path, set }], revision: number }
```

Convenience helpers on the mirror: `namespace(ns)`, `subscribe`, `load()`, `ensure()`.
Also useful: `ctx.configForms.whileServed(namespaces, register)` — keeps a foreign-namespace
page registered only while some listed namespace is served
(`ROOT/dsh-client-ui-settings/lib/client.js:1326-1345`).

### 4.4 How the entry id is derived — and the answer for `dsh-glaze`

The namespace is the **Loader entry id** of the host row. Host side:

```js
// ROOT/dsh-settings/lib/index.js:410-425  describe()
const descriptors = this.ownerContext.configEditor.configuration().flatMap(({ entry, inherited, override }) => {
  const schema = this.schema(entry);            // entry.fiber?.runtime?.Config
  ...
  ns: entry.options.id,                          // <-- the entry id
```

and a form is only emitted when the row is **active, has a `Config` schema, and has at least
one volatile field** (`volatileForm`, `ROOT/dsh-settings/lib/index.js:122-136`; `write()`
throws `No configurable plugin entry` / `Plugin entry ... has no volatile fields`,
`index.js:500-520`).

For the proposed `dsh-glaze` mount:

```yaml
# plugin/cordis.patch.yml
- insert:
    - id: dsh-glaze
      name: dsh-glaze
```

the Loader entry id is **`dsh-glaze`**, so `ctx.configForms.get('dsh-glaze')` is correct — the
patch row's `id` is the entry id, independent of the package name. This is exactly what
`dsh-better-sidebar` does: it locates its own entry id at runtime instead of hardcoding it
(`ownEntryId(ctx)` scans `ctx.loader.entries()` for the entry whose `fiber === ctx.fiber`,
`.../src/index.ts:1071`), which is the robust pattern if the id ever changes; for a
self-owned fixed patch row, hardcoding `'dsh-glaze'` is fine.

Two host-side requirements, both easy to miss:

1. **Every persisted field must be `.volatile()`** on the host `Config`, and the schemastery
   module must be **DSH's** copy (`@deepseek-ai/schemastery`), not the public
   `schemastery` package — only DSH's build wraps volatile fields in the cosmokit `Volatile`
   reference the Loader commits into; the public build silently drops live writes
   (`dsh-better-sidebar/src/config.ts:1-16` documents exactly this trap). Verified in the
   live host: `createRequire('.../profiles/desktop/package.json')('@deepseek-ai/schemastery')`
   resolves and produces `{"meta":{"volatile":true}}` in `toJSON()`.
2. Opt out of the auto-generated form if you ship your own page:
   ```js
   ctx.inject(['settings'], (settingsCtx) => {
     settingsCtx.effect(() => settingsCtx.settings.configure({ auto: false }, ctx.fiber), 'dsh-glaze: settings page policy')
   })
   ```
   (`ROOT/dsh-settings/lib/index.js:370` `configure(presentation, owner = this.ctx.fiber)`;
   same pattern in `ui-theme`, `client-locale`, `ui-conversation`, better-sidebar).
   Otherwise Settings shows the same fields twice.

---

## 5. Theme tokens to soften for a translucent skin

All token definitions live in `ROOT/dsh-client-ui-theme/lib/client.js`:

- `base_css_default` (line 1407): fonts, radii, `--dsh-*` families. **No** backgrounds.
- `design_platform_css_default` (line 1413, 19 KB — the alias layer). Two blocks only:
  `body {…}` for the light palette, `body[data-ds-dark-theme] {…}` for dark, plus two
  `html[data-platform=darwin] body[data-ds-dark-theme]` menu-only overrides.
- `gradient_shadow_text_css_default` (line 1425): gradients, shadows, `--dsw-mask-blur`,
  `--dsw-menu-backdrop-filter`. Backgrounds are **not** here.

### 5.1 Document canvas

```css
/* design_platform_css_default, end of the light `body{}` block */
body { ... ; background-color: var(--dsw-alias-bg-base) }
```

`--dsw-alias-bg-base` **is** the document canvas, and it is painted twice:

1. by the theme sheet (`body{background-color:var(--dsw-alias-bg-base)}` above),
2. before any script runs, by the bootstrap head style
   (`ROOT/dsh-client-ui-theme/lib/index.js`, `bootThemeStyle`):
   `body{background-color:#fff;--dsh-boot-bg:#fff}` / dark `#151517`.

`<=> --dsw-alias-bg-base = #fff (light, neutral-bluish-00) / #151517 (dark, neutral-bluish-950)`.

The layout frame also paints it: `.BynINW_frame{background:var(--dsw-alias-bg-base)}` and
`[data-windows-titlebar] .BynINW_centerCol{background:var(--dsw-alias-bg-base)}`
(`ROOT/dsh-client-ui-layout/lib/client.js:73` CSS module). So a wallpaper layer at
`z-index:-1` needs **all three** neutralized: body background, the frame, and the center column.

### 5.2 The ~12 opaque surface properties worth re-binding

| token | light | dark | what it paints |
|---|---|---|---|
| `--dsw-alias-bg-base` | `neutral-bluish-00` (#fff) | `neutral-bluish-950` (#151517) | document canvas + layout frame + center column |
| `--dsw-alias-bg-layer-1` | `neutral-bluish-00` | `neutral-bluish-875` (#232324) | primary raised surface |
| `--dsw-alias-bg-layer-2` | `neutral-bluish-00` | `neutral-bluish-850` (#2c2c2e) | secondary nested surface, cards |
| `--dsw-alias-bg-layer-3` | `neutral-bluish-00` | `neutral-bluish-800` (#353638) | tertiary/inner surface |
| `--dsw-alias-bg-module-platform` | `neutral-bluish-60` | `neutral-bluish-800` | module platform fill (selected theme cube, panels) |
| `--dsw-alias-bg-overlay` | `neutral-bluish-150` | `neutral-bluish-700` | overlay surfaces |
| `--dsw-specific-sidebar-fill` | `neutral-bluish-50` | `neutral-bluish-900` | sidebar column + title row |
| `--dsw-specific-input-major` | `neutral-bluish-00` | `neutral-bluish-850` | composer / major inputs |
| `--dsw-specific-menu` / `--dsw-menu-surface-fill` | `#f8f9fa94` | `#43454a73` | menus (already translucent; darwin variant `#f8f9faf0` / `#303136f0`) |
| `--dsw-specific-bubble` (+ `-highlight`) | `deepseek-50` | `neutral-bluish-850` | message bubble |
| `--dsw-alias-markdown-code-block` (+ `-banner`) | `neutral-bluish-50` | `neutral-bluish-900` | markdown code block |
| `--dsw-alias-settings-card-fill` | `= bg-layer-2` | `= bg-layer-2` | settings cards (alias defined in `base_css_default` `body{}`) |
| `--dsw-specific-tip`, `--dsw-specific-selector`, `--dsw-specific-login-input` | `neutral-bluish-60` / `60` / `50` | `800` / `800` / `900` | tips, selectors, login inputs |

Useful companions: `--dsw-alias-border-l1..l4`, `--dsw-alias-bg-mask-1..3`,
`--dsw-alias-interactive-bg-hover`, `--dsw-mask-blur`, `--dsw-menu-backdrop-filter`
(= `blur(40px) saturate(150%)`), `--dsw-elevation-*`.

Selector to override:

- light palette → `body { --dsw-alias-bg-layer-2: color-mix(… transparent 45%); … }`
- dark palette → `body[data-ds-dark-theme] { … }`
- never `:root`/`html`: the sheet defines everything on `body`, and dark redefines the same
  names on `body[data-ds-dark-theme]`, so `:root` overrides lose the cascade to them.

**Critical interaction with `ui-layout`:** the presenter writes *inline* styles on `body`
for every theme token (`snapshot.active.tokens` — empty for the built-in light/dark, but
non-empty once a third-party theme or `ctx.theme.overrideTokens()` is used), plus font
sizes/families. Inline styles beat any `<style>`/stylesheet rule. That is why the skin's
dynamic alpha must also be written as **body inline custom properties**, re-derived on each
`theme/change` (next section) — exactly the plan already encoded in
`dsh-glaze/client.js`'s header comment. `ctx.theme.overrideTokens(...)` is the
sanctioned alternative: it stacks a token layer that the presenter itself applies
(`ROOT/dsh-client-ui-theme/lib/client.js:1835`, `overrideTokens(source, tokens)`, values must
be `{light, dark}` pairs).

---

## 6. Theme switching signal

Two independent signals are available; use both for different purposes.

### 6.1 DOM signal (works with zero services)

`ui-layout`'s `ThemePresenter` publishes the palette on `<body>`/`<html>`:

```js
// ROOT/dsh-client-ui-layout/lib/client.js:505, 515, 548-580
const DARK_ATTRIBUTE = "data-ds-dark-theme";
const THEME_SOURCE_ATTRIBUTE = "data-ds-theme-source";
apply(snapshot) {
  const scheme = snapshot.active.colorScheme;
  document.documentElement.style.colorScheme = scheme;
  document.documentElement.setAttribute(THEME_SOURCE_ATTRIBUTE, snapshot.preference === "system" ? "system" : scheme);
  const body = document.body;
  if (scheme === "dark") body.setAttribute(DARK_ATTRIBUTE, ""); else body.removeAttribute(DARK_ATTRIBUTE);
  ... // font sizes/families on body inline styles
  for (const name of this.appliedTokens) body.style.removeProperty(name);
  this.appliedTokens = [];
  for (const [name, value] of Object.entries(snapshot.active.tokens)) { body.style.setProperty(name, value); this.appliedTokens.push(name); }
  this.themeColorMeta.content = getComputedStyle(body).backgroundColor;
}
```

So: `body[data-ds-dark-theme]` present ⇔ dark palette; `html[data-ds-theme-source]` =
`light | dark | system`; plus the same bootstrap attributes are written before scripts run
(`ROOT/dsh-client-ui-theme/lib/index.js` `bootThemeBodyScript`: `document.documentElement.dataset.dsThemeSource`,
`document.body.toggleAttribute('data-ds-dark-theme', dark)`).

A `MutationObserver` on `body` attribute changes is the robust "tokens were re-applied"
trigger when the presenter rewrites inline styles (theme change, override layer change,
font change): re-read `getComputedStyle(document.body).getPropertyValue(token)` and rebuild
your alpha-wrapped inline values **after** the presenter writes, i.e. in the observer
callback (microtask-ordered after the attribute mutation). Prefer observing both
`data-ds-dark-theme` on `body` and `data-ds-theme-source` on `documentElement`.

### 6.2 Cordis service signal (authoritative)

`ctx.theme` is provided by `dsh-client-ui-theme` (`ctx.provide("theme", theme)`,
`ROOT/dsh-client-ui-theme/lib/client.js:2029`); `ui-layout` injects `'theme'`
(`inject = ["slots","theme","locale","shortcuts"]`). Add `'theme'` to the skin plugin's
client `inject`.

Snapshot shape (`buildSnapshot`, `ROOT/dsh-client-ui-theme/lib/client.js:1848-1862`):

```js
Object.freeze({
  preference: 'light' | 'dark' | 'system' | <registered theme id>,
  fontSizes:    { text, code, terminal },        // px
  fontFamilies: { text, code, terminal },        // normalized CSS lists, "" = default
  active: Object.freeze({                         // the resolved theme definition
    id, colorScheme: 'light' | 'dark',
    tokens: { '<css-var>': '<css value>', ... }   // {} for built-in light/dark
  }),
  themes: Object.freeze([...]),                  // whole registry
  revision: <number>,                            // monotonic; bumped on every publish
})
```

API (`ThemeRuntime`, `ROOT/dsh-client-ui-theme/lib/client.js:1635-1885`):

| member | contract |
|---|---|
| `getTheme()` | current immutable snapshot (stable reference until the next change). |
| `register({ id, colorScheme, tokens })` | register a third-party theme id; duplicate id throws; returns disposer (active theme removal resets preference to default). |
| `setTheme(id)` | the only preference write path; unknown ids throw; emits `theme/change`. |
| `overrideTokens(source, tokens)` | stack a partial token layer; `tokens` = `{ '<var>': { light, dark } }` (a bare string throws a teaching error); later layers win; returns disposer that removes exactly its layer. `ctx.provide`d service is the sanctioned third-party extension. |
| `exportInspectTokens()` | JSON-safe token directory (`{name, description, valueType, requiresLightAndDark, cssVariable}`). |
| event `theme/change` | emitted on the theme plugin's context with the new snapshot on every `publish()`; `ui-layout` subscribes via `ctx.on("theme/change", …)` (`ROOT/dsh-client-ui-layout/lib/client.js:701-712`). A third-party plugin can subscribe the same way (`ctx.on('theme/change', snapshot => …)`) or subscribe to the service if it also exposes a subscription — the packed `ThemeRuntime` has **no** public `subscribe()`; the event is the documented channel ("continuous sync only through the `theme/change` event"). |

Recommended: subscribe to `theme/change` for correctness, and optionally observe
`body[data-ds-dark-theme]` as a fallback for the pre-plugin interval (before `ctx.theme`
exists, the bootstrap layer has already set the attribute).

---

## 7. Host-half web routes

### 7.1 `ctx.webServer.register(route)`

Service `webServer` is provided by `@deepseek-ai/dsh-host-webserver`
(`super(ctx, "webServer")`, `ROOT/dsh-host-webserver/lib/index.js:236-330`). A plugin
declares `export const inject = ['webServer']` (better-sidebar: `src/index.ts:113`).

```js
// ROOT/dsh-host-webserver/lib/index.js:326-333
register(route) {
  const table = route.kind === "exact" ? this.exact : this.prefixes;
  if (table.has(route.path)) throw new Error(`webserver: duplicate ${route.kind} route "${route.path}"`);
  table.set(route.path, route);
  return () => { table.delete(route.path); };
}
```

Route type:

```ts
interface WebRoute {
  kind: 'exact' | 'prefix'
  path: string                        // path only, no query; exact match or longest-prefix
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
}
```

- `kind: 'exact'` → only that pathname; `kind: 'prefix'` → the path and everything under
  `path/`, longest prefix wins (`index.js:494-505`).
- Duplicate `(kind, path)` throws at registration (composition-level contract).
- Matching order: exact table → longest prefix → the single fallback seat
  (`registerFallback`, one owner; the SPA dist server owns it in the shipped Web composition).
- Also on the service: `registerUpgrade({path, handler})` (exact WebSocket path),
  `tapIndex(transform)`, `renderIndex(html)`, `getOrigin()`, `port`, `host`,
  `protocol` (`'http:' | 'https:'`).
- Registration must be wrapped in `ctx.effect` so it is disposed with the plugin (and
  re-registered if the webserver service is replaced):

```js
// C:\Users\Administrator\.dsh\profiles\desktop\node_modules\dsh-better-sidebar\lib\index.js:2675-2682
function registerBundleRoute(ctx, fence) {
  return ctx.webServer.register({
    kind: "prefix",
    path: "/sidebar/bundle",
    handler: createBundleRouteHandler(fence)
  });
}
// caller: ctx.effect(() => registerBundleRoute(ctx, fence), 'dsh-glaze: /dsh-glaze routes')
```

`ctx.effect(fn, label)` contract: `fn` returns a disposer (or an async disposer); the
disposer runs on plugin unload. `fn` itself runs at apply time. Async iterable form is also
supported (`yield dispose`), and the returned value from `ctx.effect` is an idempotent
disposer. In the packed host code the pattern is always
`ctx.effect(() => ctx.webServer.register({...}), '<label>')` — the register disposer *is*
the effect cleanup. Note the shipped host halves frequently write
`return ctx.webServer.register({...})` **inside** `ctx.effect(() => …)` so cleanup is the
route's own disposer.

### 7.2 Do custom (non-`/api`) routes require authentication?

**No.** Authentication in DSH is bound to the `/api` transport, not to the webserver:

- `/api/*` is behind the connection's trust fence + session cookie; the fence rejects with
  `401/403` (`ROOT/dsh-client-connection/lib/index.js:133-250` `isTrustedApiRequest`,
  `:755-800` `admitConnection`/`isTrusted`). Verified live: `GET /api/settings/describe` → **401**.
- A plugin route registered with `ctx.webServer.register` is **unauthenticated by
  construction** — the webserver itself "knows no harness concepts". Verified live on the
  running app, from the host process with no cookie:
  - `GET /plugins/events` → **200**, `content-type: text/event-stream` (the `client-hmr` SSE
    channel, registered via `ctx.webServer.register`, `ROOT/dsh-client-hmr/lib/index.js:141-152`),
  - `GET /connect` → **401** (the launch-token flow is the only authenticated surface),
    `GET /api*` → **401**, `GET /assets/*` and `/favicon.svg` → **200** (static fallback),
    unknown paths → **404** with an empty body.

  So a custom route answers any caller that can reach the port; only the plugin's own fence
  stands between the route and the network.

> ⚠ **Reference caveat discovered on this deployment.** `dsh-better-sidebar`'s **host half is
> inert here**: its host `inject` list is `['webServer','sessions','webRuntime','tools']`
> (`.../lib/index.js:6044`, `src/index.ts:113`), and **`webRuntime` is not a service in DSH
> 0.2.1-rc.2** — nothing in the packed tree provides it (`dsh-web` provides the web-search
> service as `"web"`; `dsh-web-app/lib/index.js:147` provides `"webApp"`; startup flags live
> on `"webStartup"`). Its Fiber therefore stays pending and **none of its `/sidebar/*` routes
> exist** (all probe 404/405 from the SPA fallback), even though its *client* bundle is in the
> live boot graph. Consequence for `dsh-glaze`: use better-sidebar's code as a structural
> reference, but do **not** copy `ctx.get('webRuntime')`; read trust grants from
> `ctx.get('webStartup')?.trustedHosts` (the same value Connection consumes,
> `ROOT/dsh-web-app/lib/startup.js:67`) or accept loopback only.

Because the host can bind a non-loopback address, **a plugin route that exposes user data
must implement its own fence.** Both third-party plugins copy the same one; better-sidebar's
is the cleanest reference (`src/trust-fence.ts` in the package, packed at
`dsh-better-sidebar/lib/index.js:2494-2568`):

```js
function isTrustedApiRequest(request, trustedHosts) {           // request = { headers, method, url }
  const host = header(request.headers, "host"); if (host === undefined) return false;
  const hostUrl = parseAuthority(host); if (hostUrl === undefined) return false;
  if (!isLoopbackHostname(hostUrl.hostname) && !isTrustedAuthority(hostUrl, trustedHosts)) return false;
  if (header(request.headers, "sec-fetch-site") === "cross-site") { /* only the narrow media exception */ }
  const origin = header(request.headers, "origin");
  if (origin === undefined) return true;           // non-browser clients
  if (origin === SHELL_APP_ORIGIN) return true;    // "dsh-app://app" — the Electron shell page
  return new URL(origin).hostname === hostUrl.hostname;
}
```

Notes that matter for a skin wallpaper route:

- Desktop GUI page origin is **`dsh-app://app`** (Electron shell), while the socket targets
  the loopback authority — a plain authority match would refuse the real GUI; the shell
  origin must be allow-listed (`SHELL_APP_ORIGIN = "dsh-app://app"`).
- `trustedHosts` live on the web startup object. better-sidebar reads
  `ctx.webRuntime.trustedHosts` and injects `'webRuntime'` — **that service does not exist in
  this build**, which is why its host half never activates here (see the caveat in §7.2).
  The value Connection itself consumes is `webStartup.trustedHosts`
  (`ROOT/dsh-web-app/lib/startup.js:61-67`; Connection's own config also accepts
  `trustedHosts`, `ROOT/dsh-client-connection/lib/index.js:1016,1029`). Loopback (`127.0.0.1`,
  `localhost`, `[::1]`) is always accepted.
- For an `<img src="/dsh-glaze/image">` request the browser sends `sec-fetch-site: same-origin`
  and no `origin`; a `fetch()` from the page sends `origin: dsh-app://app`.

### 7.3 Streaming a binary file with correct headers

Routes get raw `node:http` objects (`IncomingMessage` / `ServerResponse`), so a binary body is
just `res.writeHead(...)` + `res.end(buffer)` or a `ReadStream` pipe. Reference
(better-sidebar's chunk route, `lib/index.js:2628-2673`) uses `readFile` + explicit headers,
ETag and `If-None-Match`; for an image store the equivalent is:

```js
ctx.effect(() => ctx.webServer.register({
  kind: 'prefix', path: '/dsh-glaze/image',
  async handler(req, res) {
    if (!fence(req)) { res.writeHead(403); res.end('forbidden'); return }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return }
    const info = await store.stat()                       // { path, mime, bytes, etag }
    if (info === undefined) { res.writeHead(404); res.end('not found'); return }
    if (req.headers['if-none-match'] === info.etag) {
      res.writeHead(304, { 'cache-control': 'no-cache', etag: info.etag }); res.end(); return
    }
    res.writeHead(200, {
      'content-type': info.mime,
      'content-length': String(info.bytes),
      'cache-control': 'no-cache',                        // or 'private, max-age=…' + revisioned URL
      etag: info.etag,
      'x-content-type-options': 'nosniff',
    })
    if (req.method === 'HEAD') { res.end(); return }
    createReadStream(info.path).pipe(res)                  // or res.end(await readFile(info.path))
  },
}), 'dsh-glaze: /dsh-glaze/image route')
```

Notes: `webServer` may be configured with `compression:'gzip'` (shipped web bundle uses level 1,
1 KiB threshold) — it wraps eligible responses transparently and **skips** SSE/ZIP/already-
encoded bodies; `content-length` on an image is fine. Serve only allow-listed names/extensions
(path traversal is your responsibility). Use a **revisioned URL** (`/dsh-glaze/image?v=<rev>`)
or `no-cache` + ETag so a replaced wallpaper is picked up without a page reload. Keep an
upload cap and sniff/validate the bytes before writing (the in-progress `plugin/index.js`
already does this).

`POST /dsh-glaze/upload` with a raw body: read `req` chunks with a byte cap, then
`writeFile` to a temp name + `rename` (atomic), and bump the revision stored in `meta.json`.

---

## 8. HMR / live plugin activation

### Short answer

**The desktop deployment runs with host-side profile HMR enabled** — `@deepseek-ai/dsh-hmr`
is mounted, watches the profile `cordis.patch.yml`, the user `$DSH_HOME/cordis.patch.yml`,
and the profile `package.json`, and recomposes the profile live. **However, HMR does not
watch the profile's `node_modules` or any source root in this deployment
(`config.root = []`), and a change confined to `package.json` dependencies produces no
reload (README limitation).** So the reliable workflow is:

- adding/changing a **patch row** or **enabling/disabling** a plugin → applies live,
- **installing/replacing a package** (`pnpm install`, `dsh plugin add`, a rebuilt `link:`
  target) → requires `dsh plugin …` (which recomposes) or a Host restart; a bare
  `pnpm install` in the profile directory is *not* picked up by HMR's own watches,
- **client (browser) code** changes are picked up live **only** via `dsh-client-hmr`'s bundle
  poller (it stats each published `lib/client.js` and pushes a `rebuilt` frame) — no rebuild
  watcher is running in the desktop deployment, so `lib/client.js` must be rewritten on disk
  with a new mtime/size, and even then the new code only loads if the mtime/size differs from
  the recorded baseline.

### Evidence

1. **HMR entry is enabled in the base bundle, gated on `profileContext` only**
   `ROOT/dsh-base/cordis.patch.yml:27-32`:

   ```yaml
   # Profile configuration reloads by default; module roots are opt-in.
   - id: hmr
     name: '@deepseek-ai/dsh-hmr'
     disabled: !!js "!ctx.get('profileContext')"
     config:
       root: []
   ```

2. **`profileContext` is always provided by the desktop launcher.**
   `ROOT/dsh-desktop-host/lib/index.js:224-247` `main()` calls
   `runProfile({ profile: "desktop", resolvedProfile: { profile, installAnchor }, … })`, and
   `ROOT/dsh/lib/profile-boot-C14i-8IN.js:290-306` provides it:

   ```js
   hostCtx.provide("profileContext", profileContext);
   ```

   → `disabled: !!js "!ctx.get('profileContext')"` evaluates **false**, the `hmr` entry is
   enabled. `ROOT/dsh-hmr/README.md` states the same: "The base bundle enables HMR with
   `root: []` when the launcher supplies `profileContext`; hosts without that profile context
   leave this entry disabled."

3. **HMR registers exactly three watchers during init**
   `ROOT/dsh-hmr/lib/index.js:820-875`:

   ```js
   const profile = this.ownerContext.get("profileContext");
   if (profile !== void 0) { … 
     const manifestPath = join(profile.dir, "package.json");
     const patchFiles = [profile.patchPath, join(profile.home, PROFILE_PATCH_FILENAME)];
     …
     for (const filename of patchFiles) await this.watchConfig(filename, () => refresh(false));
     await this.watchConfig(manifestPath, () => refresh(true));
   }
   ```

   `PROFILE_PATCH_FILENAME = "cordis.patch.yml"` (`ROOT/dsh-app-boot/lib/index.js:509`).
   For desktop that is
   `C:\Users\Administrator\.dsh\profiles\desktop\cordis.patch.yml` and
   `C:\Users\Administrator\.dsh\cordis.patch.yml` (absent today), plus the profile manifest.
   The refresh callback short-circuits when the *effective inputs* (bundle list + both patch
   files' text) are unchanged (`index.js:853-870`), then runs
   `this.reconcileProfile()`.

4. **`root: []` means no module-source watching.** `Config.root` default is `["."]`
   (`ROOT/dsh-hmr/lib/index.js:702-712`), overridden to `[]` by the base bundle; the source
   watcher is created from `root` (`index.js:874-895`). With `[]` only the configuration
   watches above exist. The README adds: "To enable source-module watching, configure the
   `hmr` entry supplied by the base bundle in the profile patch before launching:
   `root: ["."]`" — i.e. it needs a profile patch edit **and** a relaunch to take effect.

5. **A recomposition still replaces plugins whose *loaded files under the profile dir*
   changed** — that is not source watching, it is the module-file comparison run on every
   `reconcileProfile()`: "Profile recompositions run by HMR's profile watches and by Plugin
   Manager also replace plugins whose loaded files below the profile directory changed on
   disk. This covers installed packages below `node_modules` and the targets of linked
   packages… source watching through `root` is not required" (`ROOT/dsh-hmr/README.md`).
   The comparison (`ModuleFiles.compare`, `index.js:434-520`) runs inside
   `reconcileProfile()` (`index.js:1320-1400`) *before* `recomposeProfile()`.

6. **Plugin Manager uses the same path and reports the difference.**
   `ROOT/dsh-plugin-manager/lib/index.js:2351-2370`:

   ```js
   async publishAndReload(requiredIds = []) {
     if (this.ownerContext.get("hmr") === void 0) await this.refreshPackages();
     return this.reload(requiredIds);
   }
   async reload(requiredIds = []) {
     const hmr = this.ownerContext.get("hmr");
     if (hmr === void 0) { composeEntries([readProfilePatches("dsh", this.profile)]); return { warnings: [] }; }
     const { warnings, pending, restartReason } = await hmr.reconcileProfile(requiredIds);
     …
   }
   ```

   and every management operation is tagged with `application: "applied"` when `hmr` exists,
   otherwise `application: "restart-required"`, `restartReason: "no-hmr"`
   (`index.js:2378-2396`). So "HMR on" is observable through the plugin-manager result.

7. **Loose-end confirmation:** HMR's Node internals hooks were not observable through this
   session's inspector (`require('internal/...')` unavailable from the eval context, and
   `internal/modules/esm/module_map` exposes only `LoadCache`/`ResolveCache` classes, whose
   instances read empty from outside), so the enabled/disabled state is established from the
   composition (1–2) and the documented/read code paths (3–6), not from a live hook probe.

8. **Client side: `dsh-client-hmr` is mounted and does poll bundles.**
   `ROOT/dsh-web-app/cordis.patch.yml:218-219` inserts
   `- id: client-hmr / name: '@deepseek-ai/dsh-client-hmr'`; the plugin stats every graph
   row's `client.js` every `pollIntervalMs` (default 500) and calls
   `ctx.clientModules.rebuilt(id)` when `mtimeMs/ctimeMs/size` change, pushing a `rebuilt`
   frame over `GET /plugins/events` (`ROOT/dsh-client-hmr/lib/index.js:22-169`). Verified
   live: that SSE endpoint answers 200 and immediately emits a `graph` frame whose `rev` is
   `7116f133a0dd`. The browser half then invalidates the module, removes its owned styles,
   re-imports and remounts the entry (`ROOT/dsh-client-modules/lib/client.js:430-505`).

### Consequence for the skin plugin's iteration loop

- Editing `~/.dsh/profiles/desktop/cordis.patch.yml` (adding/removing the `dsh-glaze` insert
  row, toggling `disabled`, changing row `config`) → HMR recomposes within ~1 s; a **new**
  row starts without restarting the app, and a removed row is disposed. `pnpm install` is not
  needed for a `link:`-ed or already-present package; the row can be added before the package
  is installed only if the Loader can resolve it.
- Editing the plugin's own host code (`index.js`) **is** picked up by the next recomposition
  *if* the file is inside the profile directory **or** the profile `link:` target — the file
  comparison covers linked package targets (README §above). Trigger a recomposition by
  touching the profile patch (any real edit) or toggling the plugin off/on through Plugin
  Manager.
- Editing the plugin's `client.js` needs the file to be rewritten with different metadata;
  `dsh-client-hmr`'s poller then swaps it into the open page — no app restart, no page reload
  (React state inside the reloaded plugin is lost).
- `pnpm install` alone (dependency-only manifest change) → **restart required**; the README
  limitation states plainly: "A change confined to `package.json` is not detected." Use
  `dsh plugin add`/Plugin Manager (which calls `reconcileProfile`) or restart.
