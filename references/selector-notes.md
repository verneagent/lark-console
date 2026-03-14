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

### Scope IDs

| Scope name | ID | Category |
|------------|-----|----------|
| `contact:user.id:readonly` | 8 | Contact |
| `contact:user.employee_id:readonly` | 3 | Contact |
| `im:chat` | 21001 | IM |
| `im:chat:readonly` | 21003 | IM |
| `im:message` | 20001 | IM |
| `im:message.group_msg` | 20012 | IM |
| `im:message:readonly` | 20008 | IM |
| `im:message:send_as_bot` | 1000 | IM |
| `im:resource` | 20009 | IM |
| `docx:document` | 41002 | Docs |
| `docx:document:readonly` | 41003 | Docs |
| `docs:doc` | 26007 | Docs (legacy) |
| `docs:doc:readonly` | 26008 | Docs (legacy) |
| `wiki:wiki` | 26009 | Wiki |
| `wiki:wiki:readonly` | 26010 | Wiki |
| `drive:drive` | 26001 | Drive |
| `drive:drive:readonly` | 26003 | Drive |
| `drive:file` | 26005 | Drive |
| `drive:file:readonly` | 26006 | Drive |
| `bitable:app` | 26015 | Bitable |
| `bitable:app:readonly` | 26016 | Bitable |
| `sheets:spreadsheet` | 26011 | Sheets |
| `sheets:spreadsheet:readonly` | 26012 | Sheets |
| `cardkit:card:read` | 1014131 | CardKit |
| `cardkit:card:write` | 1014132 | CardKit |

To discover IDs for scopes not listed here, call `/developers/v1/scope/all/{appId}` which returns all scopes with their numeric `id` and `name` fields.

### Scope status values

| Status | Meaning |
|--------|---------|
| 5 | Active (applied and in effect) |
| 0 | Not applied (available to add) |
| 1 | Added (pending version publish to take effect) |

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

## Version Management via Console API

Version creation and publishing can also be done via the console API, making the entire provision flow API-only (no UI clicking needed).

### Version API Endpoints

| Endpoint | Purpose |
|----------|---------|
| `POST /developers/v1/app_version/list/{appId}` | List all versions |
| `POST /developers/v1/app_version/detail/{appId}/{versionId}` | Get version details |
| `POST /developers/v1/app_version/change/{appId}` | Get pending changes since last version |
| `POST /developers/v1/app_version/create/{appId}` | Create a new version |
| `POST /developers/v1/publish/commit/{appId}/{versionId}` | Submit and publish the version |
| `POST /developers/v1/approval_nodes/get/{appId}` | Check if auto-approval is available |

### Creating and publishing a version (full flow)

```json
// Step 1: Create version
POST /developers/v1/app_version/create/{appId}
{
  "appVersion": "1.8.0",
  "mobileDefaultAbility": "bot",
  "pcDefaultAbility": "bot",
  "changeLog": "Add document and wiki scopes",
  "visibleSuggest": {
    "departments": [],
    "members": ["<userId>"],
    "groups": [],
    "isAll": 0
  },
  "applyReasonConfig": {
    "apiPrivilegeNeedReason": false,
    "contactPrivilegeNeedReason": false,
    "dataPrivilegeReasonMap": {},
    "visibleScopeNeedReason": false,
    "apiPrivilegeReasonMap": {},
    "contactPrivilegeReason": "",
    "isDataPrivilegeExpandMap": {},
    "visibleScopeReason": "",
    "dataPrivilegeNeedReason": false,
    "isAutoAudit": false,
    "isContactExpand": false
  }
}
// Returns: { "code": 0, "data": { "versionId": "7617092966151900895" } }
```

```json
// Step 2: Submit and publish
POST /developers/v1/publish/commit/{appId}/{versionId}
{}
// Returns: { "code": 0 }
```

### Important notes

- The `visibleSuggest.members` array must include at least one user ID (the developer)
- `mobileDefaultAbility` and `pcDefaultAbility` should match the app's configured abilities (usually `"bot"`)
- `publish/commit` both submits for review and publishes in one call when auto-approval is enabled
- Auto-approval status can be checked via `approval_nodes/get` — if `canAutoApproval: true`, publish/commit will auto-publish
- The `changeLog` field corresponds to "What's new" / "Update notes" in the UI

### Other useful APIs

| Endpoint | Purpose |
|----------|---------|
| `POST /developers/v1/app/{appId}` | Get app info (status, abilities, avatar) |
| `POST /developers/v1/app_role/permission/{appId}` | Get role permissions |
| `POST /developers/v1/privilege/all/{appId}` | List all data permissions |
| `POST /developers/v1/contact_range/{appId}` | Get contact range config |
| `POST /developers/v1/config/audit_rule/{appId}` | Get audit rule config |
| `POST /developers/v1/visible/online/{appId}` | Get visibility settings |
| `POST /developers/v1/scope/applied/{appId}` | List applied scopes with details |

### CSRF Token

The correct CSRF token is `window.csrfToken`, **not** the `lark_oapi_csrf_token` cookie.
Send it as `x-csrf-token` header on all console API calls.
