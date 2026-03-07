---
name: lark-console
description: Automate creating and configuring Lark developer console apps with Playwright. Use when a user wants a repeatable browser-driven workflow for app creation, permission scope changes, or other console-only setup that is not covered by official OpenAPI or CLI support.
---

# Lark Console

## Overview

Use this skill when the user wants to automate Lark or Feishu developer console setup that still lives in the web UI, especially:

- create a self-built app
- add or remove permission scopes
- capture generated `App ID` and related metadata
- turn a one-off console flow into a repeatable Playwright script

Use official OpenAPI where it exists. Use this skill only for console-only setup that is not covered by public API or CLI support.

## Workflow

1. Confirm the target is a browser-console workflow, not a supported OpenAPI flow.
2. Prefer browser automation over undocumented private APIs.
3. Create or update a config file based on [references/config-schema.md](references/config-schema.md).
4. Adapt or generate `scripts/provision_lark_app.mjs` for the specific console flow.
5. Run the script with a persistent Playwright profile so login and 2FA stay in the browser session.
6. Verify the resulting app name, enabled scopes, and captured credentials in the UI.

## Rules

- Do not suggest bypassing authentication, anti-automation controls, or access checks.
- Do not rely on undocumented console APIs as the primary solution.
- If the console DOM changes, update selectors or add a page-specific mapping layer instead of hardcoding brittle text-only paths everywhere.
- Keep secrets out of source control. Persist any captured `App ID` or `App Secret` only in user-approved locations.

## Inputs

The default script expects a JSON config file with:

- console URL
- app name and optional description
- scope list
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

- If the user is already logged in, keep `--profile-dir` stable across runs.
- If selectors fail, open the page, inspect current labels, and update the config's `selectors` block instead of forking the script immediately.
- If the task is only "add permissions to an existing app", set `mode` to `update-scopes`.

## Files

- `scripts/provision_lark_app.mjs`: Playwright automation entrypoint
- `references/config-schema.md`: minimal config contract and selector override guidance
