#!/usr/bin/env node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const DEFAULT_CONFIG_PATH = "~/.lark-console/config.json";
const DEBUG_DIR = "~/.lark-console/debug";
const DEFAULT_SELECTORS = {
  createAppButton: 'button:has-text("Create App"), button:has-text("创建应用")',
  appNameInput: 'input[placeholder="App Name"], input[placeholder="应用名称"]',
  descriptionInput: 'textarea',
  createAppDialog: '[role="dialog"]',
  presetIcon: '[title="RobotFilled"], [title="AppDefaultFilled"]',
  createConfirmButton: 'button:has-text("Create"), button:has-text("创建")',
  permissionNav: 'role=menuitem[name=/Permissions & Scopes|Permission|权限/i], role=link[name=/Permissions & Scopes|Permission|权限/i], text=/Permissions & Scopes|Permission|权限/i',
  addScopesButton: 'button:has-text("Add permission scopes to app"), button:has-text("Add Permission Scopes")',
  batchScopesButton: 'button:has-text("Batch import/export scopes")',
  scopeDialog: '.create-app-dialog, [role="dialog"]',
  batchEditor: 'textarea[aria-label*="Editor content"]',
  batchNextButton: 'button:has-text("Next, Review New Scopes")',
  scopeDialogSearchInput: 'input[placeholder*="read group"], input[placeholder*="scope"], input[placeholder*="Search"], input[placeholder*="搜索"]',
  scopeDialogConfirmButton: 'button:has-text("Add Scopes"), button:has-text("Confirm"), button:has-text("Add"), button:has-text("Done"), button:has-text("OK")',
  botNav: 'role=link[name=/Bot|机器人/i]',
  eventSubscriptionNav: 'role=link[name=/Event Subscriptions|事件订阅/i]',
  interactiveCardNav: 'role=link[name=/Interactive Features|Card Request URL|卡片请求网址/i]',
  credentialNav: 'role=link[name=/Credentials|凭证与基础信息/i]',
  savePermissionsButton: 'button:has-text("Save"), button:has-text("保存")',
  scopeSearchInput: 'input[placeholder*="Search"], input[placeholder*="搜索"]',
  requestUrlInput: 'input[placeholder*="URL"], input[placeholder*="HTTP/HTTPS URL"]',
  cardRequestUrlInput: 'input[placeholder*="URL"], input[placeholder*="HTTP/HTTPS URL"]',
  eventSearchInput: 'input[placeholder*="Search"], input[placeholder*="搜索"]',
  saveButton: 'button:has-text("Save"), button:has-text("保存")'
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

async function clickOptional(page, selectorList) {
  if (!selectorList) {
    return false;
  }
  const selectors = selectorList.split(",").map((item) => item.trim());
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.count()) {
      await locator.click();
      return true;
    }
  }
  return false;
}

async function checkFirst(page, selectorList) {
  const selectors = selectorList.split(",").map((item) => item.trim());
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.count()) {
      if (await locator.getAttribute("role") === "switch") {
        const checked = await locator.getAttribute("aria-checked");
        if (checked !== "true") {
          await locator.click();
        }
        return;
      }
      if (await locator.isChecked?.()) {
        return;
      }
      await locator.check();
      return;
    }
  }
  throw new Error(`No checkable selector matched: ${selectorList}`);
}

async function openScopeDialog(page, selectors) {
  await clickAny(page, selectors.addScopesButton);
  await page.waitForTimeout(500);
  const gotIt = page.getByRole("button", { name: /Got It/i }).first();
  if (await gotIt.count()) {
    await gotIt.click().catch(() => null);
    await page.waitForTimeout(300);
  }
}

async function importScopes(page, scopes, selectors) {
  await clickAny(page, selectors.batchScopesButton);
  await page.waitForTimeout(500);

  const payload = JSON.stringify(
    {
      scopes: {
        tenant: scopes,
        user: []
      }
    },
    null,
    2
  );

  let editor = page.locator(selectors.batchEditor).first();
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (await editor.count()) {
      break;
    }
    await page.waitForTimeout(500);
    editor = page.locator(selectors.batchEditor).first();
  }
  if (!(await editor.count())) {
    throw new Error("Could not find batch scope import editor");
  }

  await editor.evaluate((el, value) => {
    el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }, payload);
  await page.waitForTimeout(300);

  const nextButton = page.locator(selectors.batchNextButton).first();
  if (!(await nextButton.count())) {
    throw new Error("Could not find batch scope import review button");
  }
  await nextButton.click();
  await page.waitForTimeout(800);
  await confirmScopeDialog(page, selectors);
}

async function confirmScopeDialog(page, selectors) {
  const dialog = page.locator(selectors.scopeDialog).last();
  const button = dialog.locator(selectors.scopeDialogConfirmButton).last();
  if (await button.count()) {
    await button.click();
    await page.waitForTimeout(800);
  }
}

async function createApp(page, config) {
  const { selectors } = config;
  await clickAny(page, selectors.createAppButton);
  const dialog = page.locator(selectors.createAppDialog).first();

  if (selectors.customAppMenuItem) {
    try {
      await clickAny(page, selectors.customAppMenuItem);
    } catch {
      // Lark console may open the create form directly with no intermediate menu.
    }
  }

  try {
    await fillFirst(page, selectors.appNameInput, config.appName);
  } catch {
    const inputs = dialog.locator('input[type="text"], input:not([type]), textarea');
    const count = await inputs.count();
    if (count < 1) {
      throw new Error(`No fillable selector matched: ${selectors.appNameInput}`);
    }
    await inputs.nth(0).fill(config.appName);
  }

  if (config.description) {
    try {
      await fillFirst(page, selectors.descriptionInput, config.description);
    } catch {
      const inputs = dialog.locator('input[type="text"], input:not([type]), textarea');
      const count = await inputs.count();
      if (count >= 2) {
        await inputs.nth(1).fill(config.description);
      }
    }
  }

  await clickOptional(page, selectors.presetIcon ?? "");
  const dialogButtons = dialog.locator('button');
  const buttonCount = await dialogButtons.count();
  if (buttonCount > 0) {
    await dialogButtons.nth(buttonCount - 2 >= 0 ? buttonCount - 2 : buttonCount - 1).click();
  } else {
    await clickAny(page, selectors.createConfirmButton);
  }
  await page.waitForLoadState("networkidle");
}

async function openPermissions(page, config) {
  const { selectors } = config;
  try {
    await clickAny(page, selectors.permissionNav);
  } catch {
    let appIdMatch = page.url().match(/\/app\/(cli_[A-Za-z0-9]+)\//);
    if (!appIdMatch && /\/app\/?$/.test(page.url()) && config.appName) {
      const appCard = page.getByText(config.appName, { exact: false }).first();
      if (await appCard.count()) {
        await appCard.click();
        await page.waitForLoadState("networkidle");
        appIdMatch = page.url().match(/\/app\/(cli_[A-Za-z0-9]+)\//);
      }
    }
    if (appIdMatch) {
      await page.goto(`https://open.larksuite.com/app/${appIdMatch[1]}/auth`, {
        waitUntil: "domcontentloaded"
      });
    } else {
      throw new Error(`No clickable selector matched: ${selectors.permissionNav}`);
    }
  }
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

async function saveGeneric(page, selectors) {
  try {
    await clickAny(page, selectors.saveButton);
    await page.waitForLoadState("networkidle");
  } catch {
    // Some settings pages auto-save.
  }
}

function getCurrentAppId(page) {
  return page.url().match(/\/app\/(cli_[A-Za-z0-9]+)\//)?.[1] ?? null;
}

async function dismissEventGuidance(page) {
  await page.keyboard.press("Escape").catch(() => null);
  await page.waitForTimeout(300);

  const dialog = page.getByText(/Event subscription types/i, { exact: false })
    .locator("xpath=ancestor::*[@role='dialog'][1]")
    .first();
  if (await dialog.count()) {
    const closeButton = dialog.locator(
      'button[aria-label*="Close"], button[aria-label*="close"], button:has-text("Got It"), button:has-text("Close")'
    ).first();
    if (await closeButton.count()) {
      await closeButton.click().catch(() => null);
      await page.waitForTimeout(300);
    }
  }

  await clickOptional(page, 'button:has-text("Got It"), button:has-text("Close")');
}

async function fillFieldNearLabel(page, labels, value) {
  for (const label of labels) {
    const labelNode = page.getByText(label, { exact: false }).first();
    if (!(await labelNode.count())) {
      continue;
    }

    await labelNode.scrollIntoViewIfNeeded().catch(() => null);

    const container = labelNode.locator(
      "xpath=ancestor::*[self::div or self::section or self::form or self::td or self::tr][1]"
    ).first();
    const localInput = container
      .locator('input:not([type="hidden"]):not([disabled]), textarea:not([disabled])')
      .filter({ hasNot: page.locator('input[placeholder*="Search"], input[placeholder*="搜索"]') })
      .first();
    if (await localInput.count()) {
      await localInput.fill(value);
      return;
    }

    const scopedInput = labelNode.locator(
      "xpath=following::input[not(@type='hidden') and not(@disabled)][1] | following::textarea[not(@disabled)][1]"
    ).first();
    if (await scopedInput.count()) {
      await scopedInput.fill(value);
      return;
    }
  }

  throw new Error(`Could not find labeled input for labels: ${labels.join(", ")}`);
}

async function fillRequestUrl(page, selectors, value, labels) {
  try {
    await fillFirst(page, selectors, value);
    return;
  } catch {
    await fillFieldNearLabel(page, labels, value);
  }
}

async function clickEditButtonForLabel(page, label) {
  const button = page
    .getByText(label, { exact: true })
    .first()
    .locator("xpath=ancestor::label[1]//button | ancestor::*[contains(@class, 'block-item')][1]//*[local-name()='svg' and @data-icon='EditOutlined']/ancestor::*[self::button or self::span][1]")
    .first();
  if (!(await button.count())) {
    throw new Error(`Could not find edit button for ${label}`);
  }
  await button.click();
  await page.waitForTimeout(500);
}

async function configureSubscriptionMode(page, modeLabelPattern, url, selectors) {
  await clickEditButtonForLabel(page, "Subscription mode");
  const option = page.getByText(modeLabelPattern, { exact: false }).first();
  if (await option.count()) {
    await option.click();
  }
  await fillFirst(page, selectors.requestUrlInput, url);
  await saveGeneric(page, selectors);
}

async function selectItemsInModal(page, openButtonText, names) {
  await page.getByText(openButtonText, { exact: true }).click();
  await page.waitForTimeout(800);
  const searchInput = page.locator('input[placeholder*="Search"], input[placeholder*="搜索"]').last();

  for (const name of names) {
    if (await searchInput.count()) {
      await searchInput.fill(name);
      await page.waitForTimeout(400);
    }
    const itemText = page.getByText(name, { exact: false }).last();
    if (!(await itemText.count())) {
      throw new Error(`Could not find selectable item: ${name}`);
    }
    const row = itemText.locator("xpath=ancestor::*[self::tr or self::div][1]");
    const checkbox = row.getByRole("checkbox").first();
    if (await checkbox.count()) {
      if (!(await checkbox.isChecked())) {
        await checkbox.check();
      }
    } else {
      await itemText.click();
    }
    await page.waitForTimeout(200);
  }

  await page.getByText("Confirm", { exact: true }).click();
  await page.waitForTimeout(800);
}

async function configureBot(page, config) {
  if (!config.botEnabled) {
    return;
  }
  const { selectors } = config;
  const appId = getCurrentAppId(page);
  if (appId) {
    await page.goto(`https://open.larksuite.com/app/${appId}/bot`, {
      waitUntil: "domcontentloaded"
    });
  } else {
    await clickAny(page, selectors.botNav);
  }
  await page.waitForLoadState("networkidle");
  try {
    await checkFirst(
      page,
      selectors.botEnableSwitch ??
        'input[type="checkbox"], [role="switch"], button[role="switch"]'
    );
  } catch {
    // Bot pages vary by locale/UI version; allow selector override if default misses.
  }
  await saveGeneric(page, selectors);
}

async function configureEventSubscriptions(page, config) {
  if (!config.eventSubscriptions?.requestUrl) {
    return;
  }
  const { selectors } = config;
  const appId = getCurrentAppId(page);
  if (appId) {
    await page.goto(`https://open.larksuite.com/app/${appId}/event`, {
      waitUntil: "domcontentloaded"
    });
  } else {
    await clickAny(page, selectors.eventSubscriptionNav);
  }
  await page.waitForLoadState("networkidle");
  await dismissEventGuidance(page);
  await page.getByText(/Event configuration/i, { exact: false }).first().scrollIntoViewIfNeeded().catch(
    () => null
  );
  await configureSubscriptionMode(
    page,
    /Send notifications to developer's server/i,
    config.eventSubscriptions.requestUrl,
    selectors
  );

  if ((config.eventSubscriptions.events ?? []).length) {
    await selectItemsInModal(page, "Add Events", config.eventSubscriptions.events);
  }

  await saveGeneric(page, selectors);
}

async function configureInteractiveCard(page, config) {
  if (!config.interactiveCard?.requestUrl) {
    return;
  }
  const { selectors } = config;
  const appId = getCurrentAppId(page);
  if (appId) {
    await page.goto(`https://open.larksuite.com/app/${appId}/event?tab=callback`, {
      waitUntil: "domcontentloaded"
    });
  } else {
    await clickAny(page, selectors.interactiveCardNav);
  }
  await page.waitForLoadState("networkidle");
  await dismissEventGuidance(page);
  await page.getByText(/Callback configuration/i, { exact: false }).first().click().catch(() => null);
  await configureSubscriptionMode(
    page,
    /Send callbacks to developer's server/i,
    config.interactiveCard.requestUrl,
    { ...selectors, requestUrlInput: selectors.cardRequestUrlInput }
  );
  await selectItemsInModal(page, "Add callback", config.interactiveCard.callbacks ?? ["card.action.trigger"]);
  await saveGeneric(page, selectors);
}

async function configureEncryption(page, config) {
  if (!config.encryption?.verificationToken) {
    return;
  }
  await page.getByText("Encryption Strategy", { exact: true }).click();
  await page.waitForTimeout(800);
  await clickEditButtonForLabel(page, "Verification Token");
  const tokenInput = page
    .locator('input:not([type="hidden"]):not([disabled]), textarea:not([disabled])')
    .last();
  if (!(await tokenInput.count())) {
    throw new Error("Could not find verification token input");
  }
  await tokenInput.fill(config.encryption.verificationToken);
  await saveGeneric(page, config.selectors);
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

async function writeDebugArtifacts(page, errorMessage) {
  if (!page) {
    return;
  }
  const debugDir = path.resolve(expandUserPath(DEBUG_DIR));
  await fs.mkdir(debugDir, { recursive: true });
  const bodyTexts = await page
    .locator("button, a, [role=button], [role=link]")
    .evaluateAll((els) =>
      els
        .map((el) => (el.innerText || el.textContent || "").trim())
        .filter(Boolean)
        .slice(0, 200)
    )
    .catch(() => []);
  const debugInfo = {
    error: errorMessage,
    url: page.url(),
    title: await page.title().catch(() => null),
    texts: bodyTexts
  };
  await fs.writeFile(
    path.join(debugDir, "last-error.json"),
    JSON.stringify(debugInfo, null, 2)
  );
  await page.screenshot({
    path: path.join(debugDir, "last-error.png"),
    fullPage: true
  }).catch(() => null);
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
  globalThis.__larkConsolePage = page;
  const startUrl = config.appId
    ? `https://open.larksuite.com/app/${config.appId}/auth`
    : config.consoleUrl;
  await page.goto(startUrl, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");

  if (config.mode === "create-and-configure") {
    await createApp(page, config);
  }

  await openPermissions(page, config);
  await importScopes(page, config.scopes ?? [], config.selectors);
  await savePermissions(page, config.selectors);
  await configureBot(page, config);
  await configureEventSubscriptions(page, config);
  await configureInteractiveCard(page, config);
  await configureEncryption(page, config);

  const result = {
    appName: config.appName ?? null,
    scopes: config.scopes ?? [],
    eventSubscriptions: config.eventSubscriptions ?? null,
    interactiveCard: config.interactiveCard ?? null,
    credentials: await readCredentials(page, config.selectors)
  };

  await maybeWriteOutput(config, result);
  console.log(JSON.stringify(result, null, 2));
  await context.close();
}

main().catch((error) => {
  const page = globalThis.__larkConsolePage;
  const message = error instanceof Error ? error.message : String(error);
  Promise.resolve(writeDebugArtifacts(page, message))
    .catch(() => null)
    .finally(() => {
      console.error(message);
      process.exit(1);
    });
});
