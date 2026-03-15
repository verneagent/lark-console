#!/usr/bin/env node

/**
 * Lark Developer Console API client.
 *
 * Manages scopes, callbacks, and versions via the console's internal APIs.
 * Uses Playwright only for authentication (CSRF token + session cookies),
 * then all operations are pure HTTP calls.
 *
 * Usage:
 *   node console_api.mjs scopes list <appId>
 *   node console_api.mjs scopes add <appId> <scopeId1> [scopeId2 ...]
 *   node console_api.mjs scopes remove <appId> <scopeId1> [scopeId2 ...]
 *   node console_api.mjs scopes find <appId> <keyword>
 *   node console_api.mjs callbacks list <appId>
 *   node console_api.mjs callbacks add <appId> <callback1> [callback2 ...]
 *   node console_api.mjs callbacks remove <appId> <callback1> [callback2 ...]
 *   node console_api.mjs version list <appId>
 *   node console_api.mjs version create <appId> --version <ver> --notes <notes>
 *   node console_api.mjs version publish <appId> --version <ver> --notes <notes>
 *   node console_api.mjs app create --name <name> [--desc <desc>]
 *   node console_api.mjs app info <appId>
 *   node console_api.mjs app secret <appId>
 *   node console_api.mjs app set-icon <appId> --icon <path>
 *   node console_api.mjs app enable-bot <appId>
 *   node console_api.mjs app set-webhook <appId> --url <webhookUrl>
 *   node console_api.mjs app set-card-url <appId> --url <cardUrl>
 *
 * Options:
 *   --profile <dir>  Playwright profile directory (default: ~/.lark-console/profile)
 *   --headed         Run browser in headed mode (visible)
 *   --json           Output raw JSON
 */

import { chromium } from "playwright";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

function expandUser(p) {
  if (!p) return p;
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

function parseArgs() {
  const argv = process.argv.slice(2);
  const opts = {
    profile: expandUser("~/.lark-console/profile"),
    headed: false,
    json: false,
    version: null,
    notes: null,
    icon: null,
    name: null,
    desc: null,
    url: null,
    args: [],
  };
  let i = 0;
  while (i < argv.length) {
    const a = argv[i];
    if (a === "--profile") { opts.profile = expandUser(argv[++i]); }
    else if (a === "--headed") { opts.headed = true; }
    else if (a === "--json") { opts.json = true; }
    else if (a === "--version") { opts.version = argv[++i]; }
    else if (a === "--notes") { opts.notes = argv[++i]; }
    else if (a === "--icon") { opts.icon = expandUser(argv[++i]); }
    else if (a === "--name") { opts.name = argv[++i]; }
    else if (a === "--desc") { opts.desc = argv[++i]; }
    else if (a === "--url") { opts.url = argv[++i]; }
    else { opts.args.push(a); }
    i++;
  }
  return opts;
}

async function getAuthContext(profileDir, headed) {
  const browser = await chromium.launchPersistentContext(profileDir, {
    headless: !headed,
    args: ["--disable-blink-features=AutomationControlled"],
  });

  const page = browser.pages()[0] || await browser.newPage();

  // Navigate to any console page to get CSRF token
  await page.goto("https://open.larksuite.com/app", {
    waitUntil: "networkidle",
    timeout: 30000,
  });

  // Check login
  const url = page.url();
  if (url.includes("login") || url.includes("passport")) {
    if (headed) {
      console.error("Not logged in. Please log in in the browser window...");
      await page.waitForURL(/\/app/, { timeout: 120000 });
    } else {
      console.error("ERROR: Not logged in. Run with --headed to log in manually.");
      await browser.close();
      process.exit(1);
    }
  }

  const csrfToken = await page.evaluate(() => window.csrfToken);
  if (!csrfToken) {
    console.error("ERROR: Could not get CSRF token");
    await browser.close();
    process.exit(1);
  }

  return { browser, page, csrfToken };
}

async function api(page, csrfToken, endpoint, body = {}) {
  return page.evaluate(
    async ({ ep, csrf, body }) => {
      const res = await fetch(ep, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-csrf-token": csrf },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      try { return JSON.parse(text); }
      catch { return { code: -1, text }; }
    },
    { ep: endpoint, csrf: csrfToken, body },
  );
}

// ──── Scopes ────

async function scopesList(page, csrf, appId, jsonMode) {
  const res = await api(page, csrf, `/developers/v1/scope/all/${appId}`);
  if (res.code !== 0) { console.error("Error:", res); return; }

  const scopes = res.data?.scopes || [];
  const applied = scopes.filter((s) => s.status === 5);
  const pending = scopes.filter((s) => s.status === 1);

  if (jsonMode) {
    console.log(JSON.stringify({ applied, pending, total: scopes.length }, null, 2));
    return;
  }

  console.log(`Active scopes (${applied.length}):`);
  for (const s of applied.sort((a, b) => a.name.localeCompare(b.name))) {
    console.log(`  ✓ ${s.name} (ID: ${s.id})`);
  }
  if (pending.length) {
    console.log(`\nPending (${pending.length}):`);
    for (const s of pending) {
      console.log(`  ⏳ ${s.name} (ID: ${s.id})`);
    }
  }
  console.log(`\nTotal available: ${scopes.length}`);
}

async function scopesFind(page, csrf, appId, keyword) {
  const res = await api(page, csrf, `/developers/v1/scope/all/${appId}`);
  if (res.code !== 0) { console.error("Error:", res); return; }

  const scopes = res.data?.scopes || [];
  const kw = keyword.toLowerCase();
  const matches = scopes.filter((s) =>
    s.name?.toLowerCase().includes(kw) ||
    s.desc?.toLowerCase().includes(kw) ||
    s.bizId?.toLowerCase().includes(kw)
  );

  console.log(`Scopes matching "${keyword}" (${matches.length}):`);
  for (const s of matches) {
    const st = s.status === 5 ? "✓" : s.status === 0 ? "·" : s.status === 1 ? "⏳" : `?${s.status}`;
    console.log(`  ${st} ${s.name} (ID: ${s.id}) — ${s.desc}`);
  }
}

async function scopesAdd(page, csrf, appId, scopeIds) {
  for (const id of scopeIds) {
    const res = await api(page, csrf, `/developers/v1/scope/update/${appId}`, {
      appScopeIDs: [id],
      userScopeIDs: [],
      scopeIds: [],
      operation: "add",
    });
    console.log(`  Add scope ${id}: ${res.code === 0 ? "✓" : "✗ " + JSON.stringify(res)}`);
  }
  console.log("\nNote: Publish a new version for changes to take effect.");
}

async function scopesRemove(page, csrf, appId, scopeIds) {
  for (const id of scopeIds) {
    const res = await api(page, csrf, `/developers/v1/scope/update/${appId}`, {
      appScopeIDs: [id],
      userScopeIDs: [],
      scopeIds: [],
      operation: "del",
    });
    console.log(`  Remove scope ${id}: ${res.code === 0 ? "✓" : "✗ " + JSON.stringify(res)}`);
  }
  console.log("\nNote: Publish a new version for changes to take effect.");
}

// ──── Callbacks ────

async function callbacksList(page, csrf, appId, jsonMode) {
  const res = await api(page, csrf, `/developers/v1/callback/${appId}`);
  if (res.code !== 0) { console.error("Error:", res); return; }

  if (jsonMode) {
    console.log(JSON.stringify(res.data, null, 2));
    return;
  }

  const callbacks = res.data?.callbacks || [];
  const mode = res.data?.callbackMode;
  console.log(`Callback mode: ${mode === 1 ? "HTTP" : mode === 2 ? "WebSocket" : mode}`);
  console.log(`Subscribed callbacks (${callbacks.length}):`);
  for (const cb of callbacks) {
    console.log(`  ✓ ${cb}`);
  }
}

async function callbacksAdd(page, csrf, appId, callbacks) {
  const res = await api(page, csrf, `/developers/v1/callback/update/${appId}`, {
    operation: "add",
    callbacks,
    callbackMode: 1,
  });
  console.log(`Add callbacks: ${res.code === 0 ? "✓" : "✗ " + JSON.stringify(res)}`);
}

async function callbacksRemove(page, csrf, appId, callbacks) {
  const res = await api(page, csrf, `/developers/v1/callback/update/${appId}`, {
    operation: "del",
    callbacks,
    callbackMode: 1,
  });
  console.log(`Remove callbacks: ${res.code === 0 ? "✓" : "✗ " + JSON.stringify(res)}`);
}

// ──── Versions ────

async function versionList(page, csrf, appId, jsonMode) {
  const res = await api(page, csrf, `/developers/v1/app_version/list/${appId}`);
  if (res.code !== 0) { console.error("Error:", res); return; }

  const versions = res.data?.versions || [];

  if (jsonMode) {
    console.log(JSON.stringify(versions, null, 2));
    return;
  }

  console.log(`Versions (${versions.length}):`);
  for (const v of versions) {
    const date = v.publishTime ? new Date(v.publishTime * 1000).toISOString().slice(0, 10) : "?";
    console.log(`  ${v.appVersion} (${date}) — ${v.updateRemark || ""}`);
  }
}

async function versionCreate(page, csrf, appId, version, notes) {
  if (!version) { console.error("ERROR: --version is required"); process.exit(1); }
  if (!notes) notes = version;

  // Get current app info to find user ID
  const appInfo = await api(page, csrf, `/developers/v1/app/${appId}`);
  const userId = appInfo.data?.createUser || "";

  // Get apply reason config from change endpoint
  const changeRes = await api(page, csrf, `/developers/v1/app_version/change/${appId}`);
  const applyConfig = changeRes.data?.applyReasonConfig || {
    apiPrivilegeNeedReason: false,
    contactPrivilegeNeedReason: false,
    dataPrivilegeReasonMap: {},
    visibleScopeNeedReason: false,
    apiPrivilegeReasonMap: {},
    contactPrivilegeReason: "",
    isDataPrivilegeExpandMap: {},
    visibleScopeReason: "",
    dataPrivilegeNeedReason: false,
    isAutoAudit: false,
    isContactExpand: false,
  };

  // Get visible range
  const visibleRes = await api(page, csrf, `/developers/v1/visible/online/${appId}`);
  const members = (visibleRes.data?.members || []).map((m) => m.id);
  const departments = (visibleRes.data?.departments || []).map((d) => d.id || d);

  const createRes = await api(page, csrf, `/developers/v1/app_version/create/${appId}`, {
    appVersion: version,
    mobileDefaultAbility: "bot",
    pcDefaultAbility: "bot",
    changeLog: notes,
    visibleSuggest: {
      departments,
      members: members.length ? members : userId ? [userId] : [],
      groups: [],
      isAll: visibleRes.data?.isAll || 0,
    },
    applyReasonConfig: applyConfig,
  });

  if (createRes.code !== 0) {
    console.error("Error creating version:", JSON.stringify(createRes));
    return null;
  }

  const versionId = createRes.data?.versionId;
  console.log(`✓ Created version ${version} (ID: ${versionId})`);
  return versionId;
}

async function versionPublish(page, csrf, appId, version, notes) {
  const versionId = await versionCreate(page, csrf, appId, version, notes);
  if (!versionId) return;

  // Check auto-approval
  const approvalRes = await api(page, csrf, `/developers/v1/approval_nodes/get/${appId}`, {
    versionId,
    visibleSuggest: { departments: [], members: [], groups: [], isAll: 0 },
    blackVisibleSuggest: { departments: [], members: [], groups: [], isAll: 0 },
    b2cShareSuggest: false,
  });

  const canAutoApproval = approvalRes.data?.canAutoApproval;
  console.log(`Auto-approval: ${canAutoApproval ? "yes" : "no (requires admin review)"}`);

  // Publish
  const publishRes = await api(page, csrf, `/developers/v1/publish/commit/${appId}/${versionId}`);
  if (publishRes.code !== 0) {
    console.error("Error publishing:", JSON.stringify(publishRes));
    return;
  }

  if (canAutoApproval) {
    console.log(`✓ Version ${version} published successfully`);
  } else {
    console.log(`✓ Version ${version} submitted for review (pending admin approval)`);
  }
}

// ──── App Info ────

async function appInfo(page, csrf, appId, jsonMode) {
  const res = await api(page, csrf, `/developers/v1/app/${appId}`);
  if (res.code !== 0) { console.error("Error:", res); return; }

  if (jsonMode) {
    console.log(JSON.stringify(res.data, null, 2));
    return;
  }

  const d = res.data || {};
  console.log(`App: ${d.clientID}`);
  console.log(`Name: ${d.name || "?"}`);
  console.log(`Desc: ${d.desc || ""}`);
  console.log(`Status: ${d.appStatus === 1 ? "Enabled" : d.appStatus}`);
  console.log(`Abilities: ${(d.ability || []).join(", ")}`);
  console.log(`Audit status: ${d.auditStatus}`);
  console.log(`Latest version ID: ${d.auditVersionId || "none"}`);
}

// ──── Icon ────

async function appSetIcon(page, csrf, appId, iconPath) {
  if (!iconPath) { console.error("ERROR: --icon <path> is required"); process.exit(1); }
  if (!fs.existsSync(iconPath)) { console.error(`ERROR: File not found: ${iconPath}`); process.exit(1); }

  const stat = fs.statSync(iconPath);
  if (stat.size > 2 * 1024 * 1024) {
    console.error(`ERROR: Icon must be under 2MB (got ${(stat.size / 1024 / 1024).toFixed(1)}MB)`);
    process.exit(1);
  }

  const iconBuffer = fs.readFileSync(iconPath);
  const iconBase64 = iconBuffer.toString("base64");

  // Step 1: Upload image via API
  console.log("Uploading image...");
  const uploadRes = await page.evaluate(
    async ({ csrf, base64Data }) => {
      const byteChars = atob(base64Data);
      const byteArr = new Uint8Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) {
        byteArr[i] = byteChars.charCodeAt(i);
      }
      const file = new File([byteArr], "image.png", { type: "image/png" });

      const fd = new FormData();
      fd.append("file", file);
      fd.append("uploadType", "4");
      fd.append("isIsv", "false");
      fd.append("scale", JSON.stringify({ width: 240, height: 240 }));

      const res = await fetch("/developers/v1/app/upload/image", {
        method: "POST",
        headers: { "x-csrf-token": csrf, "X-Timezone-Offset": String(new Date().getTimezoneOffset()) },
        body: fd,
      });
      return res.json();
    },
    { csrf, base64Data: iconBase64 },
  );

  if (uploadRes.code !== 0) {
    console.error("Upload failed:", JSON.stringify(uploadRes));
    return;
  }

  const imageUrl = uploadRes.data?.url;
  if (!imageUrl) {
    console.error("No image URL in response:", JSON.stringify(uploadRes));
    return;
  }
  console.log("✓ Image uploaded");

  // Step 2: Set as app icon via base_info API
  const setRes = await api(page, csrf, `/developers/v1/base_info/${appId}`, {
    avatar: imageUrl,
    homePage: "",
  });

  if (setRes.code !== 0) {
    console.error("Set icon failed:", JSON.stringify(setRes));
    return;
  }

  console.log("✓ Icon set successfully");
  console.log("\nNote: Publish a new version for the icon change to take effect.");
}

// ──── App Create ────

async function appCreate(page, csrf, opts) {
  const name = opts.name;
  if (!name) { console.error("ERROR: --name is required"); process.exit(1); }
  const desc = opts.desc || name;

  // Upload default icon (the console requires an avatar URL)
  // Use an existing default icon from the console's presets
  const iconUrl = "https://s16-imfile-sg.feishucdn.com/static-resource/v1/v3_00vq_0264e761-529a-4555-883f-cf3ab41e41hu";

  const res = await api(page, csrf, "/developers/v1/app/create", {
    appSceneType: 0,
    name,
    desc,
    avatar: iconUrl,
    i18n: { en_us: { name, description: desc } },
    primaryLang: "en_us",
  });

  if (res.code !== 0) {
    console.error("Error creating app:", JSON.stringify(res));
    return;
  }

  const appId = res.data?.ClientID;
  console.log(`✓ Created app: ${appId}`);
  console.log(`  Name: ${name}`);
  console.log(`  Description: ${desc}`);

  // Get the secret
  const secretRes = await api(page, csrf, `/developers/v1/secret/${appId}`);
  if (secretRes.code === 0 && secretRes.data?.secret) {
    console.log(`  Secret: ${secretRes.data.secret}`);
  }
}

// ──── App Secret ────

async function appSecret(page, csrf, appId) {
  const res = await api(page, csrf, `/developers/v1/secret/${appId}`);
  if (res.code !== 0) { console.error("Error:", res); return; }
  console.log(res.data?.secret || "not found");
}

// ──── Bot Enable ────

async function appEnableBot(page, csrf, appId) {
  // Step 1: Enable the bot capability
  const switchRes = await api(page, csrf, `/developers/v1/robot/switch/${appId}`, {
    enable: true,
  });
  if (switchRes.code !== 0) {
    console.error("Error enabling bot:", JSON.stringify(switchRes));
    return;
  }

  // Step 2: Register bot in the menu ability list
  const menuRes = await api(page, csrf, "/developers/v1/developer_panel/menu_ability", {
    clientId: appId,
    ability: ["bot"],
  });
  if (menuRes.code !== 0) {
    console.error("Error registering bot ability:", JSON.stringify(menuRes));
    return;
  }

  console.log("✓ Bot enabled");
}

// ──── Webhook URL ────

async function appSetWebhook(page, csrf, appId, url) {
  if (!url) { console.error("ERROR: --url is required"); process.exit(1); }

  // Get the verification token first
  const eventRes = await api(page, csrf, `/developers/v1/event/${appId}`);
  if (eventRes.code !== 0) {
    console.error("Error getting event config:", JSON.stringify(eventRes));
    return;
  }

  const verificationToken = eventRes.data?.verificationToken;
  if (!verificationToken) {
    console.error("No verification token found");
    return;
  }

  // Set the webhook URL (this triggers URL verification)
  const checkRes = await api(page, csrf, `/developers/v1/event/check_url/${appId}`, {
    verificationToken,
    verificationUrl: url,
  });

  if (checkRes.code !== 0) {
    console.error("Error setting webhook URL:", JSON.stringify(checkRes));
    return;
  }

  if (checkRes.data?.access) {
    console.log(`✓ Webhook URL set and verified: ${url}`);
  } else {
    console.log(`⚠ Webhook URL set but verification failed: ${checkRes.data?.msg || "unknown error"}`);
    console.log("  The URL must respond to Lark's challenge request.");
  }
}

async function appSetCardUrl(page, csrf, appId, url) {
  if (!url) { console.error("ERROR: --url is required"); process.exit(1); }

  // Get the robot config to check current callback URL
  const robotRes = await api(page, csrf, `/developers/v1/robot/${appId}`);
  if (robotRes.code !== 0) {
    console.error("Error getting robot config:", JSON.stringify(robotRes));
    return;
  }

  // Get the verification token from event config
  const eventRes = await api(page, csrf, `/developers/v1/event/${appId}`);
  const verificationToken = eventRes.data?.verificationToken;

  // Set card callback URL via the robot config update
  // The check_url endpoint works for card callbacks too (on the callback tab)
  const checkRes = await api(page, csrf, `/developers/v1/event/check_url/${appId}`, {
    verificationToken,
    verificationUrl: url,
    checkType: "callback",
  });

  if (checkRes.code === 0) {
    console.log(`✓ Card callback URL set: ${url}`);
  } else {
    // Try alternative approach via robot update
    console.log(`⚠ Card callback URL verification: ${checkRes.data?.msg || "check response"}`);
  }
}

// ──── Main ────

async function main() {
  const opts = parseArgs();
  const [domain, action, appId, ...rest] = opts.args;

  if (!domain || !action) {
    console.log(`Usage:
  node console_api.mjs scopes list <appId>
  node console_api.mjs scopes add <appId> <scopeId1> [scopeId2 ...]
  node console_api.mjs scopes remove <appId> <scopeId1> [scopeId2 ...]
  node console_api.mjs scopes find <appId> <keyword>
  node console_api.mjs callbacks list <appId>
  node console_api.mjs callbacks add <appId> <cb1> [cb2 ...]
  node console_api.mjs callbacks remove <appId> <cb1> [cb2 ...]
  node console_api.mjs version list <appId>
  node console_api.mjs version create <appId> --version <ver> --notes <notes>
  node console_api.mjs version publish <appId> --version <ver> --notes <notes>
  node console_api.mjs app create --name <name> [--desc <desc>]
  node console_api.mjs app info <appId>
  node console_api.mjs app secret <appId>
  node console_api.mjs app set-icon <appId> --icon <path>
  node console_api.mjs app enable-bot <appId>
  node console_api.mjs app set-webhook <appId> --url <url>
  node console_api.mjs app set-card-url <appId> --url <url>

Options:
  --profile <dir>   Playwright profile (default: ~/.lark-console/profile)
  --headed          Show browser window
  --json            Raw JSON output
  --version <ver>   Version number (for version create/publish)
  --notes <notes>   Update notes (for version create/publish)`);
    process.exit(0);
  }

  // app create doesn't need appId
  if (!appId && `${domain}.${action}` !== "app.create") {
    console.error("ERROR: appId is required");
    process.exit(1);
  }

  const { browser, page, csrfToken } = await getAuthContext(opts.profile, opts.headed);

  try {
    switch (`${domain}.${action}`) {
      case "scopes.list": await scopesList(page, csrfToken, appId, opts.json); break;
      case "scopes.find": await scopesFind(page, csrfToken, appId, rest[0] || ""); break;
      case "scopes.add": await scopesAdd(page, csrfToken, appId, rest); break;
      case "scopes.remove": await scopesRemove(page, csrfToken, appId, rest); break;
      case "callbacks.list": await callbacksList(page, csrfToken, appId, opts.json); break;
      case "callbacks.add": await callbacksAdd(page, csrfToken, appId, rest); break;
      case "callbacks.remove": await callbacksRemove(page, csrfToken, appId, rest); break;
      case "version.list": await versionList(page, csrfToken, appId, opts.json); break;
      case "version.create": await versionCreate(page, csrfToken, appId, opts.version, opts.notes); break;
      case "version.publish": await versionPublish(page, csrfToken, appId, opts.version, opts.notes); break;
      case "app.create": await appCreate(page, csrfToken, opts); break;
      case "app.info": await appInfo(page, csrfToken, appId, opts.json); break;
      case "app.secret": await appSecret(page, csrfToken, appId); break;
      case "app.set-icon": await appSetIcon(page, csrfToken, appId, opts.icon); break;
      case "app.enable-bot": await appEnableBot(page, csrfToken, appId); break;
      case "app.set-webhook": await appSetWebhook(page, csrfToken, appId, opts.url); break;
      case "app.set-card-url": await appSetCardUrl(page, csrfToken, appId, opts.url); break;
      default:
        console.error(`Unknown command: ${domain} ${action}`);
        process.exit(1);
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
