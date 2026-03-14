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
- the editor is a Monaco editor (VS Code-like), not a plain textarea
- Monaco renders syntax-highlighted spans over a hidden textarea
- `textarea.fill()`, `textarea.value = ...`, and clipboard paste do NOT work
- `keyboard.type()` with `{ delay: 2 }` DOES work after clicking into the editor

Working approach for batch import:

1. Click `Batch import/export scopes`
2. Click `Reset Defaults` to clear existing content
3. Click `.monaco-editor .view-line` with `{ force: true }` to focus
4. `Meta+a` → `Backspace` to clear
5. `keyboard.type(json, { delay: 2 })` to type the JSON
6. Click `Format JSON` to validate
7. Click `Next, Review New Scopes` (check it's not disabled)
8. Click `Add` in the review dialog

Risk:

- the `Add` button in the review dialog may not persist scopes without a version publish
- scopes added via batch import show as "Newly added" in review but only take effect after publishing a new version
- body-text scraping misses off-screen rows in the scope table

Preferred strategy: **use the console scope API instead** (see below)

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

## Scope Management via Console API

The most reliable way to add or remove scopes is through the console's internal API, bypassing the broken `ud__checkbox` components entirely.

### Scope API Endpoints

All endpoints use `POST` with `x-csrf-token` header (from `window.csrfToken`):

| Endpoint | Purpose |
|----------|---------|
| `POST /developers/v1/scope/all/{appId}` | List all scopes with current status |
| `POST /developers/v1/scope/applied/{appId}` | List scopes in the "applied" category |
| `POST /developers/v1/scope/update/{appId}` | Add or remove a scope |

### Adding a scope

```json
POST /developers/v1/scope/update/{appId}
{
  "appScopeIDs": ["21001"],
  "userScopeIDs": [],
  "scopeIds": [],
  "operation": "add"
}
```

Returns `{ "code": 0 }` on success.

### Removing a scope

```json
POST /developers/v1/scope/update/{appId}
{
  "appScopeIDs": ["21001"],
  "userScopeIDs": [],
  "scopeIds": [],
  "operation": "del"
}
```

### Scope IDs for common handoff scopes

| Scope name | ID |
|------------|-----|
| `contact:user.id:readonly` | 8 |
| `im:chat` | 21001 |
| `im:message` | 20001 |
| `im:message.group_msg` | 20012 |
| `im:message:readonly` | 20008 |
| `im:message:send_as_bot` | 1000 |
| `im:resource` | 20009 |

### Scope status values

| Status | Meaning |
|--------|---------|
| 5 | Not applied (available) |
| 0 | Removed (pending version to take effect) |
| 1 | Added (pending version to take effect) |

### Important notes

- Scope additions via API return `code: 0` immediately but only take effect after publishing a new app version
- Removed scopes (status=0) persist in the scope list until a version is published
- Removed scopes with unconfigured "data permissions" will block version creation — you must configure or fully clear data permissions before publishing
- Use `/scope/all/` (not `/scope/applied/`) to see the true status of all scopes
- The `appScopeIDs` field uses numeric string IDs (e.g. `"21001"`), not scope names

### Event and Callback APIs

Events and card callbacks can also be managed via the same API pattern:

```json
POST /developers/v1/callback/update/{appId}
{
  "operation": "add",
  "callbacks": ["im.message.receive_v1", "im.message.reaction.created_v1"],
  "callbackMode": 1
}
```

This works for both event subscriptions and card callbacks. No need to set subscription mode or URL separately if using the API.

## Callback Configuration Page

Route:

```text
/app/:appId/event?tab=callback
```

### Internal Console APIs

The console makes these authenticated POST calls with `x-csrf-token` header
(read from `window.csrfToken` on any console page):

| Endpoint | Purpose |
|----------|---------|
| `POST /developers/v1/callback/{appId}` | Get current callback config (mode, URL, subscribed callbacks) |
| `POST /developers/v1/callback/all/{appId}` | List all available callback types |
| `POST /developers/v1/callback/update/{appId}` | Add or remove callback subscriptions |
| `POST /developers/v1/robot/{appId}` | Get bot config including `cardCallbackMode` |

#### Adding callbacks via API

```json
POST /developers/v1/callback/update/{appId}
{
  "operation": "add",
  "callbacks": ["card.action.trigger"],
  "callbackMode": 1
}
```

Returns `{ "code": 0, "data": { "Head": { "RespFormat": 0 } }, "msg": "" }` on success.

### ud__checkbox Issue

The Lark Console `ud__checkbox` component ignores all programmatic interactions:
`element.click()`, Playwright `check()`, `dispatchEvent`, React fiber `onChange`,
coordinate-based clicks. The checkbox visually exists but does not toggle.

Workaround: use the `callback/update` API directly instead of clicking checkboxes
in the "Add callback" modal. The `configureInteractiveCard()` function in the
provisioning script automatically falls back to this API when `selectItemsInModal()`
fails to check the checkbox.

### CSRF Token

The correct CSRF token is `window.csrfToken`, **not** the `lark_oapi_csrf_token` cookie.
Send it as `x-csrf-token` header on all console API calls.
