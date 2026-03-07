# Config Schema

Use a JSON file shaped like this:

```json
{
  "mode": "create-and-configure",
  "consoleUrl": "https://open.larksuite.com",
  "appName": "My Automation App",
  "description": "Provisioned by Playwright",
  "scopes": [
    "im:message",
    "contact:user.base:readonly"
  ],
  "profileDir": "~/.lark-console/profile",
  "outputPath": "~/.lark-console/result.json",
  "selectors": {
    "createAppButton": "button:has-text(\"Create App\")",
    "customAppMenuItem": "role=menuitem[name=/Custom App|自建应用/i]",
    "appNameInput": "input[placeholder=\"App Name\"]",
    "descriptionInput": "textarea",
    "createConfirmButton": "button:has-text(\"Create\")",
    "permissionNav": "role=link[name=/Permission|权限/i]",
    "credentialNav": "role=link[name=/Credentials|凭证与基础信息/i]",
    "savePermissionsButton": "button:has-text(\"Save\")"
  }
}
```

Notes:

- Default config location: `~/.lark-console/config.json`
- `mode` supports `create-and-configure` and `update-scopes`.
- `selectors` is optional. Add overrides only for the fields that changed.
- Prefer stable `data-*` selectors when the console exposes them.
- `profileDir` and `outputPath` may use `~/...`; the script expands them to the user's home directory.
- Keep `profileDir` outside git-tracked paths.
- If the page uses localized labels, selectors should allow both Chinese and English text.
