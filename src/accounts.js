'use strict';
// Which configured account this session is.

const { normPath } = require('./paths');

// Claude Code picks the login folder from CLAUDE_SECURESTORAGE_CONFIG_DIR, else the config
// folder (paths.loginDir); the configured account with that folder is this session's.
function activeKey(all, loginDir) {
  if (loginDir) {
    const want = normPath(loginDir);
    const m = all.find(function (a) { return normPath(a.dir) === want; });
    if (m) return m.key;
  }
  return all[0].key;
}

module.exports = { activeKey };
