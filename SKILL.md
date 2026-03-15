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

# Callback management
node scripts/console_api.mjs callbacks list <appId>
node scripts/console_api.mjs callbacks add <appId> <callback1> [callback2 ...]

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

For scope IDs, use `scopes find` to search by keyword, or see the ID table in `references/selector-notes.md`.

### Browser approach (for app creation and complex flows)

1. Confirm the target is a browser-console workflow.
2. Create or update a config file based on [references/config-schema.md](references/config-schema.md).
3. Run `scripts/provision_lark_app.mjs` with a persistent Playwright profile.
4. Verify the resulting app in the console.

When the task involves console navigation details or scope cloning, read these references first:

- [references/console-flow.md](references/console-flow.md)
- [references/selector-notes.md](references/selector-notes.md)

If a similar app-creation task has already been executed in this repo, also check the relevant sanitized case note under `references/`.

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

- `scripts/console_api.mjs`: Console API client — scope, callback, and version management via API (preferred)
- `scripts/provision_lark_app.mjs`: Playwright automation entrypoint (create or configure a single app)
- `scripts/clone_app_config.mjs`: Clone config (scopes, bot, events, callbacks) to all apps matching a pattern
- `scripts/publish_apps.mjs`: Create and publish versions for all apps matching a pattern (browser approach)
- `references/config-schema.md`: minimal config contract and selector override guidance
- `references/console-flow.md`: console workflow map and fallback rules
- `references/selector-notes.md`: UI structure notes, selector risks, and API endpoint reference
- `references/case-doceditor.md`: sanitized example of cloning and publishing an app
