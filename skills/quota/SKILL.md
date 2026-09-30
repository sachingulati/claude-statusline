---
description: Answer questions about Claude usage limits for the user's accounts - how much of the 5-hour or weekly limit is used, when it resets, whether weekly usage is ahead of pace, and which account has the most room left.
allowed-tools: Bash(node:*)
---

Run:

```
node "${CLAUDE_PLUGIN_ROOT}/cli/sl.js" quota --json
```

Each account in `result` has `label`, `active` (the account this session uses), `fiveHour` (`usedPct`, `resetsAtLocal`), `sevenDay` (`usedPct`, `pacePct`, `resetsAtLocal`), `ageSeconds` and `status`.

Answer the user's question directly from this data:
- `pacePct` is how much of the weekly limit would be used by now at an even rate. `usedPct` above `pacePct` means ahead of pace.
- For accounts that aren't active, say how old the data is (`ageSeconds`). If `status` isn't `ok`, say the numbers may be out of date (`auth` means that account needs a fresh login).
- `null` usage means no data yet for that account.
- Give times in the user's local time as provided in `resetsAtLocal`.
