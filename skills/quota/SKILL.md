---
description: Answer questions about Claude usage limits for the user's accounts - how much of the 5-hour or weekly limit is used, when it resets, whether weekly usage is ahead of pace, and which account has the most room left.
allowed-tools: Bash(node:*)
---

Run:

```
node "${CLAUDE_PLUGIN_ROOT}/cli/sl.js" quota --json
```

Each account in `result` has `label`, `active` (the account this session uses), `fiveHour` (`usedPct`, `resetsAtLocal`), `sevenDay` (`usedPct`, `pacePct`, `resetsAtLocal`), `ageSeconds` and `status` (`recorded` or `none`).

Answer the user's question directly from this data:
- `pacePct` is how much of the weekly limit would be used by now at an even rate. `usedPct` above `pacePct` means ahead of pace.
- For accounts that aren't active, the numbers are as last recorded by that account's own Claude Code sessions on this machine, or by sline's background check through Claude Code; say how old they are (`ageSeconds`).
- `null` usage means no data yet for that account.
- Give times in the user's local time as provided in `resetsAtLocal`.
