# Console Flow

This note captures the stable console workflow for creating, cloning, and publishing a Lark custom app.

Use this file when the task is operational:

- create a new custom app
- clone scopes from an existing app
- read credentials from the console
- create and publish a version

## Page Map

These routes were observed in the Lark developer console:

- `/app`: custom app list page
- `/app/:appId/baseinfo`: credentials and basic info
- `/app/:appId/auth`: permissions and scopes
- `/app/:appId/event`: events and callbacks
- `/app/:appId/safe`: security settings
- `/app/:appId/test`: test companies and users
- `/app/:appId/version`: version list
- `/app/:appId/version/create`: version creation form
- `/app/:versionId` under `/version/...`: version detail page

## Recommended Flow

### 1. Find or Create the Source App

Use the app list search box with placeholder `Search by app name or App ID`.

If the task is "copy app X", confirm:

- the app is visible under the current logged-in account
- the app name is unique enough to avoid clicking the wrong card

### 2. Create the Target App

On the list page:

- click `Create Custom App`
- fill app name
- fill description
- select an icon
- submit creation

Important:

- the create form requires icon selection; do not assume name and description are enough
- creation may land on a capability page instead of the permissions page

### 3. Open the Permissions Page Explicitly

Do not rely on side-nav click-only flows after creation.

Prefer opening:

```text
/app/:appId/auth
```

This is more reliable than trying to infer where the UI redirected after creation.

### 4. Clone Scopes

Preferred order:

1. export/import payload from `Batch import/export scopes`
2. structured table extraction
3. visible text extraction as last resort

Important:

- the scopes table is virtualized; do not trust only the first screen
- batch import/export is the best source of truth when the export payload can be read cleanly
- if export tooling is brittle, use a user-provided JSON payload or a verified scope list

### 5. Verify Bot / Events / Cards Separately

Bot, events, and interactive cards are separate capability pages. Do not infer them from scopes alone.

For example:

- `botEnabled: false` means the Bot page should remain unconfigured
- no `eventSubscriptions` means the Events page should remain untouched
- no `interactiveCard` means callback configuration should remain untouched

### 6. Read Credentials

Credentials live on:

```text
/app/:appId/baseinfo
```

Observed fields:

- `App ID`
- `App Secret`

Important:

- `App Secret` is masked by default
- reading the real value may require clicking a visibility control in the credentials block
- never persist real secrets in repo files

### 7. Create and Publish a Version

Version release is a separate flow:

1. open `/app/:appId/version`
2. create a version if none exists
3. fill:
   - app version
   - update notes
   - reason for request
4. save the version
5. submit for release if required
6. publish if the console shows a final publish step

Observed behavior:

- version creation uses `/version/create`, not a modal
- `Submit for release` and `Publish` may be separate steps
- the console may auto-approve internal releases depending on scope/review state

## Fallback Rules

- Prefer direct URLs over side-nav traversal when a page is known.
- Prefer form-field placeholders only as a first selector; keep a fallback for unlabeled inputs.
- If visible text and DOM structure disagree, trust the route and re-read the page after a short wait.
- If release flow appears stuck, re-open the version detail page and check whether the status already changed.

## What Not to Store

Do not store these in repo-tracked files:

- `App Secret`
- verification tokens
- callback URLs if they are environment-private and user-specific
- local profile paths outside documented examples
