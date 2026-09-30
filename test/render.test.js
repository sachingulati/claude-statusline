'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { tmpEnv, addCreds, writeJson, writeCache, stripAnsi } = require('./helpers');
const render = require('../src/render');
const cache = require('../src/cache');

const NOW = Date.UTC(2026, 8, 29, 12, 0, 0);
const NOW_S = NOW / 1000;

function twoAccounts() {
  const t = tmpEnv();
  const bDir = path.join(t.home, '.creds-b');
  addCreds(t.p.claudeDir);
  addCreds(bDir);
  writeJson(t.p.configFile, { accounts: [{ label: 'A', credsDir: t.p.claudeDir }, { label: 'B', credsDir: bDir }] });
  writeCache(t.p, 'B', { status: 'ok', fetched_at: NOW_S - 180, checked_at: NOW_S - 180, next_attempt_at: NOW_S + 1000,
    five_hour: { utilization: 29, resets_at: NOW_S + 3 * 3600 }, seven_day: { utilization: 28, resets_at: NOW_S + 4 * 86400 } });
  const proj = path.join(t.home, 'proj');
  fs.mkdirSync(proj);
  return { t, bDir, proj };
}

function payload(cwd, extra) {
  return Object.assign({
    workspace: { current_dir: cwd },
    model: { id: 'claude-opus-5-5' },
    effort: { level: 'high' },
    context_window: { used_percentage: 12, total_input_tokens: 300000, total_output_tokens: 40000 },
    rate_limits: {
      five_hour: { used_percentage: 52, resets_at: NOW_S + 2 * 3600 },
      seven_day: { used_percentage: 38, resets_at: NOW_S + 4 * 86400 },
    },
  }, extra || {});
}

test('two accounts, A active: live line for A, cached line for B', () => {
  const { t, proj } = twoAccounts();
  try {
    const spawned = [];
    const out = stripAnsi(render.render(payload(proj), { env: t.env, now: NOW, spawn: a => spawned.push(a.key) })).trimEnd().split('\n');
    assert.match(out[0], /^dir:~\/proj · model:Opus 5.5 · effort:high · ctx: 12% · session:340\.0ktk$/);
    assert.match(out[1], /^\[A\] 5h: 52%, \d\d:\d\d · 7d: 38% \/ \d+%, \w{3} \d\d:\d\d$/);
    assert.match(out[2], /^\[B\] 5h: 29%, .* \(3m ago\)$/);
    assert.equal(out.length, 3);
    assert.deepEqual(spawned, []); // A is live, B is not due
    assert.equal(cache.read(t.p, 'A').five_hour.utilization, 52); // live numbers persisted
  } finally { t.cleanup(); }
});

test('B active via CLAUDE_SECURESTORAGE_CONFIG_DIR; A shown from cache and refreshed when due', () => {
  const { t, bDir, proj } = twoAccounts();
  try {
    const spawned = [];
    const env = Object.assign({}, t.env, { CLAUDE_SECURESTORAGE_CONFIG_DIR: bDir });
    const out = stripAnsi(render.render(payload(proj), { env, now: NOW, spawn: a => spawned.push(a.key) })).trimEnd().split('\n');
    assert.match(out[1], /^\[B\] 5h: 52%/);
    assert.match(out[2], /^\[A\] usage:--$/);
    assert.deepEqual(spawned, ['A']);
  } finally { t.cleanup(); }
});

test('display.otherAccounts false: only the active line, unlabelled, no refresh for others', () => {
  const { t, proj } = twoAccounts();
  try {
    const raw = JSON.parse(fs.readFileSync(t.p.configFile, 'utf8'));
    raw.display = { otherAccounts: false };
    writeJson(t.p.configFile, raw);
    fs.rmSync(cache.file(t.p, 'B')); // B would be due
    const spawned = [];
    const out = stripAnsi(render.render(payload(proj), { env: t.env, now: NOW, spawn: a => spawned.push(a.key) })).trimEnd().split('\n');
    assert.equal(out.length, 2);
    assert.match(out[1], /^5h: 52%/);
    assert.deepEqual(spawned, []);
  } finally { t.cleanup(); }
});

test('a second configured account without a login: one line, unlabelled', () => {
  const t = tmpEnv();
  try {
    addCreds(t.p.claudeDir);
    writeJson(t.p.configFile, { accounts: [{ label: 'A', credsDir: '~/.claude' }, { label: 'B', credsDir: '~/.creds-b' }] });
    const out = stripAnsi(render.render(payload(t.home), { env: t.env, now: NOW, spawn: () => {} })).trimEnd().split('\n');
    assert.equal(out.length, 2);
    assert.match(out[1], /^5h: 52%/);
  } finally { t.cleanup(); }
});

test('hidden: line 1 unchanged, usage lines replaced by the marker; nothing fetched', () => {
  const { t, proj } = twoAccounts();
  try {
    fs.writeFileSync(t.p.hiddenFlag, '');
    const spawned = [];
    const out = stripAnsi(render.render(payload(proj), { env: t.env, now: NOW, spawn: a => spawned.push(a.key) }));
    assert.equal(out, 'dir:~/proj · model:Opus 5.5 · effort:high · ctx: 12% · session:340.0ktk\nhidden\n');
    assert.deepEqual(spawned, []);
  } finally { t.cleanup(); }
});

test('single default account: no [label] prefix', () => {
  const t = tmpEnv();
  try {
    addCreds(t.p.claudeDir);
    const out = stripAnsi(render.render(payload(t.home), { env: t.env, now: NOW, spawn: () => {} })).trimEnd().split('\n');
    assert.match(out[0], /^dir:~ /);
    assert.match(out[1], /^5h: 52%/);
  } finally { t.cleanup(); }
});

test('empty or malformed stdin still renders line 1', () => {
  const t = tmpEnv();
  try {
    const opts = { env: t.env, now: NOW, spawn: () => {} };
    assert.match(stripAnsi(render.run('', opts)), /^dir:/);
    assert.match(stripAnsi(render.run('{ not json', opts)), /^dir:/);
    assert.match(stripAnsi(render.run('null', opts)), /^dir:/);
  } finally { t.cleanup(); }
});

test('spend limit shows on line 2, even without 5h/7d', () => {
  const t = tmpEnv();
  try {
    addCreds(t.p.claudeDir);
    const p1 = { workspace: { current_dir: t.home }, rate_limits: { spend_limit: { used_percentage: 64, resets_at: NOW_S + 2 * 86400 } } };
    const out = stripAnsi(render.render(p1, { env: t.env, now: NOW, spawn: () => {} })).trimEnd().split('\n');
    assert.match(out[1], /^spend: 64%, \w{3} \d\d:\d\d$/);
    const p2 = payload(t.home, {});
    p2.rate_limits.spend_limit = { used_percentage: 120 };
    const withAll = render.render(p2, { env: t.env, now: NOW, spawn: () => {} }).split('\n')[1];
    assert.ok(withAll.includes('spend: ' + require('../src/format').ORANGE + '120%'));
    assert.ok(stripAnsi(withAll).endsWith('spend: 120%, --- --:--'));
  } finally { t.cleanup(); }
});

test('a new login folder registers itself: default becomes A, the new one B', () => {
  const t = tmpEnv();
  try {
    const bDir = path.join(t.home, '.creds-b');
    addCreds(t.p.claudeDir);
    addCreds(bDir);
    const opts = { env: Object.assign({}, t.env, { CLAUDE_SECURESTORAGE_CONFIG_DIR: bDir }), now: NOW, spawn: () => {} };
    const out = stripAnsi(render.render(payload(t.home), opts)).trimEnd().split('\n');
    assert.deepEqual(JSON.parse(fs.readFileSync(t.p.configFile, 'utf8')).accounts,
      [{ label: 'A', credsDir: '~/.claude' }, { label: 'B', credsDir: '~/.creds-b' }]);
    assert.match(out[1], /^\[B\] 5h: 52%/); // rendered with the new accounts straight away
    assert.match(out[2], /^\[A\] /);
  } finally { t.cleanup(); }
});

test('known, default-only and forgotten folders register nothing', () => {
  const t = tmpEnv();
  try {
    render.render(payload(t.home), { env: t.env, now: NOW, spawn: () => {} });
    assert.equal(fs.existsSync(t.p.configFile), false); // default login alone
    writeJson(t.p.configFile, { accounts: [{ label: 'A', credsDir: '~/.claude' }], ignoredDirs: ['~/.creds-b'] });
    const env = Object.assign({}, t.env, { CLAUDE_SECURESTORAGE_CONFIG_DIR: path.join(t.home, '.creds-b') });
    render.render(payload(t.home), { env, now: NOW, spawn: () => {} });
    assert.deepEqual(JSON.parse(fs.readFileSync(t.p.configFile, 'utf8')).accounts, [{ label: 'A', credsDir: '~/.claude' }]);
  } finally { t.cleanup(); }
});

test('a broken config.json is not overwritten by registration, and the line still renders', () => {
  const t = tmpEnv();
  try {
    fs.mkdirSync(t.p.stateDir, { recursive: true });
    fs.writeFileSync(t.p.configFile, '{ broken');
    const env = Object.assign({}, t.env, { CLAUDE_SECURESTORAGE_CONFIG_DIR: path.join(t.home, '.creds-b') });
    assert.match(stripAnsi(render.render(payload(t.home), { env, now: NOW, spawn: () => {} })), /^dir:~ /);
    assert.equal(fs.readFileSync(t.p.configFile, 'utf8'), '{ broken');
  } finally { t.cleanup(); }
});

test('a login folder in a non-normal spelling registers once, not on every render', () => {
  for (const spell of [h => h + '//.creds-b', h => h + '/./.creds-b', h => h + '/x/../.creds-b', () => '~/.creds-b']) {
    const t = tmpEnv();
    try {
      const bDir = path.join(t.home, '.creds-b');
      addCreds(t.p.claudeDir);
      addCreds(bDir);
      const opts = { env: Object.assign({}, t.env, { CLAUDE_SECURESTORAGE_CONFIG_DIR: spell(t.home) }), now: NOW, spawn: () => {} };
      let out;
      for (let i = 0; i < 3; i++) out = stripAnsi(render.render(payload(t.home), opts)).trimEnd().split('\n');
      assert.deepEqual(JSON.parse(fs.readFileSync(t.p.configFile, 'utf8')).accounts,
        [{ label: 'A', credsDir: '~/.claude' }, { label: 'B', credsDir: '~/.creds-b' }], spell(t.home));
      assert.match(out[1], /^\[B\] 5h: 52%/, spell(t.home));
    } finally { t.cleanup(); }
  }
});

test('a default session is the claudeDir account even when another account is listed first', () => {
  const t = tmpEnv();
  try {
    const bDir = path.join(t.home, '.creds-b');
    addCreds(t.p.claudeDir);
    addCreds(bDir);
    writeJson(t.p.configFile, { accounts: [{ label: 'Work', credsDir: '~/.creds-b' }] });
    const out = stripAnsi(render.render(payload(t.home), { env: t.env, now: NOW, spawn: () => {} })).trimEnd().split('\n');
    assert.match(out[1], /^\[A\] 5h: 52%/);
    assert.equal(cache.read(t.p, 'Work'), null); // Work's cache not overwritten with A's numbers
  } finally { t.cleanup(); }
});

test('RECAP is printed as a final line', () => {
  const t = tmpEnv();
  try {
    const env = Object.assign({}, t.env, { RECAP: 'recap text' });
    const out = render.render(payload(t.home), { env, now: NOW, spawn: () => {} });
    assert.ok(out.endsWith('recap text\n'));
  } finally { t.cleanup(); }
});

test('custom templates, separator and 12h clock reach the status line', () => {
  const { t, proj } = twoAccounts();
  try {
    const raw = JSON.parse(fs.readFileSync(t.p.configFile, 'utf8'));
    raw.display = {
      line1: '{model}{sep}{dir.name}{sep}{nope}',
      label: '{label}: ',
      account: '{5h}[ ({5h.reset})]{sep}[{status}]{sep}[{age}]',
      separator: ' | ',
      clock: '12h',
    };
    writeJson(t.p.configFile, raw);
    const out = stripAnsi(render.render(payload(proj), { env: t.env, now: NOW, spawn: () => {} })).trimEnd().split('\n');
    assert.equal(out[0], 'claude-opus-5-5 | proj | {nope}');
    assert.match(out[1], /^A: 52% \(\d{1,2}:\d\d[ap]m\)$/);
    assert.match(out[2], /^B: 29% \(\d{1,2}:\d\d[ap]m\) \| \(3m ago\)$/);
  } finally { t.cleanup(); }
});

test('F2: a blank line 1 falls back to the default template, and empty account lines are dropped', () => {
  const t = tmpEnv();
  try {
    addCreds(t.p.claudeDir);
    writeJson(t.p.configFile, { display: { line1: '[ctx: {ctx}]', account: '[5h: {5h}]' } });
    const p1 = { workspace: { current_dir: t.home }, rate_limits: { spend_limit: { used_percentage: 64, resets_at: NOW_S + 2 * 86400 } } };
    const out = stripAnsi(render.render(p1, { env: t.env, now: NOW, spawn: () => {} }));
    const outLines = out.trimEnd().split('\n');

    const L = require('../src/lines');
    const F = require('../src/format');
    const git = require('../src/git');
    const defStyle = F.makeStyle(L.defaultDisplay(), t.env);
    const v1 = L.line1({}, t.home, t.p.home, git.branch(t.home), defStyle);
    const expectedLine1 = L.drawLine(L.defaultDisplay().templates.line1, v1, defStyle, L.defaultDisplay().separator);
    assert.equal(outLines[0], stripAnsi(expectedLine1));
    assert.ok(!out.split('\n').slice(0, -1).includes(''));
  } finally { t.cleanup(); }
});

test('a hand-broken template draws the default line with a hint; NO_COLOR drops colour', () => {
  const { t, proj } = twoAccounts();
  try {
    const raw = JSON.parse(fs.readFileSync(t.p.configFile, 'utf8'));
    raw.display = { line1: '{dir' };
    writeJson(t.p.configFile, raw);
    const env = Object.assign({}, t.env, { NO_COLOR: '1' });
    const out = render.render(payload(proj), { env, now: NOW, spawn: () => {} });
    assert.equal(out.split('\n')[0], 'dir:~/proj · model:Opus 5.5 · effort:high · ctx: 12% · session:340.0ktk  (template error: /sline:doctor)');
    assert.ok(!/\x1b/.test(out));
  } finally { t.cleanup(); }
});
