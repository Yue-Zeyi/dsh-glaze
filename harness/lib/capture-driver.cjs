// Playwright driver for capture.ps1.
//
// Receives a JSON job file path on argv[2] and prints a result envelope on
// stdout:
//   __RESULT__{...}   success, with steps/state/errors
//   __FATAL__{...}    driver-level failure
//
// The job travels through a file, not through argv: Windows PowerShell 5.1
// strips the quotes out of a JSON string when it hands it to a native program,
// which would make every argument unparseable.
//
// Design notes:
//  * This file is plain UTF-8 and is executed by Node directly, never via a
//    PowerShell here-string. Windows PowerShell 5.1 reads BOM-less UTF-8 as
//    ANSI, which would mangle the CJK literals below into invalid syntax.
//    Keep every non-ASCII string in this file expressed as a \u escape anyway,
//    so the file survives any tooling that round-trips it.
//  * Localized UI labels are matched by \u-escaped regex, so this file stays
//    ASCII while still targeting the zh-CN and en-US interfaces.
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const job = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const pw = require(path.join(job.playwrightRoot, "playwright-core"));

const LOG = [];
function log(line) {
  LOG.push(line);
  console.log(line);
}

// Localized labels used to drive the UI. All ASCII source, CJK by escape.
const RE = {
  close: /^(?:\u5173\u95ED|close)$/i, // 关闭 | close
  dismiss: /^(?:\u7EE7\u7EED|continue|\u77E5\u9053\u4E86|got it|\u5F00\u59CB\u4F7F\u7528)$/i, // 继续 知道了 开始使用
  later: /^(?:\u7A0D\u540E|later|skip|\u8DF3\u8FC7)$/i, // 稍后 跳过
  settings: /^(?:\u8BBE\u7F6E|settings)$/i, // 设置
  settingsLoose: /(?:\u8BBE\u7F6E|settings)/i,
  more: /^(?:\u66F4\u591A|more)$/i, // 更多
  newSession: /^(?:\u65B0\u4F1A\u8BDD|new session|new chat)$/i, // 新会话
  skin: ["\u76AE\u80A4", "Skin", "SKIN"], // 皮肤
};

(async () => {
  // Browser selection. The Playwright copy bundled with the DSH desktop profile
  // has no browser download of its own, so prefer an installed Chrome/Edge
  // (`channel`) and fall back to Playwright's own Chromium when present.
  const launchArgs = [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--window-size=" + job.viewport.width + "," + job.viewport.height,
  ];
  const candidates = [];
  if (job.browserChannel) candidates.push({ channel: job.browserChannel });
  candidates.push({ channel: "chrome" }, { channel: "msedge" }, {});
  let browser = null;
  let launchError = null;
  for (const candidate of candidates) {
    try {
      browser = await pw.chromium.launch({
        headless: job.headless,
        args: launchArgs,
        ...candidate,
      });
      log("[launch] " + (candidate.channel ? "channel=" + candidate.channel : "bundled chromium"));
      break;
    } catch (err) {
      launchError = err;
    }
  }
  if (!browser) throw launchError;

  const context = await browser.newContext({
    viewport: { width: job.viewport.width, height: job.viewport.height },
    deviceScaleFactor: 1,
    locale: "zh-CN",
    acceptDownloads: true,
  });
  const page = await context.newPage();

  const consoleLines = [];
  const errors = [];
  page.on("console", (msg) => {
    const type = msg.type();
    const text = "[console." + type + "] " + msg.text();
    consoleLines.push(text);
    if (type === "error") errors.push(text);
  });
  page.on("pageerror", (err) => {
    const text = "[pageerror] " + (err && err.stack ? err.stack : String(err));
    consoleLines.push(text);
    errors.push(text);
  });
  page.on("requestfailed", (req) => {
    const failure = req.failure();
    const text =
      "[requestfailed] " + req.method() + " " + req.url() + " :: " +
      (failure ? failure.errorText : "unknown");
    consoleLines.push(text);
    errors.push(text);
  });
  page.on("response", (res) => {
    const status = res.status();
    if (status < 400) return;
    const text = "[http " + status + "] " + res.request().method() + " " + res.url();
    consoleLines.push(text);
    if (res.url().includes("/dsh-glaze/")) errors.push(text);
  });

  const shot = async (label) => {
    const file = path.join(job.shotsDir, job.name + "-" + label + ".png");
    await page.screenshot({ path: file });
    log("[shot] " + file);
    return file;
  };

  // Dismiss first-run overlays that would otherwise cover the UI.
  const dismissOverlays = async () => {
    const closed = [];
    for (let i = 0; i < 8; i++) {
      const hit = await page.evaluate((re) => {
        const closeRe = new RegExp(re.close, "i");
        const dismissRe = new RegExp(re.dismiss, "i");
        const laterRe = new RegExp(re.later, "i");
        const buttons = Array.from(document.querySelectorAll("button"));
        const closeBtn = buttons.find((b) =>
          closeRe.test((b.getAttribute("aria-label") || "").trim()),
        );
        if (closeBtn) {
          closeBtn.click();
          return "close:" + (closeBtn.getAttribute("aria-label") || "");
        }
        const primary = buttons.find((b) => dismissRe.test((b.textContent || "").trim()));
        if (primary) {
          primary.click();
          return "primary:" + primary.textContent.trim();
        }
        const skip = buttons.find((b) => laterRe.test((b.textContent || "").trim()));
        if (skip) {
          skip.click();
          return "skip:" + skip.textContent.trim();
        }
        return null;
      }, {
        close: RE.close.source,
        dismiss: RE.dismiss.source,
        later: RE.later.source,
      });
      if (!hit) break;
      closed.push(hit);
      await page.waitForTimeout(350);
    }
    return closed;
  };

  const result = { steps: [], errors: null, state: null };
  const step = (obj) => {
    result.steps.push(obj);
    return obj;
  };

  // Navigate first. The authenticated URL with ?token= is what sets the session
  // cookie, so every later same-origin fetch depends on it.
  let navResponse;
  try {
    navResponse = await page.goto(job.url, { waitUntil: "domcontentloaded", timeout: 60000 });
  } catch (error) {
    throw new Error(
      "could not reach the test instance at " + job.origin + ": " +
      String(error && error.message ? error.message : error) +
      ". It may have been restarted or stopped; re-run start-test-instance.ps1 and capture again.",
    );
  }

  // Reachability / auth preflight, run ONCE the page is on the app origin so it
  // is a genuine same-origin request carrying the session cookie. A restart
  // between start and capture would otherwise surface as an opaque
  // "Failed to fetch" in the middle of the wallpaper step.
  const preflight = await page.evaluate(async (origin) => {
    try {
      const res = await fetch(origin + "/dsh-glaze/state", {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
      });
      return { ok: true, status: res.status };
    } catch (error) {
      return { ok: false, status: 0, error: String(error && error.message ? error.message : error) };
    }
  }, job.origin);

  if (navResponse && navResponse.status() === 401) {
    throw new Error(
      "the test instance answered 401 for the recorded URL: the token is stale " +
      "(the instance was restarted). Re-run start-test-instance.ps1 and capture again.",
    );
  }
  log(
    "[preflight] nav=" + (navResponse ? navResponse.status() : "n/a") +
    " pluginRoute=" + preflight.status +
    (preflight.ok ? "" : " (" + (preflight.error || "") + ")"),
  );
  // 404 is acceptable: it only means this composition does not mount dsh-glaze
  // (baseline runs). 0 / 401 mean the instance is gone or the token is stale.
  if (!preflight.ok || preflight.status === 401) {
    throw new Error(
      "the test instance is not usable at " + job.origin +
      " (plugin route status " + preflight.status +
      (preflight.error ? ", " + preflight.error : "") +
      "). Re-run start-test-instance.ps1 and capture again.",
    );
  }

  await page.waitForTimeout(job.settleMs + 1800);
  await page.waitForSelector("body", { timeout: 30000 });
  try {
    await page.waitForFunction(
      () => !!document.querySelector("style[data-plugin]"),
      null,
      { timeout: 20000 },
    );
  } catch {
    // A bare baseline composition may ship no plugin CSS; not fatal.
  }

  if (job.steps.includes("home")) {
    const s = step({ step: "home", closedOverlays: await dismissOverlays() });
    await page.waitForTimeout(job.settleMs);
    s.file = await shot("01-home");
  }

  if (job.steps.includes("settings")) {
    // Open Settings: direct entry first, then the "more" menu.
    const opened = await page.evaluate(async (re) => {
      const settingsRe = new RegExp(re.settings, "i");
      const moreRe = new RegExp(re.more, "i");
      const pick = (selector, regex) => {
        const cands = Array.from(document.querySelectorAll(selector));
        const hit = cands.find((el) => regex.test((el.textContent || "").trim()));
        if (hit) {
          hit.click();
          return (hit.textContent || "").trim();
        }
        return null;
      };
      const direct = pick("button,a,[role=button]", settingsRe);
      if (direct) return "direct:" + direct;
      const more = pick("button,[role=button]", moreRe);
      if (!more) return null;
      await new Promise((r) => setTimeout(r, 400));
      const loose = pick("button,a,[role=button],[role=menuitem]", new RegExp(re.settingsLoose, "i"));
      return loose ? "more:" + more + "->" + loose : "more:" + more;
    }, { settings: RE.settings.source, more: RE.more.source, settingsLoose: RE.settingsLoose.source });

    await page.waitForTimeout(job.settleMs + 700);
    step({ step: "settings", opened: opened || "none", file: await shot("02-settings") });

    // Find the Skin navigation entry inside Settings and click it.
    const skinNav = await page.evaluate((labels) => {
      const wanted = new Set(labels.map((l) => l.trim()));
      const cands = Array.from(
        document.querySelectorAll("button,a,[role=button],[role=tab],[role=menuitem],li,span,div"),
      );
      const hit = cands.find((el) => wanted.has((el.textContent || "").trim()));
      if (hit) {
        hit.click();
        return (hit.textContent || "").trim();
      }
      return null;
    }, RE.skin);

    await page.waitForTimeout(job.settleMs + 800);
    step({ step: "skinPage", navLabel: skinNav, file: await shot("03-settings-skin") });
  }

  if (job.steps.includes("wallpaper")) {
    // Upload through the plugin's own Host route from inside the page origin so
    // the request carries exactly the cookies the browser session holds.
    const b64 = fs.readFileSync(job.wallpaperPath).toString("base64");
    const upload = await page.evaluate(
      async ({ origin, b64 }) => {
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        try {
          const res = await fetch(origin + "/dsh-glaze/upload", {
            method: "POST",
            headers: {
              "content-type": "image/png",
              "x-dsh-glaze-name": "test-wallpaper.png",
            },
            body: bytes,
            credentials: "same-origin",
          });
          const text = await res.text();
          return { status: res.status, body: text.slice(0, 800) };
        } catch (error) {
          // A restart between steps lands here; report it as a step result
          // instead of aborting the whole capture.
          return { status: 0, body: String(error && error.message ? error.message : error), failed: true };
        }
      },
      { origin: job.origin, b64 },
    );
    step({ step: "upload", status: upload.status, body: upload.body });

    const stateAfter = await page.evaluate(async (origin) => {
      const res = await fetch(origin + "/dsh-glaze/state", {
        headers: { accept: "application/json" },
      });
      const text = await res.text();
      return { status: res.status, body: text.slice(0, 800) };
    }, job.origin);
    step({ step: "stateAfterUpload", status: stateAfter.status, body: stateAfter.body });

    // The client polls /dsh-glaze/state every few seconds, so give the backdrop
    // a bounded window to actually become visible before shooting.
    let backdropVisible = false;
    try {
      await page.waitForFunction(
        () => {
          const el = document.getElementById("dsh-glaze-backdrop");
          return !!el && el.dataset.visible === "true" && (getComputedStyle(el).backgroundImage || "").indexOf("/dsh-glaze/") >= 0;
        },
        null,
        { timeout: 15000 },
      );
      backdropVisible = true;
    } catch {
      backdropVisible = false;
    }
    log("[backdrop] visible=" + backdropVisible);

    // Back to a fresh home screen so the wallpaper sits behind the main UI.
    await page.evaluate((re) => {
      const newRe = new RegExp(re.newSession, "i");
      const cands = Array.from(document.querySelectorAll("button,a,[role=button]"));
      const hit = cands.find((el) =>
        newRe.test((el.textContent || "").replace(/Ctrl\+Alt\+N/gi, "").trim()),
      );
      if (hit) hit.click();
    }, { newSession: RE.newSession.source });
    await page.waitForTimeout(job.settleMs + 1200);
    step({ step: "wallpaperHome", backdropVisible, file: await shot("04-home-wallpaper") });

    // Close Settings if it is still open over the wallpaper, then re-shoot.
    await page.keyboard.press("Escape");
    await page.waitForTimeout(job.settleMs + 400);
    step({ step: "wallpaperHomeEsc", file: await shot("05-home-wallpaper-esc") });
  }

  if (job.steps.includes("tune")) {
    // Drive the Skin page's own controls, so the capture proves the settings
    // seam works end to end: UI control -> Host config -> repaint.
    const openSkinPage = async () => {
      await page.evaluate(async (re) => {
        const settingsRe = new RegExp(re.settings, "i");
        const moreRe = new RegExp(re.more, "i");
        const pick = (selector, regex) => {
          const hit = Array.from(document.querySelectorAll(selector)).find((el) =>
            regex.test((el.textContent || "").trim()),
          );
          if (hit) {
            hit.click();
            return true;
          }
          return false;
        };
        if (!pick("button,a,[role=button]", settingsRe)) {
          if (pick("button,[role=button]", moreRe)) {
            await new Promise((r) => setTimeout(r, 400));
            pick("button,a,[role=button],[role=menuitem]", new RegExp(re.settingsLoose, "i"));
          }
        }
      }, { settings: RE.settings.source, more: RE.more.source, settingsLoose: RE.settingsLoose.source });
      await page.waitForTimeout(job.settleMs + 600);
      await page.evaluate((labels) => {
        const wanted = new Set(labels.map((l) => l.trim()));
        const hit = Array.from(
          document.querySelectorAll("button,a,[role=button],[role=tab],[role=menuitem],li,span,div"),
        ).find((el) => wanted.has((el.textContent || "").trim()));
        if (hit) hit.click();
      }, RE.skin);
      await page.waitForTimeout(job.settleMs + 600);
    };

    // Set the Nth range input on the page (0-based) and fire the events React
    // listens for, exactly as a drag would.
    const setRange = async (index, value) => {
      return await page.evaluate(
        ({ index, value }) => {
          const inputs = Array.from(document.querySelectorAll('input[type="range"]'));
          const el = inputs[index];
          if (!el) {
            return { ok: false, count: inputs.length, labels: inputs.map((i) => i.getAttribute("aria-label")) };
          }
          const setter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype,
            "value",
          ).set;
          setter.call(el, String(value));
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
          return { ok: true, now: el.value, label: el.getAttribute("aria-label"), count: inputs.length };
        },
        { index, value },
      );
    };

    await openSkinPage();
    const opacity = await setRange(job.tuneRangeIndex || 0, job.tuneOpacity);
    step({ step: "tuneOpacity", requested: job.tuneOpacity, result: opacity });
    await page.waitForTimeout(job.settleMs + 900);
    step({ step: "tuneSkinPage", file: await shot("06-settings-skin-tuned") });

    // Back to the home screen with the tuned transparency.
    await page.keyboard.press("Escape");
    await page.waitForTimeout(job.settleMs + 500);
    await page.evaluate((re) => {
      const newRe = new RegExp(re.newSession, "i");
      const hit = Array.from(document.querySelectorAll("button,a,[role=button]")).find((el) =>
        newRe.test((el.textContent || "").replace(/Ctrl\+Alt\+N/gi, "").trim()),
      );
      if (hit) hit.click();
    }, { newSession: RE.newSession.source });
    await page.waitForTimeout(job.settleMs + 1400);
    step({ step: "tunedHome", file: await shot("07-home-tuned") });
  }

  if (job.steps.includes("scroll")) {
    // Settings -> Skin page scrolled to the bottom, to prove the tallest page
    // does not overflow or clip its last rows. Scrolls the real scroll container
    // (the Settings dialog body), not just window.
    const openSkinPage2 = async () => {
      await page.evaluate(async (re) => {
        const settingsRe = new RegExp(re.settings, "i");
        const moreRe = new RegExp(re.more, "i");
        const pick = (selector, regex) => {
          const hit = Array.from(document.querySelectorAll(selector)).find((el) =>
            regex.test((el.textContent || "").trim()),
          );
          if (hit) {
            hit.click();
            return true;
          }
          return false;
        };
        if (!pick("button,a,[role=button]", settingsRe)) {
          if (pick("button,[role=button]", moreRe)) {
            await new Promise((r) => setTimeout(r, 400));
            pick("button,a,[role=button],[role=menuitem]", new RegExp(re.settingsLoose, "i"));
          }
        }
      }, { settings: RE.settings.source, more: RE.more.source, settingsLoose: RE.settingsLoose.source });
      await page.waitForTimeout(job.settleMs + 600);
      await page.evaluate((labels) => {
        const wanted = new Set(labels.map((l) => l.trim()));
        const hit = Array.from(
          document.querySelectorAll("button,a,[role=button],[role=tab],[role=menuitem],li,span,div"),
        ).find((el) => wanted.has((el.textContent || "").trim()));
        if (hit) hit.click();
      }, RE.skin);
      await page.waitForTimeout(job.settleMs + 700);
    };

    await openSkinPage2();

    const scrollInfo = await page.evaluate(() => {
      // Find the deepest scrollable ancestor of the skin page.
      const pageEl = document.querySelector(".dsh-glaze-page") || document.querySelector(".dsh-glaze-row");
      let scroller = null;
      for (let el = pageEl; el; el = el.parentElement) {
        const cs = getComputedStyle(el);
        if (/(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 2) {
          scroller = el;
          break;
        }
      }
      const target = scroller || document.scrollingElement || document.documentElement;
      target.scrollTop = target.scrollHeight;
      // Also nudge window and the dialog card, in case the shell uses those.
      if (document.scrollingElement) document.scrollingElement.scrollTop = 1e6;
      const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'));
      for (const d of dialogs) {
        d.scrollTop = d.scrollHeight;
        for (const child of d.querySelectorAll("*")) {
          const cs = getComputedStyle(child);
          if (/(auto|scroll)/.test(cs.overflowY) && child.scrollHeight > child.clientHeight + 2) {
            child.scrollTop = child.scrollHeight;
          }
        }
      }
      const rows = Array.from(document.querySelectorAll(".dsh-glaze-row, .dsh-glaze-rowStack"));
      const last = rows[rows.length - 1];
      const lastRect = last ? last.getBoundingClientRect() : null;
      return {
        usedScroller: !!(scroller || dialogs.length),
        scrollTop: target.scrollTop,
        scrollHeight: target.scrollHeight,
        clientHeight: target.clientHeight,
        atBottom: target.scrollTop + target.clientHeight >= target.scrollHeight - 2,
        rowCount: rows.length,
        lastRowText: last ? (last.textContent || "").trim().slice(0, 80) : null,
        lastRowBottom: lastRect ? Math.round(lastRect.bottom) : null,
        viewportHeight: window.innerHeight,
        lastRowFullyVisible: lastRect ? lastRect.bottom <= window.innerHeight + 1 && lastRect.top >= -1 : null,
      };
    });
    await page.waitForTimeout(job.settleMs + 500);
    step({ step: "skinPageScrolled", scroll: scrollInfo, file: await shot("08-settings-skin-bottom") });

    // A second pass: capture just the region of the last rows, so any clipping
    // is unmistakable even at reduced preview sizes.
    const lastRowShot = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll(".dsh-glaze-row, .dsh-glaze-rowStack"));
      if (rows.length === 0) return null;
      const rects = rows.slice(-4).map((r) => r.getBoundingClientRect());
      const top = Math.max(0, Math.min(...rects.map((r) => r.top)) - 12);
      const bottom = Math.min(window.innerHeight, Math.max(...rects.map((r) => r.bottom)) + 12);
      return { x: 0, y: Math.round(top), width: window.innerWidth, height: Math.max(40, Math.round(bottom - top)) };
    });
    if (lastRowShot) {
      const clipFile = path.join(job.shotsDir, job.name + "-09-skin-bottom-rows.png");
      await page.screenshot({ path: clipFile, clip: lastRowShot });
      log("[shot] " + clipFile);
      step({ step: "skinBottomRows", clip: lastRowShot, file: clipFile });
    }
  }

  // Page-state dump: everything a skin verifier needs without reading pixels.
  result.state = await page.evaluate((origin) => {
    const pluginTags = Array.from(document.querySelectorAll("style[data-plugin-css]")).map((s) => ({
      plugin: s.dataset.plugin || null,
      css: s.dataset.pluginCss || null,
      bytes: (s.textContent || "").length,
    }));
    const skinTags = pluginTags.filter(
      (t) => t.plugin === "dsh-glaze" || (t.css || "").indexOf("dsh-glaze") === 0,
    );

    const sheetRules = [];
    for (const sheet of Array.from(document.styleSheets)) {
      let rules;
      try {
        rules = sheet.cssRules;
      } catch {
        continue;
      }
      if (!rules) continue;
      for (const rule of Array.from(rules)) {
        if (rule.cssText && rule.cssText.indexOf("dsh-glaze") >= 0) {
          sheetRules.push(rule.cssText.slice(0, 240));
        }
      }
    }

    const allStyleText = Array.from(document.querySelectorAll("style"))
      .map((s) => s.textContent || "")
      .join("\n");
    const skinVars = Array.from(new Set(allStyleText.match(/--dsh-glaze[\w-]*/g) || []));

    const skinImgs = Array.from(document.images)
      .filter((i) => ((i.currentSrc || i.src) || "").indexOf("/dsh-glaze/") >= 0)
      .map((i) => ({
        src: i.currentSrc || i.src,
        w: i.naturalWidth,
        h: i.naturalHeight,
        complete: i.complete,
      }));

    const bgLayers = Array.from(document.querySelectorAll("body *"))
      .filter((el) => {
        const cs = getComputedStyle(el);
        const bg = cs.backgroundImage || "";
        const bf = getComputedStyle(el, "::before").backgroundImage || "";
        const af = getComputedStyle(el, "::after").backgroundImage || "";
        return (
          bg.indexOf("/dsh-glaze/") >= 0 ||
          bf.indexOf("/dsh-glaze/") >= 0 ||
          af.indexOf("/dsh-glaze/") >= 0
        );
      })
      .slice(0, 12)
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        cls: (el.className || "").toString().slice(0, 120),
        bg: (getComputedStyle(el).backgroundImage || "").slice(0, 160),
      }));

    const bootEntries =
      window.__DSH_BOOT__ && window.__DSH_BOOT__.entries
        ? window.__DSH_BOOT__.entries.map((e) => e.id)
        : [];

    const navLabels = Array.from(
      document.querySelectorAll("button,a,[role=button],[role=tab],li,div"),
    )
      .map((el) => (el.textContent || "").trim())
      .filter((t) => t === "\u76AE\u80A4" || t === "Skin" || t === "SKIN");

    return {
      url: location.href,
      title: document.title,
      origin,
      htmlAttrs: Array.from(document.documentElement.attributes).map((a) => [
        a.name,
        a.value.slice(0, 200),
      ]),
      bodyAttrs: Array.from(document.body.attributes).map((a) => [
        a.name,
        a.value.slice(0, 200),
      ]),
      bodyClass: document.body.className,
      pluginStyleTagCount: pluginTags.length,
      skinStyleTags: skinTags,
      sheetRulesMentioningSkin: sheetRules.slice(0, 30),
      probes: {
        skinCssVariableNames: skinVars.slice(0, 40),
        skinCssVariableCount: skinVars.length,
        skinBackgroundElements: bgLayers,
        skinImages: skinImgs,
        skinBackdropLikeNodes: document.querySelectorAll(
          '[class*="dsh-glaze"],[data-dsh-glaze],#dsh-glaze-backdrop',
        ).length,
      },
      skinNavLabels: Array.from(new Set(navLabels)).slice(0, 10),
      bootEntryCount: bootEntries.length,
      skinInBootGraph: bootEntries.indexOf("dsh-glaze") >= 0,
    };
  }, job.origin);

  await context.close();
  await browser.close();

  result.errors = errors;
  fs.writeFileSync(job.consoleLog, LOG.join("\n") + "\n", "utf8");
  const stateLog = path.join(job.shotsDir, job.name + "-state.json");
  fs.writeFileSync(stateLog, JSON.stringify(result, null, 2), "utf8");
  log("[state] " + stateLog);
  process.stdout.write("\n__RESULT__" + JSON.stringify(result) + "\n");
})().catch((err) => {
  const message = err && err.stack ? err.stack : String(err);
  try {
    fs.writeFileSync(job.consoleLog, LOG.join("\n") + "\n[fatal] " + message + "\n", "utf8");
  } catch {
    /* best effort */
  }
  process.stdout.write("\n__FATAL__" + JSON.stringify({ error: message }) + "\n");
  process.exitCode = 1;
});
