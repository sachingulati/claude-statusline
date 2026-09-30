'use strict';
// Which configured accounts exist on this machine, and which one this session is.

const fs = require('fs');
const path = require('path');
const { normPath } = require('./paths');

function present(accounts) {
  return accounts.filter(function (a) {
    try { return fs.existsSync(path.join(a.dir, '.credentials.json')); } catch (e) { return false; }
  });
}

// Claude Code picks the login folder from CLAUDE_SECURESTORAGE_CONFIG_DIR, so the same
// variable tells us which account this session is. Match against every configured
// account: the active one's numbers come from stdin and need no credentials file.
function activeKey(presentList, all, secureDir) {
  if (secureDir) {
    const want = normPath(secureDir);
    const m = all.find(function (a) { return normPath(a.dir) === want; });
    if (m) return m.key;
  }
  return presentList.length ? presentList[0].key : all[0].key;
}

module.exports = { present, activeKey };
