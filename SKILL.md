---
name: lark-console
description: Automate creating and configuring Lark developer console apps via console APIs and Playwright. Use when a user wants a repeatable workflow for app creation, permission scope changes, version publishing, or other console-only setup that is not covered by official OpenAPI or CLI support.
---

# Lark Console

## Overview

Use this skill when the user wants to automate Lark or Feishu developer console setup that still lives in the web UI, especially:

- create a self-built app
- add or remove permission scopes
- configure bot, event subscription, callback, or encryption settings
- capture generated `App ID` and related metadata
- turn a one-off console flow into a repeatable Playwright script

Use official OpenAPI where it exists. Use this skill only for console-only setup that is not covered by public API or CLI support.

## Workflow

Two approaches are available, prefer API-first:

### API approach (preferred for scope/callback/version changes)

Use `scripts/console_api.mjs` for direct API operations. This is faster and more reliable than browser automation. Playwright is only used to obtain the CSRF token and session cookies.

```bash
# Scope management
node scripts/console_api.mjs scopes list <appId>
node scripts/console_api.mjs scopes find <appId> <keyword>
node scripts/console_api.mjs scopes add <appId> <scopeId1> [scopeId2 ...]
node scripts/console_api.mjs scopes remove <appId> <scopeId1> [scopeId2 ...]

# Callback management (card actions only — NOT event subscriptions)
node scripts/console_api.mjs callbacks list <appId>
node scripts/console_api.mjs callbacks add <appId> <callback1> [callback2 ...]
node scripts/console_api.mjs callbacks remove <appId> <callback1> [callback2 ...]
node scripts/console_api.mjs callbacks set-mode <appId> <http|ws>

# Event subscription management (im.message.receive_v1, etc.)
node scripts/console_api.mjs events list <appId>
node scripts/console_api.mjs events add <appId> <event1> [event2 ...]
node scripts/console_api.mjs events remove <appId> <event1> [event2 ...]

# Version management
node scripts/console_api.mjs version list <appId>
node scripts/console_api.mjs version create <appId> --version <ver> --notes <notes>
node scripts/console_api.mjs version publish <appId> --version <ver> --notes <notes>

# App management
node scripts/console_api.mjs app create --name <name> [--desc <desc>]
node scripts/console_api.mjs app info <appId>
node scripts/console_api.mjs app secret <appId>
node scripts/console_api.mjs app set-icon <appId> --icon <path>
node scripts/console_api.mjs app enable-bot <appId>
node scripts/console_api.mjs app set-webhook <appId> --url <webhookUrl>
node scripts/console_api.mjs app set-card-url <appId> --url <cardUrl>
node scripts/console_api.mjs app delete <appId> [--force]

# Admin Console (tenant-specific domain)
node scripts/console_api.mjs admin stop <appId>
node scripts/console_api.mjs admin activate <appId>
```

The `version publish` command creates a version AND publishes it in one step (auto-publishes when the org has auto-approval enabled).

A `<scope>` argument is either a **scope name** (`im:chat.announcement:read`) or its **numeric ID** — `scopes add`/`scopes remove` accept both and resolve names against the app's own catalog. An ambiguous name fails with the candidate list rather than guessing; scopes already in the desired state are reported and skipped. To browse, use `scopes find <appId> <keyword>` or see the ID table in `references/selector-notes.md`.

To find out which scopes an API needs, call the API first and read the error: an unauthorized call returns

```json
{"code":99991672,"msg":"Access denied. One of the following scopes is required: [im:chat.announcement:read]",
 "error":{"helps":[{"url":"https://open.larksuite.com/app/<appId>/auth?q=<scopes>&op_from=openapi"}]}}
```

The names in that message are exactly what `scopes add` takes, and `helps[].url` is a console deep link for adding them by hand.

### Browser approach (for app creation and complex flows)

1. Confirm the target is a browser-console workflow.
2. Create or update a config file based on [references/config-schema.md](references/config-schema.md).
3. Run `scripts/provision_lark_app.mjs` with a persistent Playwright profile.
4. Verify the resulting app in the console.

When the task involves console navigation details or scope cloning, read these references first:

- [references/console-flow.md](references/console-flow.md)
- [references/selector-notes.md](references/selector-notes.md)

If a similar app-creation task has already been executed in this repo, also check the relevant sanitized case note under `references/`.

## Pitfalls & Gotchas

### Events ≠ Callbacks

The console has **two separate systems** that look like one:
- **Events** (`/developers/v1/event/...`): Lark platform events like `im.message.receive_v1`
- **Callbacks** (`/developers/v1/callback/...`): Card interaction callbacks like `card.action.trigger`

`callbacks add` does NOT register event subscriptions. Use `events add` for events. See [references/selector-notes.md](references/selector-notes.md) for the full API contract.

### event/update requires `appEvents`, not `events`

The `POST /developers/v1/event/update/{appId}` endpoint has a confusing body format. The `events` field is **read-only**. To add events, put them in `appEvents`:

```json
{ "operation": "add", "events": [], "appEvents": ["im.message.receive_v1"], "userEvents": [], "eventMode": 4 }
```

### callbackMode / eventMode must match current value

When calling `callback/update` or `event/update`, the mode field (`callbackMode` / `eventMode`) must match the app's current mode. Sending `callbackMode: 1` when the app is in WS mode (4) returns `ParamInvalid`. The `console_api.mjs` now queries the current mode automatically.

### Version publish is required after config changes

Scope additions, event registrations, callback changes, and mode switches only take effect after publishing a new app version. Order matters: `set mode → add events/callbacks → version publish`.

Adding scopes without publishing is a safe, fully reversible way to rehearse a change: the running app keeps serving its current published version, so `scopes add` → verify with `scopes list` → `scopes remove` restores the previous state exactly.

```bash
node scripts/console_api.mjs scopes add <appId> im:chat.announcement:read
node scripts/console_api.mjs version publish <appId> --version 1.0.112 --notes "..."
```

`version publish` creates and publishes in one step, and reports `Auto-approval: yes` when the tenant publishes without a manual review — check for that line, because without it the version sits unpublished and the change will not take effect.

### Scope names are not scope IDs

`POST /developers/v1/scope/update/{appId}` accepts **only numeric IDs** in `appScopeIDs`. Passing a name returns a bare `{"code":10002,"msg":"ParamInvalid"}` that says nothing about the cause. `scopes add`/`scopes remove` now resolve names for you — if you call the endpoint directly, resolve against `scope/all/{appId}` first and pass `String(s.id)`.

### Playwright/Chromium will not launch in a sandboxed shell

On macOS under a sandboxed agent shell, Chromium dies at startup:

```
FATAL:base/apple/mach_port_rendezvous_mac.cc:155] Check failed: kr == KERN_SUCCESS.
bootstrap_check_in org.chromium.MachPortRendezvousServer.<pid>: Permission denied (1100)
```

Every `console_api.mjs` and `provision_lark_app.mjs` run needs an unsandboxed shell. The failure surfaces as a wall of Chromium launch flags, so read the `FATAL:` line rather than assuming the script is broken.

### `avatar` must come from the upload API, not from a URL you already have

App creation and icon updates both require an image the console itself issued. A perfectly live Lark CDN URL is **not** accepted:

| `avatar` value | Result |
|---|---|
| `data.url` from `POST /developers/v1/app/upload/image` | `code: 0` |
| any other image URL, incl. a working CDN link | `{"code":10002,"msg":"ParamInvalid"}` (empty `Avatar`) |
| field omitted | `{"code":9499,"msg":"Bad Request"}` |

So there is no shortcut where you reuse a known-good image URL — upload first, pass what comes back. `uploadIcon()` in `console_api.mjs` does this once for both `app create` and `app set-icon`; `app create` falls back to the bundled `assets/default-app-icon.png` (240×240, matching the `scale` the upload endpoint expects) when `--icon` is not given.

### Admin Console calls break every relative fetch that follows

`adminStop` / `adminActivate` navigate the page to `admin.larksuite.com` and never come back. The console APIs are called with **relative** paths, so anything invoked afterwards resolves against the admin origin and returns an **HTML 404** instead of JSON — no auth error, no useful message.

This is what made `app delete --force` a silent partial failure: the Admin Console stop succeeded, then the delete step 404'd against the wrong origin, leaving an app that was deactivated but never deleted. `api()` now restores the console origin before every call, so callers do not have to think about it. If you add a new admin-domain flow, do not rely on the page staying put.

### All console APIs use POST

Even "read" endpoints like `/developers/v1/scope/{appId}` require POST with `Content-Type: application/json`. GET requests return 404.

### Failure must show up in the exit code

The CLI used to print errors to stderr and still **exit 0**, so a caller reading `$?` saw success on a command that did nothing. Every `console.error(...); return;` path had this problem, which is how a half-finished `app delete --force` went unnoticed.

`console.error` is now wrapped at the top of `console_api.mjs` to set `process.exitCode = 1`. If you add a code path, write failures with `console.error` and you get the exit code for free — do not reach for `process.exit(0)`, and do not log non-failures (prompts, progress) to stderr. The headed-login prompt is a deliberate `console.log` for that reason.

### E2E tests

Two layers, and they cover different things:

```bash
node scripts/cli_smoke_test.mjs [--app <appId>] [--keep]   # CLI behaviour, asserted on exit codes
node scripts/e2e_test.mjs [--headed] [--keep]             # raw console HTTP APIs
```

`e2e_test.mjs` calls the console's HTTP APIs directly, which is why it never caught the CLI-layer bugs — it does not run the CLI at all. `cli_smoke_test.mjs` spawns `console_api.mjs` as a subprocess and asserts on exit codes and real side effects, including a full `create → set-icon → delete --force` lifecycle. Both create a temporary app and delete it; `--keep` skips deletion.

When fixing a bug in the CLI layer, confirm the smoke test actually fails without your fix — a regression test that passes either way is not a guardrail.

## Rules

- Do not suggest bypassing authentication, anti-automation controls, or access checks.
- Do not rely on undocumented console APIs as the primary solution.
- If the console DOM changes, update selectors or add a page-specific mapping layer instead of hardcoding brittle text-only paths everywhere.
- Keep secrets out of source control. Persist any captured `App ID` or `App Secret` only in user-approved locations.
- **API discovery rule**: When performing any browser automation, always capture network requests using `page.on("request")` / `page.on("response")` to discover the actual API endpoints the console UI calls. Add discovered endpoints to `scripts/console_api.mjs` as new subcommands and document them in `references/selector-notes.md`. The goal is to grow the API client over time so browser automation is only needed for truly UI-only operations (e.g., flows requiring file chooser dialogs or complex DOM interactions that have no API equivalent).

## Browser-Only Operations

Some console operations have no direct API and require Playwright browser automation. This table should shrink over time as APIs are discovered via network capture.

| Operation | Status | Notes |
|-----------|--------|-------|
| *(none currently)* | — | All known operations have API support |

When a browser-only operation is found, add it here. When a direct API is later discovered, update the implementation in `console_api.mjs`.

### API Discovery Notes

The upload API (`/developers/v1/app/upload/image`) requires hidden FormData fields that the UI's upload component adds automatically. These were discovered by monkey-patching `window.fetch` during a UI-triggered upload:

```
file: <image blob>, filename="image.png"
uploadType: "4"
isIsv: "false"
scale: '{"width":240,"height":240}'
```

Without `uploadType`, `isIsv`, and `scale`, the server returns `9499 Bad Request`. This pattern likely applies to other console upload endpoints too.

## Inputs

The default script expects a JSON config file with:

- console URL
- app name and optional description
- optional existing app ID
- scope list
- optional bot, event, callback, and encryption settings
- optional selectors override map
- optional output path for captured metadata

See [references/config-schema.md](references/config-schema.md) for the shape.

Default config path:

- `~/.lark-console/config.json`

## Execution

Install Playwright if needed, then run:

```bash
node scripts/provision_lark_app.mjs --headed
```

Or override the config path explicitly:

```bash
node scripts/provision_lark_app.mjs --config ~/.lark-console/config.json --headed
```

Useful patterns:

- If the user is already logged in, keep `profileDir` stable across runs.
- If selectors fail, open the page, inspect current labels, and update the config's `selectors` block instead of forking the script immediately.
- If the task is only "configure an existing app", set `mode` to `configure-existing` and provide `appId`.

## Files

- `assets/default-app-icon.png`: bundled 240×240 app icon, uploaded by `app create` when `--icon` is omitted
- `scripts/console_api.mjs`: Console API client — scope, callback, and version management via API (preferred)
- `scripts/cli_smoke_test.mjs`: spawns the CLI as a subprocess and asserts exit codes + real side effects (`e2e_test.mjs` covers the raw HTTP APIs instead)
- `scripts/provision_lark_app.mjs`: Playwright automation entrypoint (create or configure a single app)
- `scripts/clone_app_config.mjs`: Clone config (scopes, bot, events, callbacks) to all apps matching a pattern
- `scripts/publish_apps.mjs`: Create and publish versions for all apps matching a pattern (browser approach)
- `references/config-schema.md`: minimal config contract and selector override guidance
- `references/console-flow.md`: console workflow map and fallback rules
- `references/selector-notes.md`: UI structure notes, selector risks, and API endpoint reference
- `references/case-doceditor.md`: sanitized example of cloning and publishing an app
