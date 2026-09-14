#!/usr/bin/env node

/**
 * CLI smoke test for console_api.mjs.
 *
 * e2e_test.mjs exercises the console's raw HTTP APIs, so it never covered the
 * bugs that actually bit us — those lived in the CLI layer:
 *
 *   - `app create` sent an avatar URL the server rejects (needs the upload API)
 *   - `app delete --force` completed its stop step but lost its delete step to
 *     a page-origin change, leaving an app stopped-but-not-deleted
 *
 * Both went unnoticed for the same reason: a failed command still exited 0.
 * So this test asserts the contract a caller (agent, CI, human in a pipeline)
 * actually depends on:
 *
 *   1. $? tells the truth — failure exits non-zero
 *   2. a composite command finishes *all* of its steps, not just the first
 *
 * Requires a logged-in Playwright profile (same one console_api.mjs uses).
 *
 * Usage:
 *   node scripts/cli_smoke_test.mjs [--app <appId>] [--keep]
 *
 *   --app   also check a read command against this app (optional)
 *   --keep  do not delete the app this test creates (for debugging)
 */

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, "console_api.mjs");

const argv = process.argv.slice(2);
const keep = argv.includes("--keep");
const appIdx = argv.indexOf("--app");
const existingApp = appIdx === -1 ? null : argv[appIdx + 1];

let passed = 0;
const failures = [];

function run(...args) {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8" });
  return { code: r.status, out: r.stdout || "", err: r.stderr || "" };
}

function check(name, cond, detail) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(name);
    console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ""}`);
  }
}

console.log("CLI smoke test\n");

// ── 1. Failure must be visible in the exit code ──
console.log("exit-code contract:");
{
  const bad = run("app", "info", "cli_doesnotexist000000");
  check(
    "failing command exits non-zero",
    bad.code !== 0,
    `exit=${bad.code} — a caller reading $? would treat this as success`,
  );
  check("failing command says why on stderr", /error|forbidden|10003|10002/i.test(bad.err + bad.out));
}

if (existingApp) {
  const ok = run("scopes", "list", existingApp);
  check("succeeding command exits 0", ok.code === 0, `exit=${ok.code}`);
  check("succeeding command produced output", /Active scopes/.test(ok.out));
}

// ── 2. Composite lifecycle: every step must land ──
console.log("\napp lifecycle (create → set-icon → delete --force):");
let appId = null;
try {
  const created = run("app", "create", "--name", `cli-smoke-${process.pid}`);
  const m = created.out.match(/cli_[A-Za-z0-9]+/);
  check("create exits 0", created.code === 0, `exit=${created.code}\n${created.err.trim()}`);
  check("create returned an app id", !!m, created.out.trim() || created.err.trim());
  appId = m?.[0] ?? null;

  if (appId) {
    const icon = run("app", "set-icon", appId, "--icon", path.join(HERE, "..", "assets", "default-app-icon.png"));
    check("set-icon exits 0", icon.code === 0, `exit=${icon.code}\n${icon.err.trim()}`);

    const del = run("app", "delete", appId, "--force");
    check("delete --force exits 0", del.code === 0, `exit=${del.code}\n${del.err.trim()}`);
    // The bug this guards: stop succeeded, delete silently did not. A ✓ on the
    // first step is not evidence the second one ran.
    check(
      "delete --force actually deleted (not just stopped)",
      /deleted/i.test(del.out) && !/delete failed/i.test(del.out),
      `output was:\n${del.out.trim()}`,
    );

    const gone = run("app", "info", appId);
    check("app is really gone afterwards", gone.code !== 0 && /forbidden|10003/i.test(gone.out + gone.err));
    if (!keep) appId = null; // deleted; nothing left to clean up
  }
} finally {
  if (appId && !keep) {
    console.log(`\ncleanup: removing ${appId}`);
    run("app", "delete", appId, "--force");
  }
}

// ── Summary ──
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
