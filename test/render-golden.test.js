'use strict';
// With no display settings the status line must stay exactly what it was before
// templates existed. UTC fixes the clock times; node --test runs each file in its own
// process, so this doesn't leak into other tests.
process.env.TZ = 'UTC';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { tmpEnv, addCreds, writeJson, writeCache, stripAnsi } = require('./helpers');
const render = require('../src/render');

const NOW = Date.UTC(2026, 8, 29, 12, 0, 0); // Tue 29 Sep 2026 12:00 UTC
const S = NOW / 1000;
const LINE1 = 'dir:~/proj · model:Opus 5.5 · effort:high · ctx: 12% · session:340.0ktk';
const B_OK = {
  status: 'ok', fetched_at: S - 180, checked_at: S - 180, next_attempt_at: S + 1000,
  five_hour: { utilization: 29, resets_at: S + 3 * 3600 }, seven_day: { utilization: 28, resets_at: S + 4 * 86400 },
};

function setup() {
  const t = tmpEnv();
  const bDir = path.join(t.home, '.creds-b');
  addCreds(t.p.claudeDir);
  addCreds(bDir);
  writeJson(t.p.configFile, { accounts: [{ label: 'A', credsDir: t.p.claudeDir }, { label: 'B', credsDir: bDir }] });
  const proj = path.join(t.home, 'proj');
  fs.mkdirSync(proj);
  return { t, bDir, proj };
}

function payload(cwd) {
  return {
    workspace: { current_dir: cwd },
    model: { id: 'claude-opus-5-5' },
    effort: { level: 'high' },
    context_window: { used_percentage: 12, total_input_tokens: 300000, total_output_tokens: 40000 },
    rate_limits: {
      five_hour: { used_percentage: 52, resets_at: S + 2 * 3600 },
      seven_day: { used_percentage: 38, resets_at: S + 4 * 86400 },
    },
  };
}

function draw(t, p, env) {
  return stripAnsi(render.render(p, { env: Object.assign({}, t.env, env || {}), now: NOW, spawn: () => {} }));
}

test('golden: two accounts, A active', () => {
  const { t, proj } = setup();
  try {
    writeCache(t.p, 'B', B_OK);
    assert.equal(draw(t, payload(proj)), LINE1 + '\n' +
      '[A] 5h: 52%, 14:00 · 7d: 38% / 43%, Sat 12:00\n' +
      '[B] 5h: 29%, 15:00 · 7d: 28% / 43%, Sat 12:00  (3m ago)\n');
  } finally { t.cleanup(); }
});

test('golden: B active with A never fetched; stale and auth lines', () => {
  const { t, bDir, proj } = setup();
  try {
    assert.equal(draw(t, payload(proj), { CLAUDE_SECURESTORAGE_CONFIG_DIR: bDir }), LINE1 + '\n' +
      '[B] 5h: 52%, 14:00 · 7d: 38% / 43%, Sat 12:00\n' +
      '[A] usage:--\n');
    writeCache(t.p, 'B', Object.assign({}, B_OK, { status: 'error' }));
    assert.equal(draw(t, payload(proj)).split('\n')[2], '[B] 5h: 29%, 15:00 · 7d: 28% / 43%, Sat 12:00  (3m ago, stale)');
    writeCache(t.p, 'B', { status: 'auth' });
    assert.equal(draw(t, payload(proj)).split('\n')[2], '[B] auth?');
  } finally { t.cleanup(); }
});

test('golden: spend only, no rate limits yet, hidden', () => {
  const t = tmpEnv();
  try {
    addCreds(t.p.claudeDir);
    assert.equal(draw(t, { workspace: { current_dir: t.home }, rate_limits: { spend_limit: { used_percentage: 64, resets_at: S + 2 * 86400 } } }),
      'dir:~\nspend: 64%, Thu 12:00\n');
    assert.equal(draw(t, { workspace: { current_dir: t.home }, model: { id: 'm' } }), 'dir:~ · model:m\n');
    fs.mkdirSync(t.p.stateDir, { recursive: true });
    fs.writeFileSync(t.p.hiddenFlag, '');
    assert.equal(draw(t, payload(t.home)), 'dir:~ · model:Opus 5.5 · effort:high · ctx: 12% · session:340.0ktk\nhidden\n');
  } finally { t.cleanup(); }
});
