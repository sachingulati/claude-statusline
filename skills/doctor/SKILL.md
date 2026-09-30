---
description: Check that the SLine plugin is set up and working, and explain how to fix anything that isn't.
disable-model-invocation: true
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/cli/sl.js" *)
---

Run:

```
node "${CLAUDE_PLUGIN_ROOT}/cli/sl.js" doctor --json
```

A non-zero exit code only means at least one check failed; read the JSON either way.

Report:
1. One line saying whether everything is fine.
2. Each `fail`, then each `warn`, with its `fix` in plain words.
3. `info` lines only if they explain a problem the user asked about.

If a fix is running `/sline:init`, offer to run it. Do not edit settings.json or config.json yourself. If `node` is not found, tell the user SLine needs Node.js 18 or later.
