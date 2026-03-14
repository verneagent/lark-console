#!/usr/bin/env node

/**
 * Publish versions for all apps matching a name pattern.
 *
 * Usage:
 *   node scripts/publish_apps.mjs --pattern "H-" --version "1.0.0" --notes "init" [--headed]
 *   node scripts/publish_apps.mjs --config ~/.lark-console/config.json --version "1.0.0" --notes "init"
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
    version: "1.0.0",
    notes: "init",
    profileDir: null,
    config: null,
    consoleUrl: "https://open.larksuite.com/app",
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--headed") { args.headed = true; continue; }
    if (a === "--pattern") { args.pattern = argv[++i]; continue; }
    if (a === "--version") { args.version = argv[++i]; continue; }
    if (a === "--notes") { args.notes = argv[++i]; continue; }
    if (a === "--profile") { args.profileDir = argv[++i]; continue; }
    if (a === "--config") { args.config = argv[++i]; continue; }
  }
  return args;
}

async function loadConfig(configPath) {
  if (!configPath) return {};
  const absolutePath = path.resolve(expandUserPath(configPath));
  try {
    const raw = await fs.readFile(absolutePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const args = parseArgs(process.argv);
  const config = await loadConfig(args.config);
  const { chromium } = await import("playwright");

  const pattern = args.pattern || config.clonePattern || "";
  if (!pattern) {
    console.error("Error: --pattern is required (or set clonePattern in config)");
    process.exit(1);
  }

  const profileDir = args.profileDir
    ?? config.profileDir
    ?? "~/.lark-console/profile";

  const context = await chromium.launchPersistentContext(
    path.resolve(expandUserPath(profileDir)),
    { headless: !args.headed }
  );

  const page = context.pages()[0] ?? await context.newPage();

  // Step 1: Go to app list and find matching apps
  await page.goto(args.consoleUrl, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");

  // Search for the pattern
  const searchInput = page.locator('input[placeholder*="Search by app name"], input[placeholder*="Search"]').first();
  if (await searchInput.count()) {
    await searchInput.fill(pattern);
    await sleep(1500);
  }

  // Collect all app cards matching the pattern
  // App cards contain the app name and link to the app page
  const appCards = page.locator(`a[href*="/app/cli_"]`);
  const cardCount = await appCards.count();

  const apps = [];
  for (let i = 0; i < cardCount; i++) {
    const card = appCards.nth(i);
    const text = (await card.innerText()).trim();
    const href = await card.getAttribute("href");
    const appIdMatch = href?.match(/\/app\/(cli_[A-Za-z0-9]+)/);
    if (appIdMatch && text.includes(pattern)) {
      apps.push({ name: text.split("\n")[0].trim(), appId: appIdMatch[1] });
    }
  }

  // Deduplicate by appId
  const seen = new Set();
  const uniqueApps = apps.filter((a) => {
    if (seen.has(a.appId)) return false;
    seen.add(a.appId);
    return true;
  });

  if (uniqueApps.length === 0) {
    // Try alternative: get all visible text and parse app names
    const bodyText = await page.locator("body").innerText();
    console.log(JSON.stringify({ status: "no_apps_found", pattern, bodyText: bodyText.slice(0, 2000) }));
    await context.close();
    return;
  }

  console.log(JSON.stringify({ status: "found", apps: uniqueApps }));

  const results = [];

  for (const app of uniqueApps) {
    console.error(`Publishing ${app.name} (${app.appId})...`);
    try {
      // Navigate to version page
      await page.goto(`https://open.larksuite.com/app/${app.appId}/version`, {
        waitUntil: "domcontentloaded",
      });
      await page.waitForLoadState("networkidle");
      await sleep(1000);

      // Check if there's already a version or we need to create one
      const pageText = await page.locator("body").innerText();

      // Click "Create Version" button
      const createBtn = page.locator('button:has-text("Create Version"), button:has-text("Create version"), a:has-text("Create Version")').first();
      if (await createBtn.count()) {
        await createBtn.click();
        await page.waitForLoadState("networkidle");
        await sleep(1000);
      } else {
        // Maybe navigate directly
        await page.goto(`https://open.larksuite.com/app/${app.appId}/version/create`, {
          waitUntil: "domcontentloaded",
        });
        await page.waitForLoadState("networkidle");
        await sleep(1000);
      }

      // Fill version number using placeholder
      const versionInput = page.locator('input[placeholder*="Official app version"]').first();
      if (await versionInput.count()) {
        await versionInput.fill(args.version);
      }

      // Fill "What's new" textarea
      const whatsNewTa = page.locator("textarea[placeholder*=\"What's new\"]").first();
      if (await whatsNewTa.count()) {
        await whatsNewTa.fill(args.notes);
      }

      // Fill "Reason" textarea (the long placeholder one)
      const reasonTa = page.locator('textarea[placeholder*="approver"]').first();
      if (await reasonTa.count()) {
        await reasonTa.fill(args.notes);
      }

      await sleep(500);

      // Save the version
      const saveBtn = page.locator('button:has-text("Save"), button:has-text("Submit")').first();
      if (await saveBtn.count()) {
        await saveBtn.click();
        await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => null);
        await sleep(3000);
      }

      // Multi-step release with confirmation dialog handling
      async function clickButtonIfPresent(text, opts = {}) {
        const btn = page.locator(`button:has-text("${text}")`).first();
        if (await btn.count()) {
          // Dismiss any overlaying confirm dialog first
          const confirmDialog = page.locator('.ud__confirm__footer button:has-text("Confirm"), .ud__confirm__footer button:has-text("OK")').first();
          if (await confirmDialog.count()) {
            await confirmDialog.click({ force: true }).catch(() => null);
            await sleep(2000);
          }
          // Now try clicking the target button
          if (await btn.count()) {
            await btn.click({ force: true, timeout: 10000 }).catch(() => null);
            await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => null);
            await sleep(2000);
          }
          // Handle any new confirm dialog that appeared
          const newConfirm = page.locator('.ud__confirm__footer button:has-text("Confirm"), .ud__confirm button:has-text("OK"), [role="dialog"] button:has-text("Confirm")').first();
          if (await newConfirm.count()) {
            await newConfirm.click({ force: true }).catch(() => null);
            await sleep(2000);
          }
          return true;
        }
        return false;
      }

      await clickButtonIfPresent("Submit for release");
      await clickButtonIfPresent("Submit for Release");
      await clickButtonIfPresent("Apply for release");
      await clickButtonIfPresent("Publish");
      await clickButtonIfPresent("Release");
      // Final catch-all for any remaining confirm dialogs
      const anyConfirm = page.locator('[role="dialog"] button:has-text("Confirm"), [role="dialog"] button:has-text("OK")').first();
      if (await anyConfirm.count()) {
        await anyConfirm.click({ force: true }).catch(() => null);
        await sleep(1000);
      }

      // Re-check version page for status
      await page.goto(`https://open.larksuite.com/app/${app.appId}/version`, {
        waitUntil: "domcontentloaded",
      });
      await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => null);
      const finalText = await page.locator("body").innerText();
      const released = /Released|Enabled|published|已发布|Under review|审核中/.test(finalText);

      results.push({ app: app.name, appId: app.appId, status: released ? "published" : "submitted", pageSnippet: finalText.slice(0, 500) });
    } catch (err) {
      results.push({ app: app.name, appId: app.appId, status: "error", error: err.message });
    }
  }

  console.log(JSON.stringify({ status: "done", results }, null, 2));
  await context.close();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
