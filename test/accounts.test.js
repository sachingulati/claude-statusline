'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { tmpEnv } = require('./helpers');
const accounts = require('../src/accounts');

function setup() {
  const t = tmpEnv();
  const a = { label: 'A', key: 'A', dir: t.p.claudeDir };
  const b = { label: 'B', key: 'B', dir: path.join(t.home, '.creds-b') };
  return { t, all: [a, b] };
}

test('an unknown login folder falls back to the first account', () => {
  const { t, all } = setup();
  try {
    assert.equal(accounts.activeKey(all, undefined), 'A');
    assert.equal(accounts.activeKey(all, path.join(t.home, 'elsewhere')), 'A');
  } finally { t.cleanup(); }
});

test('the login folder in any spelling selects the account, no files needed', () => {
  const { t, all } = setup();
  try {
    const b = all[1].dir;
    const gitBash = b.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (m, d) => '/' + d.toLowerCase());
    const spellings = [b, b + path.sep, gitBash].concat(process.platform === 'linux' ? [] : [b.toUpperCase()]);
    for (const s of spellings) assert.equal(accounts.activeKey(all, s), 'B', 'spelling: ' + s);
  } finally { t.cleanup(); }
});
