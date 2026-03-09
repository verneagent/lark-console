# Selector Notes

This file records console-specific selector and DOM behavior that affected automation reliability.

Use it when updating `scripts/provision_lark_app.mjs` or diagnosing a broken browser flow.

## App List Page

Observed stable cues:

- search input placeholder: `Search by app name or App ID`
- create button text: `Create Custom App`

Notes:

- app cards can contain repeated app names across historical drafts or pending releases
- search before clicking to avoid landing on the wrong app card

## Create App Form

Observed behavior:

- opens as an inline modal-like form on the list page
- required fields:
  - name
  - description
  - icon

Observed useful nodes:

- unlabeled text input for app name
- textarea for description
- icon candidates with titles such as `AppDefaultFilled`, `RobotFilled`, `NoteFilled`
- visible action text: `Create`, `Cancel`

Risk:

- there may be no stable placeholder on the name and description fields
- choosing the wrong button by index is brittle

Preferred strategy:

- scope locators to the active dialog container
- fill the first text input and first textarea in that container
- click a known icon by title if available
- click the `Create` button by visible text

## Permissions Page

Route:

```text
/app/:appId/auth
```

Observed behavior:

- scope list is virtualized
- only visible rows appear in body text
- searching the scope list is more reliable than scanning the whole page

Important controls:

- `Add permission scopes to app`
- `Batch import/export scopes`
- scope search input placeholder like `E.g. read group information, im:chat:readonly`

Risk:

- body-text scraping misses off-screen rows
- some helper dialogs like `Got It` can block interaction

Preferred strategy:

- dismiss helper overlays first
- use direct route navigation
- for verification, search for specific scope codes one by one

## Batch Import / Export

Observed behavior:

- import and export content may coexist in the same UI
- Monaco/editor-backed textareas may expose partial values through DOM
- visible text can include example JSON, not the actual full export payload

Risk:

- `textarea.value` may be truncated
- visible DOM may show only part of the export result

Preferred strategy:

- treat export/import as preferred product behavior
- but verify the extracted payload before trusting it
- if the extracted export JSON is incomplete, fall back to a user-provided payload or a verified scope list

## Credentials Page

Route:

```text
/app/:appId/baseinfo
```

Observed behavior:

- `App ID` is visible directly
- `App Secret` is masked by default
- a visibility icon is present in the credentials block

Risk:

- generic icon queries can hit the wrong visibility/copy icon

Preferred strategy:

- scope the reveal action to the credentials section when possible
- re-read the page after clicking the visibility control

## Version Pages

Routes:

- `/app/:appId/version`
- `/app/:appId/version/create`
- `/app/:appId/version/:versionId`

Observed behavior:

- `Create Version` can navigate to a dedicated page
- version form fields are inline, not modal-driven
- release steps can be:
  - save version
  - submit for release
  - publish

Risk:

- the final action text may change after each step
- page text can lag a moment behind button state

Preferred strategy:

- navigate directly to version routes when possible
- after each action, re-open the version detail page and read status again
- trust final status labels like `Released`, `Enabled`, and `The current changes have been published`
