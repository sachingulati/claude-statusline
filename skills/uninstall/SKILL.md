---
description: Remove the SLine status line from your settings before uninstalling the plugin, restoring your previous status line.
argument-hint: "[--purge]"
disable-model-invocation: true
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/cli/sl.js" *)
---

1. Tell the user what will happen: settings.json gets back the status line and subagent rows it had before `/sline:init` (or none), and the launcher is removed. Accounts config and usage cache are kept unless `--purge` is given. Ask them to confirm. Stop if they don't.
2. Run:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/cli/sl.js" uninstall $ARGUMENTS --json
   ```

3. Report what changed, including the backup file. If `result.leftAlone` is true, say that settings.json's status line had been changed since init and was left as is. Likewise, if `result.subagentLeftAlone` is true, say that settings.json's `subagentStatusLine` had been changed since init and was left as is.
4. Finish with the command to remove the plugin itself: `/plugin uninstall sline@sachingulati`.
