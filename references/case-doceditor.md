# Case: DocEditor From Henchman

This is a sanitized case note for cloning one app into another through the Lark developer console.

## Goal

Create `DocEditor`, align its scopes to a known source app, read credentials, and publish the initial internal version.

## What Worked

- creating the target app through the console UI
- opening known pages by direct route using `appId`
- updating scopes with a verified JSON list
- reading `App ID` and `App Secret` from the credentials page
- creating version `1.0.0`
- publishing the internal release successfully

## What Broke

### 1. Scope Extraction By Visible Text

The permissions table is virtualized. Reading `body.innerText` only captured the visible upper portion of the list and missed later scopes.

Lesson:

- do not treat visible page text as the source of truth for the full scope set

### 2. Batch Export DOM Readout

The batch export UI exposed editor content inconsistently. DOM-visible textarea content and visible text did not reliably contain the complete exported JSON payload.

Lesson:

- export/import is the right product workflow
- but automation still needs validation that the extracted payload is complete before using it

### 3. Create App Navigation Assumptions

After creating the app, the console did not reliably land on the permissions page.

Lesson:

- after creation, navigate to `/app/:appId/auth` explicitly

### 4. Version Publishing Is Multi-Step

The release flow was not a single action. It moved through:

- create version
- submit for release
- publish

Lesson:

- treat version release as a state machine, not a single button click

## Verified Scope Set Used For DocEditor

The final aligned scope set used in this case was:

- `bitable:app`
- `bitable:app:readonly`
- `board:whiteboard:node:create`
- `board:whiteboard:node:read`
- `contact:user.id:readonly`
- `docs:permission.member`
- `docs:permission.member:create`
- `docs:permission.member:delete`
- `docs:permission.member:readonly`
- `docs:permission.member:retrieve`
- `docs:permission.member:update`
- `docx:document`
- `docx:document:readonly`
- `docx:document:write_only`
- `drive:drive`
- `drive:drive:version:readonly`
- `im:chat`
- `im:message`
- `im:message.group_msg`
- `im:message.group_msg:readonly`
- `im:message:readonly`
- `im:message:send_as_bot`
- `im:resource`
- `sheets:spreadsheet:readonly`
- `slides:presentation:create`
- `slides:presentation:read`
- `slides:presentation:update`
- `slides:presentation:write_only`
- `space:document:delete`
- `wiki:node:create`
- `wiki:node:read`
- `wiki:space:read`
- `wiki:wiki`
- `wiki:wiki:readonly`
- `search:docs:read`

## Recommendations For Next Time

- ask for a verified scope JSON if the source app is critical
- if cloning from an existing app, prefer export/import but validate payload completeness
- keep a sanitized case file for each console flow that needed manual fallback
