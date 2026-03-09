# lark-console

`lark-console` is a standalone skill for automating Lark or Feishu developer-console setup with Playwright.

Use it when the desired workflow still lives in the web console, such as:

- creating a self-built app
- adding or updating permission scopes
- configuring bot, event, callback, and encryption settings
- capturing generated app metadata after setup

The repository contains:

- `SKILL.md` with triggering and workflow guidance
- `scripts/provision_lark_app.mjs` as the automation entrypoint
- `references/config-schema.md` for the expected JSON config shape

This skill is intended for browser-driven console automation, not undocumented private API usage.
