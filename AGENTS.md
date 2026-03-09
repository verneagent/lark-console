# Lark Console Repo

This file provides guidance when working with code in this repository.

## Project Overview

`lark-console` is a standalone skill package for automating Lark or Feishu developer-console setup with Playwright.

Use it for browser-console workflows such as:

- creating a self-built app
- adding or updating permission scopes
- configuring bot, event subscription, callback, and encryption settings
- capturing generated app metadata after setup

This repository is for browser-driven automation only. Prefer official OpenAPI when the workflow is already supported there.

## Repository Layout

The main files are:

- `SKILL.md`: canonical skill instructions and workflow guidance
- `scripts/`: runnable automation and local checks
- `references/`: config schema and selector notes

## Required Reading

Before changing automation behavior, read `SKILL.md` first.

Use `references/config-schema.md` when you need the expected config shape or selector override contract.

## Working Rules

- Prefer browser automation over undocumented private APIs.
- Keep the canonical skill instructions in `SKILL.md`.
- Put runnable automation in `scripts/`.
- Put detailed input contracts and selector notes in `references/`.
- Keep secrets out of source control. Store local config, profile, results, and debug artifacts under `~/.lark-console/` or another user-approved non-repo path.
- If the console DOM changes, prefer updating selectors or adding selector overrides before forking the automation flow.

## Verification

For repo hygiene changes, run:

```bash
npm run check:secrets
```

For automation changes, verify the affected flow with `node scripts/provision_lark_app.mjs` using a user-approved config path and confirm the resulting app settings in the console UI.
