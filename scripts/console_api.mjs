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
 *   node console_api.mjs scopes add <appId> <scope1> [scope2 ...]
 *   node console_api.mjs scopes remove <appId> <scope1> [scope2 ...]
 *   node console_api.mjs scopes find <appId> <keyword>
 *   node console_api.mjs callbacks list <appId>
 *   node console_api.mjs callbacks add <appId> <callback1> [callback2 ...]
 *   node console_api.mjs callbacks remove <appId> <callback1> [callback2 ...]
 *   node console_api.mjs version list <appId>
 *   node console_api.mjs version create <appId> --version <ver> --notes <notes>
 *   node console_api.mjs version publish <appId> --version <ver> --notes <notes>
 *   node console_api.mjs app create --name <name> [--desc <desc>] [--icon <path>]
 *   node console_api.mjs app info <appId>
 *   node console_api.mjs app secret <appId>
 *   node console_api.mjs app set-icon <appId> --icon <path>
 *   node console_api.mjs app enable-bot <appId>
 *   node console_api.mjs app set-webhook <appId> --url <webhookUrl>
 *   node console_api.mjs app set-card-url <appId> --url <cardUrl>
 *   node console_api.mjs app delete <appId> [--force]
 *   node console_api.mjs admin stop <appId>
 *   node console_api.mjs admin activate <appId>
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
import { fileURLToPath } from "node:url";

const SKILL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_ICON = path.join(SKILL_ROOT, "assets", "default-app-icon.png");

// Failure must be visible in the exit code, not only in stderr prose. An agent
// or CI driving this CLI reads `$?`, and every `console.error(...); return;`
// path used to report a hard failure while still exiting 0 — which is how a
// half-finished `app delete --force` went unnoticed.
//
// Rather than trusting four dozen call sites to remember `process.exitCode = 1`
// (and every future one), flip it here at the single choke point: writing to
// stderr means the command failed. The one informational use of console.error
// — the headed-login prompt — is deliberately a console.log instead.
const stderrWrite = console.error.bind(console);
console.error = (...args) => {
  process.exitCode = 1;
  stderrWrite(...args);
};

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
    force: false,
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
    else if (a === "--force") { opts.force = true; }
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
      // console.log, not console.error: this is a prompt, not a failure — see
      // the console.error wrapper at the top of this file.
      console.log("Not logged in. Please log in in the browser window...");
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

const CONSOLE_ORIGIN = "https://open.larksuite.com";

// The Admin Console helpers (adminStop / adminActivate) navigate the page to
// admin.larksuite.com to pick up that domain's cookies, and never navigate
// back. `api()` issues *relative* fetches, so any call made after one of them
// resolves against the admin origin and comes back as an HTML 404 rather than
// JSON — which is how `app delete --force` silently lost its delete step.
async function ensureConsoleOrigin(page) {
  if (page.url().startsWith(CONSOLE_ORIGIN)) return;
  await page.goto(`${CONSOLE_ORIGIN}/app`, { waitUntil: "domcontentloaded", timeout: 30000 });
}

async function api(page, csrfToken, endpoint, body = {}) {
  await ensureConsoleOrigin(page);
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

// scope/update only accepts NUMERIC scope IDs. Passing a scope name straight
// through (e.g. `scopes add <appId> im:chat.announcement:read`) gets a bare
// `{"code":10002,"msg":"ParamInvalid"}` with no hint about why, so resolve
// names against the catalog before calling it.
async function resolveScopes(page, csrf, appId, tokens) {
  if (!tokens.length) {
    throw new Error("at least one scope name or numeric ID is required");
  }
  const res = await api(page, csrf, `/developers/v1/scope/all/${appId}`);
  if (res.code !== 0) throw new Error(`scope/all failed: ${JSON.stringify(res)}`);
  const catalog = res.data?.scopes || [];
  const byName = new Map(catalog.map((s) => [s.name?.toLowerCase(), s]));
  const byId = new Map(catalog.map((s) => [String(s.id), s]));

  return tokens.map((token) => {
    if (/^\d+$/.test(token)) {
      const hit = byId.get(token);
      if (!hit) throw new Error(`scope ID ${token} is not in this app's scope catalog`);
      return hit;
    }
    const exact = byName.get(token.toLowerCase());
    if (exact) return exact;

    const partial = catalog.filter((s) => s.name?.toLowerCase().includes(token.toLowerCase()));
    if (partial.length === 1) return partial[0];
    if (partial.length === 0) throw new Error(`no scope matches "${token}"`);
    throw new Error(
      `"${token}" is ambiguous — matches: ${partial.map((s) => s.name).join(", ")}`,
    );
  });
}

// status: 0 = not added, 1 = added but not published, 5 = active
const scopeState = (s) => (s.status === 5 ? "active" : s.status === 1 ? "pending" : "absent");

async function scopesAdd(page, csrf, appId, tokens) {
  for (const s of await resolveScopes(page, csrf, appId, tokens)) {
    if (s.status === 5 || s.status === 1) {
      console.log(`  Add scope ${s.name} (ID: ${s.id}): already ${scopeState(s)}, skipped`);
      continue;
    }
    const res = await api(page, csrf, `/developers/v1/scope/update/${appId}`, {
      appScopeIDs: [String(s.id)],
      userScopeIDs: [],
      scopeIds: [],
      operation: "add",
    });
    console.log(
      `  Add scope ${s.name} (ID: ${s.id}): ${res.code === 0 ? "✓" : "✗ " + JSON.stringify(res)}`,
    );
  }
  console.log("\nNote: Publish a new version for changes to take effect.");
}

async function scopesRemove(page, csrf, appId, tokens) {
  for (const s of await resolveScopes(page, csrf, appId, tokens)) {
    if (s.status === 0) {
      console.log(`  Remove scope ${s.name} (ID: ${s.id}): not added, skipped`);
      continue;
    }
    const res = await api(page, csrf, `/developers/v1/scope/update/${appId}`, {
      appScopeIDs: [String(s.id)],
      userScopeIDs: [],
      scopeIds: [],
      operation: "del",
    });
    console.log(
      `  Remove scope ${s.name} (ID: ${s.id}): ${res.code === 0 ? "✓" : "✗ " + JSON.stringify(res)}`,
    );
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
  // Query current mode so we don't send the wrong callbackMode
  const current = await api(page, csrf, `/developers/v1/callback/${appId}`);
  const mode = current.data?.callbackMode ?? 1;
  const res = await api(page, csrf, `/developers/v1/callback/update/${appId}`, {
    operation: "add",
    callbacks,
    callbackMode: mode,
  });
  console.log(`Add callbacks: ${res.code === 0 ? "✓" : "✗ " + JSON.stringify(res)}`);
}

async function callbacksRemove(page, csrf, appId, callbacks) {
  const current = await api(page, csrf, `/developers/v1/callback/${appId}`);
  const mode = current.data?.callbackMode ?? 1;
  const res = await api(page, csrf, `/developers/v1/callback/update/${appId}`, {
    operation: "del",
    callbacks,
    callbackMode: mode,
  });
  console.log(`Remove callbacks: ${res.code === 0 ? "✓" : "✗ " + JSON.stringify(res)}`);
}

async function callbacksSetMode(page, csrf, appId, mode) {
  // Discovered via browser capture: persistent connection uses mode 4.
  // Two separate endpoints: /event/switch/ and /callback/switch/
  const modeMap = { http: 1, ws: 4, websocket: 4, persistent: 4 };
  const modeVal = modeMap[mode?.toLowerCase()];
  if (!modeVal) {
    console.error("ERROR: mode must be 'http' or 'ws'");
    return;
  }
  const label = modeVal === 4 ? "WebSocket (persistent connection)" : "HTTP";
  const evRes = await api(page, csrf, `/developers/v1/event/switch/${appId}`, {
    eventMode: modeVal,
  });
  console.log(`Event subscription mode: ${evRes.code === 0 ? "✓ " + label : "✗ " + JSON.stringify(evRes)}`);
  const cbRes = await api(page, csrf, `/developers/v1/callback/switch/${appId}`, {
    callbackMode: modeVal,
  });
  console.log(`Card callback mode: ${cbRes.code === 0 ? "✓ " + label : "✗ " + JSON.stringify(cbRes)}`);
}

// ──── Events ────

async function eventsList(page, csrf, appId, jsonMode) {
  const res = await api(page, csrf, `/developers/v1/event/${appId}`);
  if (res.code !== 0) { console.error("Error:", res); return; }

  if (jsonMode) {
    console.log(JSON.stringify(res.data, null, 2));
    return;
  }

  const events = res.data?.events || [];
  const mode = res.data?.eventMode;
  const modeLabel = mode === 4 ? "WebSocket (persistent connection)" : mode === 1 ? "HTTP" : mode;
  console.log(`Event mode: ${modeLabel}`);
  console.log(`Subscribed events (${events.length}):`);
  for (const ev of events) {
    console.log(`  ✓ ${ev}`);
  }
}

async function eventsAdd(page, csrf, appId, events) {
  // Query current eventMode to include in the request
  const current = await api(page, csrf, `/developers/v1/event/${appId}`);
  const eventMode = current.data?.eventMode ?? 1;
  const res = await api(page, csrf, `/developers/v1/event/update/${appId}`, {
    operation: "add",
    events: [],
    appEvents: events,
    userEvents: [],
    eventMode,
  });
  console.log(`Add events: ${res.code === 0 ? "✓" : "✗ " + JSON.stringify(res)}`);
}

async function eventsRemove(page, csrf, appId, events) {
  const current = await api(page, csrf, `/developers/v1/event/${appId}`);
  const eventMode = current.data?.eventMode ?? 1;
  const res = await api(page, csrf, `/developers/v1/event/update/${appId}`, {
    operation: "del",
    events: [],
    appEvents: events,
    userEvents: [],
    eventMode,
  });
  console.log(`Remove events: ${res.code === 0 ? "✓" : "✗ " + JSON.stringify(res)}`);
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

  if (createRes.code === 10043) {
    // "Version Created, Refresh Again" — a draft already exists, find it in version list
    const listRes = await api(page, csrf, `/developers/v1/app_version/list/${appId}`);
    const draft = (listRes.data?.versions || []).find(v => v.versionStatus === 0);
    if (draft) {
      console.log(`✓ Using existing draft version ${draft.appVersion} (ID: ${draft.versionId})`);
      return draft.versionId;
    }
    console.error("Error: draft exists but could not find it in version list");
    return null;
  }

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

// `avatar` must be a URL issued by the console's own upload endpoint. An
// arbitrary image URL — even a live Lark CDN link — is rejected with
// `{"code":10002,"msg":"ParamInvalid"}` and an empty Avatar, and omitting the
// field entirely is `9499 Bad Request`. Both app/create and base_info need it,
// so they share this one path rather than passing a URL around by hand.
async function uploadIcon(page, csrf, iconPath) {
  if (!fs.existsSync(iconPath)) throw new Error(`icon file not found: ${iconPath}`);

  const stat = fs.statSync(iconPath);
  if (stat.size > 2 * 1024 * 1024) {
    throw new Error(`icon must be under 2MB (got ${(stat.size / 1024 / 1024).toFixed(1)}MB)`);
  }

  const ext = iconPath.split(".").pop().toLowerCase();
  const mimeMap = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };
  const mime = mimeMap[ext] || "image/png";
  const fileName = `image.${ext === "jpeg" ? "jpg" : ext}`;
  const iconBase64 = fs.readFileSync(iconPath).toString("base64");

  const uploadRes = await page.evaluate(
    async ({ csrf, base64Data, mime, fileName }) => {
      const byteChars = atob(base64Data);
      const byteArr = new Uint8Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) {
        byteArr[i] = byteChars.charCodeAt(i);
      }
      const file = new File([byteArr], fileName, { type: mime });

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
    { csrf, base64Data: iconBase64, mime, fileName },
  );

  if (uploadRes.code !== 0) throw new Error(`icon upload failed: ${JSON.stringify(uploadRes)}`);
  const imageUrl = uploadRes.data?.url;
  if (!imageUrl) throw new Error(`icon upload returned no url: ${JSON.stringify(uploadRes)}`);
  return imageUrl;
}

async function appSetIcon(page, csrf, appId, iconPath) {
  if (!iconPath) { console.error("ERROR: --icon <path> is required"); process.exit(1); }

  // Step 1: Upload image via API
  console.log("Uploading image...");
  const imageUrl = await uploadIcon(page, csrf, iconPath);
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
  const iconPath = opts.icon || DEFAULT_ICON;

  // Create requires an avatar, and the avatar must come from the upload API —
  // see uploadIcon(). Passing a hand-picked CDN URL here is what used to make
  // every `app create` fail with a bare ParamInvalid.
  console.log(`Uploading icon (${iconPath})...`);
  const avatar = await uploadIcon(page, csrf, iconPath);
  console.log("✓ Icon uploaded");

  const res = await api(page, csrf, "/developers/v1/app/create", {
    appSceneType: 0,
    name,
    desc,
    avatar,
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

  // The callback page persists the URL through callback/update_url.
  // robot.cardRequestUrl remains empty in console responses even after save;
  // callback.verificationUrl is the actual source of truth for HTTP callback mode.
  const updateRes = await api(page, csrf, `/developers/v1/callback/update_url/${appId}`, {
    verificationUrl: url,
  });

  if (updateRes.code === 0) {
    console.log(`✓ Card callback URL set: ${url}`);
  } else {
    console.error("Error setting card callback URL:", JSON.stringify(updateRes));
  }
}

// ──── App Delete ────

async function appDelete(page, csrf, appId, force) {
  if (force) {
    // Force delete: first stop via Admin Console, then delete
    console.log("Force delete: stopping app via Admin Console...");
    const stopped = await adminStop(page, appId);
    if (!stopped) {
      console.error("✗ Force delete failed: could not stop app via Admin Console");
      return;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }

  const res = await api(page, csrf, `/developers/v1/app/delete/${appId}`);
  if (res.code === 0) {
    console.log(`✓ App ${appId} deleted`);
  } else if (res.code === 10003) {
    console.error(`✗ Cannot delete: app is published. Use --force to stop and delete.`);
  } else {
    console.error(`✗ Delete failed: ${JSON.stringify(res)}`);
  }
}

// ──── Admin Console ────

async function getAdminBaseUrl(page) {
  // Navigate to admin console to discover the tenant-specific URL
  await page.goto("https://admin.larksuite.com", {
    waitUntil: "domcontentloaded",
    timeout: 15000,
  });
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => null);
  await new Promise((r) => setTimeout(r, 2000));

  const url = page.url();
  const match = url.match(/(https:\/\/[^/]+)/);
  return match?.[1] || null;
}

async function adminApi(page, baseUrl, method, endpoint, body = {}) {
  // Navigate to admin page first to ensure cookies are set for the admin domain
  const currentUrl = page.url();
  if (!currentUrl.includes(new URL(baseUrl).hostname)) {
    await page.goto(`${baseUrl}/admin/appCenter/manage`, {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => null);
    await new Promise((r) => setTimeout(r, 2000));
  }

  return page.evaluate(
    async ({ method, endpoint, body }) => {
      // Get CSRF token from cookie (admin console uses csrf_token cookie)
      const csrfMatch = document.cookie.match(/csrf_token=([^;]+)/);
      const csrfToken = csrfMatch?.[1] || "";

      const res = await fetch(endpoint, {
        method,
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      try { return JSON.parse(text); }
      catch { return { code: -1, status: res.status, text }; }
    },
    { method, endpoint: `/suite/admin/appcenter/v4/app${endpoint}`, body },
  );
}

async function adminStop(page, appId) {
  const baseUrl = await getAdminBaseUrl(page);
  if (!baseUrl) {
    console.error("✗ Could not determine Admin Console URL");
    return false;
  }

  const res = await adminApi(page, baseUrl, "PUT", `/${appId}/stop`);
  if (res.code === 0) {
    console.log(`✓ App ${appId} stopped (deactivated)`);
    return true;
  } else {
    console.error(`✗ Stop failed: ${JSON.stringify(res)}`);
    return false;
  }
}

async function adminActivate(page, appId) {
  const baseUrl = await getAdminBaseUrl(page);
  if (!baseUrl) {
    console.error("✗ Could not determine Admin Console URL");
    return;
  }

  const res = await adminApi(page, baseUrl, "PUT", `/${appId}/active`);
  if (res.code === 0) {
    console.log(`✓ App ${appId} activated (enabled)`);
  } else {
    console.error(`✗ Activate failed: ${JSON.stringify(res)}`);
  }
}

// ──── Main ────

async function main() {
  const opts = parseArgs();
  const [domain, action, appId, ...rest] = opts.args;

  if (!domain || !action) {
    console.log(`Usage:
  node console_api.mjs scopes list <appId>
  node console_api.mjs scopes add <appId> <scope1> [scope2 ...]
  node console_api.mjs scopes remove <appId> <scope1> [scope2 ...]
  node console_api.mjs scopes find <appId> <keyword>
  node console_api.mjs callbacks list <appId>
  node console_api.mjs callbacks add <appId> <cb1> [cb2 ...]
  node console_api.mjs callbacks remove <appId> <cb1> [cb2 ...]
  node console_api.mjs callbacks set-mode <appId> <http|ws>
  node console_api.mjs events list <appId>
  node console_api.mjs events add <appId> <event1> [event2 ...]
  node console_api.mjs events remove <appId> <event1> [event2 ...]
  node console_api.mjs version list <appId>
  node console_api.mjs version create <appId> --version <ver> --notes <notes>
  node console_api.mjs version publish <appId> --version <ver> --notes <notes>
  node console_api.mjs app create --name <name> [--desc <desc>] [--icon <path>]
  node console_api.mjs app info <appId>
  node console_api.mjs app secret <appId>
  node console_api.mjs app set-icon <appId> --icon <path>
  node console_api.mjs app enable-bot <appId>
  node console_api.mjs app set-webhook <appId> --url <url>
  node console_api.mjs app set-card-url <appId> --url <url>
  node console_api.mjs app delete <appId> [--force]
  node console_api.mjs admin stop <appId>
  node console_api.mjs admin activate <appId>

A <scope> is either a scope name (im:chat.announcement:read) or its numeric ID.
Names are resolved against the app's scope catalog; an ambiguous name lists the
candidates instead of guessing.

Options:
  --profile <dir>   Playwright profile (default: ~/.lark-console/profile)
  --headed          Show browser window
  --json            Raw JSON output
  --version <ver>   Version number (for version create/publish)
  --notes <notes>   Update notes (for version create/publish)`);
    process.exit(0);
  }

  // app create doesn't need appId; admin commands use appId from args
  const cmd = `${domain}.${action}`;
  if (!appId && cmd !== "app.create") {
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
      case "callbacks.set-mode": await callbacksSetMode(page, csrfToken, appId, rest[0]); break;
      case "events.list": await eventsList(page, csrfToken, appId, opts.json); break;
      case "events.add": await eventsAdd(page, csrfToken, appId, rest); break;
      case "events.remove": await eventsRemove(page, csrfToken, appId, rest); break;
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
      case "app.delete": await appDelete(page, csrfToken, appId, opts.force); break;
      case "admin.stop": await adminStop(page, appId); break;
      case "admin.activate": await adminActivate(page, appId); break;
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
