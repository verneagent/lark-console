#!/usr/bin/env node

/**
 * Clone app configuration (scopes, bot, events, card callbacks) to all apps
 * matching a name pattern.
 *
 * The source configuration is read from a JSON config file (default:
 * ~/.lark-console/config.json) using the same schema as provision_lark_app.mjs.
 *
 * Usage:
 *   node scripts/clone_app_config.mjs [--config path] [--headed] [--pattern "H-"]
 */

import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";

function expandUserPath(p) {
  if (!p) return p;
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

function parseArgs(argv) {
  const args = {
    headed: false,
    pattern: "",
    config: "~/.lark-console/config.json",
    profileDir: null,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--headed") { args.headed = true; continue; }
    if (a === "--pattern") { args.pattern = argv[++i]; continue; }
    if (a === "--config") { args.config = argv[++i]; continue; }
    if (a === "--profile") { args.profileDir = argv[++i]; continue; }
  }
  return args;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function loadConfig(configPath) {
  const absolutePath = path.resolve(expandUserPath(configPath));
  const raw = await fs.readFile(absolutePath, "utf8");
  return JSON.parse(raw);
}

async function dismissOverlays(page) {
  await page.keyboard.press("Escape").catch(() => null);
  await sleep(300);
  const gotIt = page.getByRole("button", { name: /Got It/i }).first();
  if (await gotIt.count()) {
    await gotIt.click().catch(() => null);
    await sleep(300);
  }
}

async function findApps(page, pattern) {
  await page.goto("https://open.larksuite.com/app", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => null);

  const searchInput = page.locator('input[placeholder*="Search by app name"], input[placeholder*="Search"]').first();
  if (await searchInput.count()) {
    await searchInput.fill(pattern);
    await sleep(1500);
  }

  const appCards = page.locator('a[href*="/app/cli_"]');
  const cardCount = await appCards.count();
  const apps = [];
  const seen = new Set();

  for (let i = 0; i < cardCount; i++) {
    const card = appCards.nth(i);
    const text = (await card.innerText()).trim();
    const href = await card.getAttribute("href");
    const m = href?.match(/\/app\/(cli_[A-Za-z0-9]+)/);
    if (m && text.includes(pattern) && !seen.has(m[1])) {
      seen.add(m[1]);
      apps.push({ name: text.split("\n")[0].trim(), appId: m[1] });
    }
  }
  return apps;
}

async function importScopes(page, appId, scopes) {
  await page.goto(`https://open.larksuite.com/app/${appId}/auth`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => null);
  await sleep(1000);
  await dismissOverlays(page);

  const batchBtn = page.locator('button:has-text("Batch import/export scopes")').first();
  if (!(await batchBtn.count())) {
    console.error("  Could not find batch import button");
    return false;
  }
  await batchBtn.click();
  await sleep(2000);

  const editor = page.locator('textarea[aria-label*="Editor"]').first();
  for (let attempt = 0; attempt < 10; attempt++) {
    if (await editor.count()) break;
    await sleep(500);
  }
  if (!(await editor.count())) {
    console.error("  Could not find scope editor");
    return false;
  }

  const payload = JSON.stringify({ scopes }, null, 2);
  await editor.evaluate((el, value) => {
    el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }, payload);
  await sleep(300);

  const nextBtn = page.locator('button:has-text("Next, Review New Scopes"), button:has-text("Next")').first();
  if (await nextBtn.count()) {
    await nextBtn.click();
    await sleep(1000);
  }

  const confirmBtn = page.locator('[role="dialog"] button:has-text("Add Scopes"), [role="dialog"] button:has-text("Confirm"), [role="dialog"] button:has-text("Done"), [role="dialog"] button:has-text("OK")').last();
  if (await confirmBtn.count()) {
    await confirmBtn.click();
    await sleep(1000);
  }

  return true;
}

async function enableBot(page, appId) {
  await page.goto(`https://open.larksuite.com/app/${appId}/bot`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => null);
  await sleep(1000);

  const bodyText = await page.locator("body").innerText();
  if (bodyText.includes("Delete") && bodyText.includes("Bot Setting")) {
    console.error("  Bot already enabled");
    return true;
  }

  const enableSwitch = page.locator('[role="switch"], input[type="checkbox"]').first();
  if (await enableSwitch.count()) {
    const checked = await enableSwitch.getAttribute("aria-checked");
    if (checked !== "true") {
      await enableSwitch.click();
      await sleep(500);
    }
  }

  const saveBtn = page.locator('button:has-text("Save")').first();
  if (await saveBtn.count()) {
    await saveBtn.click();
    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => null);
    await sleep(1000);
  }

  return true;
}

async function configureEvents(page, appId, config) {
  await page.goto(`https://open.larksuite.com/app/${appId}/event`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => null);
  await sleep(1000);
  await dismissOverlays(page);

  const bodyText = await page.locator("body").innerText();

  if (!bodyText.includes(config.requestUrl)) {
    const editIcon = page.getByText("Subscription mode", { exact: false }).first()
      .locator("xpath=following::button[1]");
    if (await editIcon.count()) {
      await editIcon.click().catch(() => null);
      await sleep(500);
    }

    const option = page.getByText("Send notifications to developer's server", { exact: false }).first();
    if (await option.count()) {
      await option.click().catch(() => null);
      await sleep(500);
    }

    const urlInput = page.locator('input[placeholder*="URL"]').first();
    if (await urlInput.count()) {
      await urlInput.fill(config.requestUrl);
    }

    const saveBtn = page.locator('button:has-text("Save")').first();
    if (await saveBtn.count()) {
      await saveBtn.click();
      await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => null);
      await sleep(2000);
    }
  }

  for (const eventName of config.events) {
    const currentText = await page.locator("body").innerText();
    if (currentText.includes(eventName)) {
      console.error(`  Event ${eventName} already exists, skipping`);
      continue;
    }

    const addEventsBtn = page.locator('button:has-text("Add Events"), a:has-text("Add Events")').first();
    if (!(await addEventsBtn.count())) continue;
    await addEventsBtn.click();
    await sleep(1500);

    const dialog = page.locator('[role="dialog"]').last();
    const searchInput = dialog.locator('input[placeholder*="Search"], input[placeholder*="搜索"], input[type="text"]').first();
    if (await searchInput.count()) {
      await searchInput.fill(eventName);
      await sleep(800);
    }

    let checked = false;
    const checkboxes = dialog.getByRole("checkbox");
    const cbCount = await checkboxes.count();
    for (let c = 0; c < cbCount; c++) {
      const cb = checkboxes.nth(c);
      if (!(await cb.isChecked())) {
        await cb.check().catch(() => null);
        checked = true;
        break;
      }
    }

    if (!checked) {
      const eventText = dialog.getByText(eventName, { exact: false }).first();
      if (await eventText.count()) {
        await eventText.click().catch(() => null);
        checked = true;
      }
    }

    await sleep(500);

    const confirmBtn = dialog.locator('button:has-text("Confirm"):not([disabled])').first();
    if (await confirmBtn.count()) {
      await confirmBtn.click();
      await sleep(1000);
    } else {
      await page.keyboard.press("Escape").catch(() => null);
      await sleep(500);
    }
  }

  const saveBtn2 = page.locator('button:has-text("Save")').first();
  if (await saveBtn2.count()) {
    await saveBtn2.click().catch(() => null);
    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => null);
    await sleep(1000);
  }

  return true;
}

async function configureCardCallback(page, appId, config) {
  await page.goto(`https://open.larksuite.com/app/${appId}/event?tab=callback`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => null);
  await sleep(1000);
  await dismissOverlays(page);

  const bodyText = await page.locator("body").innerText();

  if (!bodyText.includes(config.requestUrl)) {
    const editIcon = page.getByText("Subscription mode", { exact: false }).first()
      .locator("xpath=following::button[1]");
    if (await editIcon.count()) {
      await editIcon.click().catch(() => null);
      await sleep(500);
    }

    const option = page.getByText("Send callbacks to developer's server", { exact: false }).first();
    if (await option.count()) {
      await option.click().catch(() => null);
      await sleep(500);
    }

    const urlInput = page.locator('input[placeholder*="URL"]').first();
    if (await urlInput.count()) {
      await urlInput.fill(config.requestUrl);
    }

    const saveBtn = page.locator('button:has-text("Save")').first();
    if (await saveBtn.count()) {
      await saveBtn.click();
      await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => null);
      await sleep(2000);
    }
  }

  for (const cbName of config.callbacks) {
    const currentText = await page.locator("body").innerText();
    if (currentText.includes(cbName)) {
      console.error(`  Callback ${cbName} already exists, skipping`);
      continue;
    }

    const addBtn = page.locator('button:has-text("Add callback"), a:has-text("Add callback")').first();
    if (!(await addBtn.count())) continue;
    await addBtn.click();
    await sleep(1000);

    const dialog = page.locator('[role="dialog"]').last();
    const checkboxes = dialog.getByRole("checkbox");
    const cbCount = await checkboxes.count();
    for (let c = 0; c < cbCount; c++) {
      const cb = checkboxes.nth(c);
      if (!(await cb.isChecked())) {
        await cb.check().catch(() => null);
        break;
      }
    }
    await sleep(500);

    const confirmBtn = dialog.locator('button:has-text("Confirm"):not([disabled])').first();
    if (await confirmBtn.count()) {
      await confirmBtn.click();
      await sleep(1000);
    } else {
      await page.keyboard.press("Escape").catch(() => null);
      await sleep(500);
    }
  }

  const saveBtn2 = page.locator('button:has-text("Save")').first();
  if (await saveBtn2.count()) {
    await saveBtn2.click().catch(() => null);
    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => null);
    await sleep(1000);
  }

  return true;
}

async function main() {
  const args = parseArgs(process.argv);
  const config = await loadConfig(args.config);
  const { chromium } = await import("playwright");

  if (!args.pattern && !config.clonePattern) {
    console.error("Error: --pattern is required (or set clonePattern in config)");
    process.exit(1);
  }
  const pattern = args.pattern || config.clonePattern;

  // Build scopes object from config
  const scopes = {};
  if (config.scopes) {
    // Config may have scopes as an array (tenant only) or as {tenant, user}
    if (Array.isArray(config.scopes)) {
      scopes.tenant = config.scopes;
      scopes.user = [];
    } else {
      scopes.tenant = config.scopes.tenant ?? [];
      scopes.user = config.scopes.user ?? [];
    }
  }

  const profileDir = args.profileDir
    ?? config.profileDir
    ?? "~/.lark-console/profile";

  const ctx = await chromium.launchPersistentContext(
    path.resolve(expandUserPath(profileDir)),
    { headless: !args.headed }
  );
  const page = ctx.pages()[0] ?? await ctx.newPage();

  const apps = await findApps(page, pattern);
  console.log(JSON.stringify({ status: "found", count: apps.length, apps }));

  if (apps.length === 0) {
    await ctx.close();
    return;
  }

  const results = [];

  for (const app of apps) {
    console.error(`\nConfiguring ${app.name} (${app.appId})...`);
    const result = { app: app.name, appId: app.appId, steps: {} };

    try {
      // 1. Import scopes (if configured)
      if (scopes.tenant?.length || scopes.user?.length) {
        console.error("  Importing scopes...");
        result.steps.scopes = await importScopes(page, app.appId, scopes);
      }

      // 2. Enable bot (if configured)
      if (config.botEnabled) {
        console.error("  Enabling bot...");
        result.steps.bot = await enableBot(page, app.appId);
      }

      // 3. Configure event subscriptions (if configured)
      if (config.eventSubscriptions?.requestUrl) {
        console.error("  Configuring events...");
        result.steps.events = await configureEvents(page, app.appId, config.eventSubscriptions);
      }

      // 4. Configure card callbacks (if configured)
      const cardConfig = config.interactiveCard ?? config.cardCallback;
      if (cardConfig?.requestUrl) {
        console.error("  Configuring card callbacks...");
        result.steps.cardCallback = await configureCardCallback(page, app.appId, cardConfig);
      }

      result.status = "ok";
    } catch (err) {
      result.status = "error";
      result.error = err.message;
      const debugDir = path.resolve(expandUserPath("~/.lark-console/debug"));
      await fs.mkdir(debugDir, { recursive: true }).catch(() => null);
      await page.screenshot({
        path: path.join(debugDir, `clone-error-${app.appId}.png`),
        fullPage: true,
      }).catch(() => null);
    }

    results.push(result);
  }

  console.log(JSON.stringify({ status: "done", results }, null, 2));
  await ctx.close();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
