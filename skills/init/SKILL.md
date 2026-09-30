---
description: Set up the sline status line in your Claude Code settings. Run once after installing the plugin.
argument-hint: "[--refresh <seconds>]"
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

Set up the status line.

1. Run:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/cli/sl.js" init $ARGUMENTS --json
   ```

2. If `node` is not found, tell the user sline needs Node.js 18 or later (https://nodejs.org) and stop.
3. If the output has `"ok": false`, tell the user the `error` and the `fix` in plain words and stop. Do not edit settings.json yourself.
4. Otherwise report in two or three short lines: whether settings.json changed, the backup file if one was made, that the status line appears with the next reply and then refreshes every `refreshInterval` seconds, and that subagent rows under the prompt now show each subagent's model, context, tokens and running time.
5. Mention that other logins are added automatically the first time a session uses them, and that `/sline:config` renames or forgets accounts.
