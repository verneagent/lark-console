#!/usr/bin/env node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const DEFAULT_CONFIG_PATH = "~/.lark-console/config.json";
const DEFAULT_SELECTORS = {
  createAppButton: 'button:has-text("Create App"), button:has-text("创建应用")',
  customAppMenuItem: 'role=menuitem[name=/Custom App|自建应用/i]',
  appNameInput: 'input[placeholder="App Name"], input[placeholder="应用名称"]',
  descriptionInput: 'textarea',
  createConfirmButton: 'button:has-text("Create"), button:has-text("创建")',
  permissionNav: 'role=link[name=/Permission|权限/i]',
  credentialNav: 'role=link[name=/Credentials|凭证与基础信息/i]',
  savePermissionsButton: 'button:has-text("Save"), button:has-text("保存")',
  scopeSearchInput: 'input[placeholder*="Search"], input[placeholder*="搜索"]'
};

function parseArgs(argv) {
  const args = { headed: false, config: DEFAULT_CONFIG_PATH };
  for (let i = 2; i < argv.length; i += 1) {
    const current = argv[i];
    if (current === "--headed") {
      args.headed = true;
      continue;
    }
    if (current === "--config") {
      args.config = argv[i + 1];
      i += 1;
      continue;
    }
  }
  return args;
}

function expandUserPath(targetPath) {
  if (!targetPath) {
    return targetPath;
  }
  if (targetPath === "~") {
    return os.homedir();
  }
  if (targetPath.startsWith("~/")) {
    return path.join(os.homedir(), targetPath.slice(2));
  }
  return targetPath;
}

async function loadConfig(configPath) {
  const absolutePath = path.resolve(expandUserPath(configPath));
  const raw = await fs.readFile(absolutePath, "utf8");
  const parsed = JSON.parse(raw);
  return {
    ...parsed,
    selectors: {
      ...DEFAULT_SELECTORS,
      ...(parsed.selectors ?? {})
    }
  };
}

async function importPlaywright() {
  try {
    return await import("playwright");
  } catch {
    throw new Error("Playwright is not installed. Run `npm install playwright` in a suitable workspace first.");
  }
}

async function clickAny(page, selectorList) {
  const selectors = selectorList.split(",").map((item) => item.trim());
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.count()) {
      await locator.click();
      return;
    }
  }
  throw new Error(`No clickable selector matched: ${selectorList}`);
}

async function fillFirst(page, selectorList, value) {
  const selectors = selectorList.split(",").map((item) => item.trim());
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.count()) {
      await locator.fill(value);
      return;
    }
  }
  throw new Error(`No fillable selector matched: ${selectorList}`);
}

async function enableScope(page, scope, selectors) {
  await fillFirst(page, selectors.scopeSearchInput, scope);
  await page.waitForTimeout(400);

  const exactMatch = page.locator(`[data-scope="${scope}"]`).first();
  if (await exactMatch.count()) {
    const checkbox = exactMatch.getByRole("checkbox").first();
    if (!(await checkbox.isChecked())) {
      await checkbox.check();
    }
    return;
  }

  const textMatch = page.getByText(scope, { exact: false }).first();
  if (!(await textMatch.count())) {
    throw new Error(`Could not find scope row for ${scope}`);
  }

  const row = textMatch.locator("xpath=ancestor::*[self::tr or self::div][1]");
  const checkbox = row.getByRole("checkbox").first();
  if (!(await checkbox.isChecked())) {
    await checkbox.check();
  }
}

async function createApp(page, config) {
  const { selectors } = config;
  await clickAny(page, selectors.createAppButton);
  await clickAny(page, selectors.customAppMenuItem);
  await fillFirst(page, selectors.appNameInput, config.appName);

  if (config.description) {
    try {
      await fillFirst(page, selectors.descriptionInput, config.description);
    } catch {
      // Description is optional and some flows omit the field.
    }
  }

  await clickAny(page, selectors.createConfirmButton);
  await page.waitForLoadState("networkidle");
}

async function openPermissions(page, selectors) {
  await clickAny(page, selectors.permissionNav);
  await page.waitForLoadState("networkidle");
}

async function savePermissions(page, selectors) {
  try {
    await clickAny(page, selectors.savePermissionsButton);
    await page.waitForLoadState("networkidle");
  } catch {
    // Some pages auto-save or gate the button behind a form state change.
  }
}

async function readCredentials(page, selectors) {
  await clickAny(page, selectors.credentialNav);
  await page.waitForLoadState("networkidle");

  const bodyText = await page.locator("body").innerText();
  const appIdMatch = bodyText.match(/\b(cli_[A-Za-z0-9]+)\b/);
  return {
    appId: appIdMatch?.[1] ?? null
  };
}

async function maybeWriteOutput(config, result) {
  if (!config.outputPath) {
    return;
  }
  const outputPath = path.resolve(expandUserPath(config.outputPath));
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(result, null, 2));
}

async function main() {
  const args = parseArgs(process.argv);
  const config = await loadConfig(args.config);
  const { chromium } = await importPlaywright();

  const context = await chromium.launchPersistentContext(
    path.resolve(expandUserPath(config.profileDir ?? "~/.lark-console/profile")),
    { headless: !args.headed }
  );

  const page = context.pages()[0] ?? await context.newPage();
  await page.goto(config.consoleUrl, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");

  if (config.mode === "create-and-configure") {
    await createApp(page, config);
  }

  await openPermissions(page, config.selectors);
  for (const scope of config.scopes ?? []) {
    await enableScope(page, scope, config.selectors);
  }
  await savePermissions(page, config.selectors);

  const result = {
    appName: config.appName ?? null,
    scopes: config.scopes ?? [],
    credentials: await readCredentials(page, config.selectors)
  };

  await maybeWriteOutput(config, result);
  console.log(JSON.stringify(result, null, 2));
  await context.close();
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
