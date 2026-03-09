# Config Schema

Use a JSON file shaped like this:

```json
{
  "mode": "create-and-configure",
  "consoleUrl": "https://open.larksuite.com/app",
  "appName": "My Automation App",
  "description": "Provisioned by Playwright",
  "scopes": [
    "im:message",
    "contact:user.base:readonly"
  ],
  "profileDir": "~/.lark-console/profile",
  "outputPath": "~/.lark-console/result.json",
  "botEnabled": true,
  "eventSubscriptions": {
    "requestUrl": "https://example.com/lark/events",
    "events": [
      "im.message.receive_v1"
    ]
  },
  "interactiveCard": {
    "requestUrl": "https://example.com/lark/card",
    "callbacks": [
      "card.action.trigger"
    ]
  },
  "encryption": {
    "verificationToken": "replace-with-your-token"
  },
  "selectors": {
    "createAppButton": "button:has-text(\"Create Custom App\"), button:has-text(\"Create App\")",
    "appNameInput": "input[placeholder=\"App Name\"]",
    "descriptionInput": "textarea",
    "createConfirmButton": "button:has-text(\"Create\")",
    "permissionNav": "role=link[name=/Permissions & Scopes|Permission|权限/i]",
    "botNav": "role=link[name=/Bot|机器人/i]",
    "eventSubscriptionNav": "role=link[name=/Event Subscriptions|Events & Callbacks|事件订阅/i]",
    "interactiveCardNav": "role=link[name=/Interactive Features|Card Request URL|卡片请求网址/i]",
    "credentialNav": "role=link[name=/Credentials|凭证与基础信息/i]",
    "savePermissionsButton": "button:has-text(\"Save\")",
    "requestUrlInput": "input[placeholder*=\"URL\"], input[placeholder*=\"HTTP/HTTPS URL\"]",
    "cardRequestUrlInput": "input[placeholder*=\"URL\"], input[placeholder*=\"HTTP/HTTPS URL\"]",
    "eventSearchInput": "input[placeholder*=\"Search\"], input[placeholder*=\"搜索\"]",
    "saveButton": "button:has-text(\"Save\"), button:has-text(\"保存\")"
  }
}
```

Notes:

- Default config location: `~/.lark-console/config.json`
- `mode` supports `create-and-configure` and `configure-existing`.
- Set `appId` when you want to update an existing app without creating a new one.
- `botEnabled`, `eventSubscriptions`, `interactiveCard`, and `encryption` are optional.
- `selectors` is optional. Add overrides only for the fields that changed.
- Prefer stable `data-*` selectors when the console exposes them.
- `profileDir` and `outputPath` may use `~/...`; the script expands them to the user's home directory.
- Keep `profileDir` outside git-tracked paths.
- If the page uses localized labels, selectors should allow both Chinese and English text.
