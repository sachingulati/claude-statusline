'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const { tmpEnv, writeCache } = require('./helpers');
const cache = require('../src/cache');
const refresh = require('../src/refresh');

const FAKE = path.join(__dirname, 'fixtures', 'fake-claude.js');
const REFRESH_JS = path.join(__dirname, '..', 'src', 'refresh.js');

function setup(mode) {
  const t = tmpEnv();
  const log = path.join(t.base, 'fake.json');
  const loginDir = path.join(t.home, '.creds-b');
  const env = Object.assign({}, process.env, t.env, {
    CLAUDE_SLINE_CLAUDE: FAKE, FAKE_CLAUDE_MODE: mode, FAKE_CLAUDE_LOG: log,
    FAKE_CLAUDE_RACE_FILE: cache.file(t.p, 'B'), CLAUDECODE: '1',
  });
  delete env.CLAUDE_SLINE_HOME; // state must follow the temp CLAUDE_CONFIG_DIR
  delete env.CLAUDE_SECURESTORAGE_CONFIG_DIR;
  const started = () => (fs.existsSync(log) ? JSON.parse(fs.readFileSync(log, 'utf8')) : null);
  return { t, env, loginDir, started };
}

const lockDir = t => path.join(t.p.cacheDir, 'B.lock');

test('numbers become the record and an ok attempt; Claude Code runs as that account', () => {
  const { t, env, loginDir, started } = setup('ok');
  try {
    const before = Math.floor(Date.now() / 1000);
    assert.equal(refresh.run('B', loginDir, env), 'ok');
    const rec = cache.read(t.p, 'B');
    assert.deepEqual([rec.key, rec.status], ['B', 'ok']);
    assert.ok(rec.fetched_at >= before);
    assert.deepEqual(rec.five_hour, { utilization: 5, resets_at: Date.UTC(2026, 8, 30, 21, 30) / 1000 });
    assert.deepEqual(rec.seven_day, { utilization: 45, resets_at: Date.UTC(2026, 9, 5, 18) / 1000 });
    assert.equal(cache.readAttempt(t.p, 'B').ok, true);
    const s = started();
    assert.deepEqual(s.args, ['-p', '/usage', '--no-session-persistence', '--output-format', 'stream-json', '--verbose']);
    assert.equal(s.configDir, cache.accountDir(t.p, 'B'));
    assert.equal(s.loginDir, loginDir);
    assert.equal(s.claudecode, false);
    assert.equal(s.configDirExists, true);
    assert.equal(fs.existsSync(lockDir(t)), false);
  } finally { t.cleanup(); }
});

test('Claude Code starts in the account folder, not the session project, so project hooks stay out', () => {
  const { t, env, loginDir, started } = setup('ok');
  try {
    assert.equal(refresh.run('B', loginDir, env), 'ok');
    assert.equal(path.resolve(started().cwd), path.resolve(cache.accountDir(t.p, 'B')));
  } finally { t.cleanup(); }
});

test('login overrides in the session environment are not passed on: the account uses its own login', () => {
  const { t, env, loginDir, started } = setup('ok');
  try {
    Object.assign(env, { ANTHROPIC_API_KEY: 'k', ANTHROPIC_AUTH_TOKEN: 't', CLAUDE_CODE_OAUTH_TOKEN: 'o',
      CLAUDE_CODE_USE_BEDROCK: '1', CLAUDE_CODE_USE_VERTEX: '1' });
    assert.equal(refresh.run('B', loginDir, env), 'ok');
    assert.deepEqual(started().loginOverrides, []);
  } finally { t.cleanup(); }
});

test('a runner that gets the lock after another just finished does not run Claude Code again', () => {
  const { t, env, loginDir, started } = setup('ok');
  try {
    assert.equal(refresh.run('B', loginDir, env), 'ok');
    fs.rmSync(env.FAKE_CLAUDE_LOG);
    assert.equal(refresh.run('B', loginDir, env), 'fresh');
    assert.equal(started(), null);
  } finally { t.cleanup(); }
});

test('the cost view (no login, rate limited) leaves the record and fails the attempt', () => {
  const { t, env, loginDir } = setup('cost');
  try {
    writeCache(t.p, 'B', { status: 'ok', fetched_at: 1000, five_hour: { utilization: 9, resets_at: null }, seven_day: null });
    assert.equal(refresh.run('B', loginDir, env), 'nodata');
    assert.equal(cache.read(t.p, 'B').fetched_at, 1000);
    assert.equal(cache.readAttempt(t.p, 'B').ok, false);
    assert.equal(fs.existsSync(lockDir(t)), false);
  } finally { t.cleanup(); }
});

test('a hanging Claude Code is stopped at the timeout: failed attempt, lock released', () => {
  const { t, env, loginDir } = setup('hang');
  try {
    const t0 = Date.now();
    assert.equal(refresh.run('B', loginDir, env, { timeoutMs: 1000 }), 'nodata');
    assert.ok(Date.now() - t0 < 10000);
    assert.equal(cache.read(t.p, 'B'), null);
    assert.equal(cache.readAttempt(t.p, 'B').ok, false);
    assert.equal(fs.existsSync(lockDir(t)), false);
  } finally { t.cleanup(); }
});

test('a record a session wrote during the check wins; the attempt still counts as ok', () => {
  const { t, env, loginDir } = setup('race');
  try {
    assert.equal(refresh.run('B', loginDir, env), 'ok');
    assert.equal(cache.read(t.p, 'B').five_hour.utilization, 77);
    assert.equal(cache.readAttempt(t.p, 'B').ok, true);
  } finally { t.cleanup(); }
});

test('a held lock: nothing started, nothing written; a stale lock is taken over', () => {
  const { t, env, loginDir, started } = setup('ok');
  try {
    fs.mkdirSync(lockDir(t), { recursive: true });
    assert.equal(refresh.run('B', loginDir, env), 'locked');
    assert.equal(started(), null);
    assert.equal(cache.readAttempt(t.p, 'B'), null);
    const old = new Date(Date.now() - (refresh.LOCK_STALE + 5) * 1000);
    fs.utimesSync(lockDir(t), old, old);
    assert.equal(refresh.run('B', loginDir, env), 'ok');
  } finally { t.cleanup(); }
});

test('no Claude Code on PATH: failed attempt, nothing started', () => {
  const { t, env, loginDir } = setup('ok');
  try {
    delete env.CLAUDE_SLINE_CLAUDE;
    env.PATH = t.home; delete env.Path;
    assert.equal(refresh.run('B', loginDir, env), 'noclaude');
    assert.deepEqual(Object.keys(cache.readAttempt(t.p, 'B')).sort(), ['at', 'ok']);
    assert.equal(cache.readAttempt(t.p, 'B').ok, false);
  } finally { t.cleanup(); }
});

test('run as a script, the way spawnFetch starts it; ~ in the login folder expands', () => {
  const { t, env, started } = setup('ok');
  try {
    cp.execFileSync(process.execPath, [REFRESH_JS, 'B', '~/.creds-b'], { env });
    assert.equal(cache.read(t.p, 'B').five_hour.utilization, 5);
    assert.equal(started().loginDir, path.join(t.home, '.creds-b'));
  } finally { t.cleanup(); }
});

test('spawnFetch starts the runner detached and returns at once', () => {
  const { t, env } = setup('ok');
  try {
    cache.spawnFetch({ key: 'B', dir: path.join(t.home, '.creds-b') }, env);
    // Wait for the runner to finish (attempt ok, lock gone) so cleanup doesn't race it.
    const done = () => (cache.readAttempt(t.p, 'B') || {}).ok === true && !fs.existsSync(lockDir(t));
    const until = Date.now() + 15000;
    while (!done() && Date.now() < until) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    assert.equal(cache.read(t.p, 'B').five_hour.utilization, 5);
  } finally { t.cleanup(); }
});
