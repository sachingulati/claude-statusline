'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { tmpEnv, addCreds } = require('./helpers');
const accounts = require('../src/accounts');

function setup() {
  const t = tmpEnv();
  const a = { label: 'A', key: 'A', dir: t.p.claudeDir };
  const b = { label: 'B', key: 'B', dir: path.join(t.home, '.creds-b') };
  addCreds(a.dir);
  addCreds(b.dir);
  return { t, all: [a, b] };
}

test('present keeps accounts with a credentials file', () => {
  const { t, all } = setup();
  try {
    const c = { label: 'C', key: 'C', dir: path.join(t.home, '.none') };
    assert.deepEqual(accounts.present(all.concat(c)).map(a => a.key), ['A', 'B']);
  } finally { t.cleanup(); }
});

test('active falls back to the first present account', () => {
  const { t, all } = setup();
  try {
    assert.equal(accounts.activeKey(all, all, undefined), 'A');
  } finally { t.cleanup(); }
});

test('CLAUDE_SECURESTORAGE_CONFIG_DIR in any spelling selects the account', () => {
  const { t, all } = setup();
  try {
    const b = all[1].dir;
    const gitBash = b.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (m, d) => '/' + d.toLowerCase());
    for (const s of [b, b + path.sep, b.toUpperCase(), gitBash]) {
      assert.equal(accounts.activeKey(all, all, s), 'B', 'spelling: ' + s);
    }
  } finally { t.cleanup(); }
});

test('the active account is matched even without a credentials file', () => {
  const { t, all } = setup();
  try {
    const c = { label: 'C', key: 'C', dir: path.join(t.home, '.creds-c') };
    const everything = all.concat(c);
    assert.equal(accounts.activeKey(accounts.present(everything), everything, c.dir), 'C');
  } finally { t.cleanup(); }
});
