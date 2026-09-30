'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { tmpEnv, writeJson, writeCache } = require('./helpers');
const quota = require('../src/quota');

const NOW = Date.UTC(2026, 8, 29, 12);
const NOW_S = NOW / 1000;

test('quota lists every account with usage, pace, age and the active flag', () => {
  const t = tmpEnv();
  try {
    const bDir = path.join(t.home, '.creds-b');
    writeJson(t.p.configFile, { accounts: [{ label: 'A', credsDir: t.p.claudeDir }, { label: 'B', credsDir: bDir }] });
    writeCache(t.p, 'B', { status: 'ok', fetched_at: NOW_S - 120, five_hour: { utilization: 29.4, resets_at: NOW_S + 3600 }, seven_day: { utilization: 28, resets_at: NOW_S + 3.5 * 86400 } });
    const env = Object.assign({}, t.env, { CLAUDE_SECURESTORAGE_CONFIG_DIR: bDir });
    const q = quota.quota(t.p, env, NOW);
    assert.equal(q.length, 2);
    assert.deepEqual([q[0].label, q[0].active, q[0].status, q[0].fiveHour], ['A', false, 'none', null]);
    assert.equal(q[1].status, 'recorded');
    assert.equal(q[1].active, true);
    assert.equal(q[1].fiveHour.usedPct, 29);
    assert.equal(q[1].sevenDay.pacePct, 50);
    assert.equal(q[1].ageSeconds, 120);
    assert.equal(typeof q[1].fiveHour.resetsAtLocal, 'string');
  } finally { t.cleanup(); }
});

test('a default session is the claudeDir account even when it is not listed first', () => {
  const t = tmpEnv();
  try {
    const bDir = path.join(t.home, '.creds-b');
    writeJson(t.p.configFile, { accounts: [{ label: 'Work', credsDir: bDir }, { label: 'A', credsDir: t.p.claudeDir }] });
    const q = quota.quota(t.p, t.env, NOW);
    assert.deepEqual(q.map(a => [a.label, a.active]), [['Work', false], ['A', true]]);
  } finally { t.cleanup(); }
});

test('quota rolls a record past its resets', () => {
  const t = tmpEnv();
  try {
    writeCache(t.p, 'default', { status: 'ok', fetched_at: NOW_S - 86400,
      five_hour: { utilization: 70, resets_at: NOW_S - 60 }, seven_day: { utilization: 90, resets_at: NOW_S - 60 } });
    const q = quota.quota(t.p, t.env, NOW)[0];
    assert.deepEqual([q.fiveHour.usedPct, q.fiveHour.resetsAt], [0, null]);
    assert.deepEqual([q.sevenDay.usedPct, q.sevenDay.resetsAt], [0, NOW_S - 60 + 7 * 86400]);
  } finally { t.cleanup(); }
});
