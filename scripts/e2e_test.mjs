#!/usr/bin/env node

/**
 * E2E test for console_api.mjs
 *
 * Creates a temporary Lark app, exercises set/get round-trips for all
 * configurable features, asserts consistency, then deletes the app.
 *
 * Runs in a single Playwright browser session for speed and stability.
 *
 * Usage:
 *   node scripts/e2e_test.mjs [--headed] [--keep]
 *
 * Flags:
 *   --headed   Show browser window (useful for debugging)
 *   --keep     Don't delete the app at the end (for manual inspection)
 */

import { chromium } from "playwright";
import { join } from "node:path";

const flags = process.argv.slice(2);
const headed = flags.includes("--headed");
const keep = flags.includes("--keep");
const profileDir = join(process.env.HOME, ".lark-console", "profile");

let passed = 0;
let failed = 0;

function assert(label, condition, detail) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? " — " + detail : ""}`);
    failed++;
  }
}

function section(title) {
  console.log(`\n── ${title} ──`);
}

// ── Inline API helpers (same as console_api.mjs but without CLI overhead) ──

async function getCSRF(page) {
  await page.goto("https://open.larksuite.com/app", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => null);
  return page.evaluate(() => window.csrfToken);
}

async function api(page, csrf, endpoint, body) {
  return page.evaluate(
    async ({ endpoint, body, csrf }) => {
      const resp = await fetch(`https://open.larksuite.com${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-csrf-token": csrf },
        body: JSON.stringify(body ?? {}),
      });
      return resp.json();
    },
    { endpoint, body, csrf },
  );
}

// Note: Lark console APIs all use POST, even for reads. GET returns 404.

// ──────────────────────────────────────────────
// Test cases
// ──────────────────────────────────────────────

async function main() {
  const testName = `E2E-Test-${Date.now()}`;
  console.log(`\nLark Console API — E2E Test`);
  console.log(`App name: ${testName}\n`);

  const browser = await chromium.launchPersistentContext(profileDir, {
    headless: !headed,
  });
  const page = browser.pages()[0] || (await browser.newPage());
  let appId = null;

  try {
    let csrf = await getCSRF(page);
    assert("CSRF token obtained", !!csrf);

    // ── 1. Create app ──
    section("App Create");
    const iconUrl = "https://s16-imfile-sg.feishucdn.com/static-resource/v1/v3_00vq_0264e761-529a-4555-883f-cf3ab41e41hu";
    const createRes = await api(page, csrf, "/developers/v1/app/create", {
      appSceneType: 0,
      name: testName,
      desc: "Automated E2E test — will be deleted",
      avatar: iconUrl,
      i18n: { en_us: { name: testName, description: "Automated E2E test" } },
      primaryLang: "en_us",
    });
    assert("app create succeeds", createRes.code === 0, JSON.stringify(createRes).substring(0, 200));
    appId = createRes.data?.ClientID;
    assert("app create returns appId", !!appId);
    if (!appId) throw new Error("Cannot proceed without appId");
    console.log(`  → appId: ${appId}`);

    // ── 2. App info ──
    section("App Info");
    const infoRes = await api(page, csrf, `/developers/v1/app/${appId}`, {});
    assert("app info succeeds", infoRes.code === 0);
    assert("app name matches", infoRes.data?.name === testName, `got "${infoRes.data?.name}"`);

    // ── 3. App secret ──
    section("App Secret");
    const secretRes = await api(page, csrf, `/developers/v1/secret/${appId}`, {});
    const secret = secretRes.data?.secret;
    assert("app secret returned", !!secret && secret.length > 10);

    // ── 4. Enable bot ──
    section("Bot");
    const botSwitchRes = await api(page, csrf, `/developers/v1/robot/switch/${appId}`, { enable: true });
    assert("bot switch succeeds", botSwitchRes.code === 0, JSON.stringify(botSwitchRes).substring(0, 200));

    const menuRes = await api(page, csrf, "/developers/v1/developer_panel/menu_ability", {
      clientId: appId, ability: ["bot"],
    });
    assert("bot menu ability set", menuRes.code === 0, JSON.stringify(menuRes).substring(0, 200));

    // ── 5. Scopes: add → list → verify → remove → verify ──
    section("Scopes");
    const scopeIds = [1000, 14]; // im:message:send_as_bot, contact:user.base:readonly

    for (const id of scopeIds) {
      const addRes = await api(page, csrf, `/developers/v1/scope/update/${appId}`, {
        appScopeIDs: [id], userScopeIDs: [], scopeIds: [], operation: "add",
      });
      assert(`scope ${id} add`, addRes.code === 0, JSON.stringify(addRes).substring(0, 100));
    }

    const scopesRes = await api(page, csrf, `/developers/v1/scope/${appId}`, {});
    const scopeList = scopesRes.data?.scopes || [];
    for (const id of scopeIds) {
      assert(`scope ${id} present after add`, scopeList.includes(String(id)));
    }

    // Remove scope 14
    const rmRes = await api(page, csrf, `/developers/v1/scope/update/${appId}`, {
      appScopeIDs: [14], userScopeIDs: [], scopeIds: [], operation: "del",
    });
    assert("scope 14 remove", rmRes.code === 0);

    const scopesAfter = await api(page, csrf, `/developers/v1/scope/${appId}`, {});
    const afterList = scopesAfter.data?.scopes || [];
    assert("scope 14 gone after remove", !afterList.includes("14"));
    assert("scope 1000 still present", afterList.includes("1000"));

    // ── 6. Version: publish via CLI (complex multi-step), then verify via API ──
    section("Versions");
    const { execFileSync } = await import("node:child_process");
    try {
      const pubOut = execFileSync("node", [
        join(process.env.HOME, ".agents/skills/lark-console/scripts/console_api.mjs"),
        "version", "publish", appId, "--version", "0.0.1", "--notes", "E2E test",
      ], { encoding: "utf8", timeout: 120_000 });
      assert("version publish via CLI", pubOut.includes("✓"), pubOut.substring(0, 200));
    } catch (e) {
      assert("version publish via CLI", false, e.message.substring(0, 200));
    }

    // Re-acquire CSRF after CLI used its own browser session
    await page.goto("https://open.larksuite.com/app", { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => null);
    csrf = await page.evaluate(() => window.csrfToken);

    const verListRes = await api(page, csrf, `/developers/v1/app_version/list/${appId}`, {});
    const versions = verListRes.data?.versions || [];
    assert("version list has entries", versions.length > 0);
    if (versions.length > 0) {
      assert("version 0.0.1 in list", versions.some(v => v.appVersion === "0.0.1"));
    }

    // ── 7. Callbacks: set-mode → add → list → verify → remove ──
    section("Callbacks");

    // Set mode to WS (4)
    const evSwitchRes = await api(page, csrf, `/developers/v1/event/switch/${appId}`, { eventMode: 4 });
    assert("event mode set to WS", evSwitchRes.code === 0);
    const cbSwitchRes = await api(page, csrf, `/developers/v1/callback/switch/${appId}`, { callbackMode: 4 });
    assert("callback mode set to WS", cbSwitchRes.code === 0);

    // Add callback
    const cbAddRes = await api(page, csrf, `/developers/v1/callback/update/${appId}`, {
      operation: "add", callbacks: ["card.action.trigger"], callbackMode: 4,
    });
    assert("callback add", cbAddRes.code === 0, JSON.stringify(cbAddRes).substring(0, 100));

    // List callbacks
    const cbListRes = await api(page, csrf, `/developers/v1/callback/${appId}`);
    const cbs = cbListRes.data?.callbacks || [];
    assert("callback present after add", cbs.includes("card.action.trigger"));
    assert("callback mode is 4 (WS)", cbListRes.data?.callbackMode === 4);

    // Remove callback
    const cbRmRes = await api(page, csrf, `/developers/v1/callback/update/${appId}`, {
      operation: "del", callbacks: ["card.action.trigger"], callbackMode: 4,
    });
    assert("callback remove", cbRmRes.code === 0);

    const cbAfter = await api(page, csrf, `/developers/v1/callback/${appId}`);
    assert("callback gone after remove", !(cbAfter.data?.callbacks || []).includes("card.action.trigger"));

    // ── 8. Events: add → list → verify → remove ──
    section("Events");

    const evAddRes = await api(page, csrf, `/developers/v1/event/update/${appId}`, {
      operation: "add", events: [], appEvents: ["im.message.receive_v1"], userEvents: [], eventMode: 4,
    });
    assert("event add", evAddRes.code === 0, JSON.stringify(evAddRes).substring(0, 100));

    const evListRes = await api(page, csrf, `/developers/v1/event/${appId}`);
    assert("event present after add", (evListRes.data?.events || []).includes("im.message.receive_v1"));
    assert("event mode is 4", evListRes.data?.eventMode === 4);

    const evRmRes = await api(page, csrf, `/developers/v1/event/update/${appId}`, {
      operation: "del", events: [], appEvents: ["im.message.receive_v1"], userEvents: [], eventMode: 4,
    });
    assert("event remove", evRmRes.code === 0);

    const evAfter = await api(page, csrf, `/developers/v1/event/${appId}`);
    assert("event gone after remove", !(evAfter.data?.events || []).includes("im.message.receive_v1"));

  } catch (err) {
    console.error(`\nFATAL: ${err.message}`);
    failed++;
  } finally {
    // ── Cleanup ──
    if (appId && !keep) {
      section("Cleanup");
      try {
        const csrf = await page.evaluate(() => window.csrfToken);
        // App must be unpublished (stopped) before deletion. Use admin API to stop first.
        // Navigate to admin console to get the right domain
        const delRes = await api(page, csrf, `/developers/v1/app/delete/${appId}`, {});
        if (delRes.code === 0) {
          assert("app delete succeeds", true);
        } else {
          // App may need to be stopped first — this is expected for published apps
          console.log(`  ⚠ delete returned code ${delRes.code}, trying via CLI...`);
          const { execFileSync } = await import("node:child_process");
          try {
            execFileSync("node", [
              join(process.env.HOME, ".claude/skills/lark-console/scripts/console_api.mjs"),
              "app", "delete", appId, "--force",
            ], { encoding: "utf8", timeout: 120_000 });
            assert("app delete via CLI succeeds", true);
          } catch (e) {
            assert("app delete", false, e.message.substring(0, 200));
          }
        }
      } catch (e) {
        console.error(`  ✗ cleanup failed: ${e.message}`);
        console.error(`  → Manual cleanup: delete app ${appId} in developer console`);
      }
    } else if (appId && keep) {
      console.log(`\n  → Keeping app ${appId} (--keep flag)`);
    }

    await browser.close();

    // ── Summary ──
    console.log(`\n${"═".repeat(40)}`);
    console.log(`Results: ${passed} passed, ${failed} failed`);
    console.log(`${"═".repeat(40)}\n`);
    process.exit(failed > 0 ? 1 : 0);
  }
}

main();
