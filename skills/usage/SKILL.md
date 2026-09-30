---
description: Control what usage the status line shows - hide or show all numbers, show only this session's account or every account, or reset to defaults.
argument-hint: "[hide|show|active|all|reset]"
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

Run:

```
node "${CLAUDE_PLUGIN_ROOT}/cli/sl.js" usage $ARGUMENTS --json
```

| Argument | Effect |
|---|---|
| (none) | report the current state; changes nothing |
| `hide` | hide every account's usage numbers; line 1 (folder, model, context, session tokens) stays |
| `show` | show usage numbers again |
| `active` | show only the account this session uses; other accounts are hidden and not checked |
| `all` | show every account again |
| `reset` | back to defaults: numbers visible, all accounts |

`result.usage` is `hidden` or `visible`; `result.accounts` is `active` or `all`. Reply with one line stating the resulting state, e.g. "Usage is hidden; all accounts." Both settings apply to every session on this machine, including ones started later, from the next status line refresh. If the output has `"ok": false`, show the `error` and the `fix`.
