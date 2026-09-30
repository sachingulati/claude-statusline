'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { tmpEnv, writeJson, writeCache } = require('./helpers');
const cache = require('../src/cache');
const doctor = require('../src/doctor');
const settings = require('../src/settings');
const launcher = require('../src/launcher');

const NOW = Date.UTC(2026, 8, 29, 12);

function byId(checks, id) { return checks.find(c => c.id === id); }

test('fresh machine: statusLine missing is a fail with the init fix', () => {
  const t = tmpEnv();
  try {
    const c = doctor.doctor(t.p, t.env, { cwd: t.home, now: NOW, platform: 'linux' });
    assert.equal(byId(c, 'node').level, 'ok');
    assert.equal(byId(c, 'statusLine').level, 'fail');
    assert.match(byId(c, 'statusLine').fix, /sline:init/);
    assert.equal(byId(c, 'launcher').level, 'fail');
  } finally { t.cleanup(); }
});

test('installed machine: everything ok, cache and hidden reported', () => {
  const t = tmpEnv();
  try {
    launcher.sync(t.p);
    settings.install(t.p);
    writeCache(t.p, 'default', { status: 'ok', fetched_at: NOW / 1000 - 60, five_hour: { utilization: 1, resets_at: null } });
    const c = doctor.doctor(t.p, t.env, { cwd: t.home, now: NOW, platform: 'linux' });
    for (const id of ['node', 'statusLine', 'refreshInterval', 'subagentStatusLine', 'launcher', 'root', 'config', 'usage:default']) {
      assert.equal(byId(c, id).level, 'ok', id + ': ' + byId(c, id).message);
    }
    assert.equal(byId(c, 'shadow'), undefined); // cwd = home: user settings are not a shadow
    assert.equal(byId(c, 'claude'), undefined); // one account: nothing to check
    assert.equal(byId(c, 'hidden').level, 'info');
  } finally { t.cleanup(); }
});

test('shadowing; when each account last recorded; failed checks; finding Claude Code', () => {
  const t = tmpEnv();
  try {
    const bDir = path.join(t.home, '.creds-b');
    const bin = path.join(t.home, 'bin');
    fs.mkdirSync(bin);
    const env = Object.assign({}, t.env, { PATH: bin });
    writeJson(t.p.configFile, { accounts: [{ label: 'A', credsDir: t.p.claudeDir }, { label: 'B', credsDir: bDir }] });
    writeCache(t.p, 'A', { status: 'auth', fetched_at: NOW / 1000 - 7200, five_hour: { utilization: 3, resets_at: null } });
    cache.writeAttempt(t.p, 'B', { at: NOW / 1000 - 1800, ok: false });
    const proj = path.join(t.home, 'proj');
    writeJson(path.join(proj, '.claude', 'settings.local.json'), { statusLine: { type: 'command', command: 'x' } });
    const run = () => doctor.doctor(t.p, env, { cwd: proj, now: NOW, platform: 'darwin' });

    let c = run();
    assert.equal(byId(c, 'shadow').level, 'warn');
    assert.equal(byId(c, 'usage:A').level, 'ok');
    assert.match(byId(c, 'usage:A').message, /last recorded 2h0m ago/);
    assert.equal(byId(c, 'usage:B').level, 'info');
    assert.match(byId(c, 'usage:B').fix, /session as this account/);
    assert.match(byId(c, 'fetch:B').message, /last background check failed 30m ago; it retries hourly/);
    assert.equal(byId(c, 'fetch:A'), undefined);
    assert.equal(byId(c, 'claude').level, 'warn');
    assert.match(byId(c, 'claude').message, /not found on PATH/);
    assert.equal(c.some(x => /^(macos|creds:|token:|cache:)/.test(x.id)), false);

    fs.writeFileSync(path.join(bin, 'claude'), '');
    c = run();
    assert.equal(byId(c, 'claude').level, 'ok');
    assert.equal(byId(c, 'claude').message, 'Claude Code found: ' + path.join(bin, 'claude'));

    writeJson(t.p.configFile, { accounts: [{ label: 'A', credsDir: t.p.claudeDir }, { label: 'B', credsDir: bDir }], fetch: { otherAccounts: false } });
    c = run();
    assert.equal(byId(c, 'claude'), undefined);
    assert.equal(byId(c, 'fetch:B'), undefined);
  } finally { t.cleanup(); }
});

test('broken config.json and settings.json are reported, not thrown', () => {
  const t = tmpEnv();
  try {
    fs.mkdirSync(t.p.stateDir, { recursive: true });
    fs.writeFileSync(t.p.configFile, '{ bad');
    fs.writeFileSync(t.p.settingsFile, '{ bad');
    const c = doctor.doctor(t.p, t.env, { cwd: t.home, now: NOW, platform: 'linux' });
    assert.equal(byId(c, 'config').level, 'fail');
    assert.equal(byId(c, 'settings').level, 'fail');
    assert.equal(byId(c, 'display'), undefined);
  } finally { t.cleanup(); }
});

test('display: ok when valid; a warning with position and fix for each problem', () => {
  const t = tmpEnv();
  try {
    assert.equal(byId(doctor.doctor(t.p, t.env, { cwd: t.home, now: NOW, platform: 'linux' }), 'display').level, 'ok');
    writeJson(t.p.configFile, { display: { line1: '{dir}[', colors: { high: 'purple' } } });
    const w = doctor.doctor(t.p, t.env, { cwd: t.home, now: NOW, platform: 'linux' }).filter(c => c.id === 'display');
    assert.equal(w.length, 2);
    assert.ok(w.every(c => c.level === 'warn' && c.fix));
    assert.match(w[0].message, /display\.line1: Unclosed "\[" at column 6/);
  } finally { t.cleanup(); }
});

test('subagentStatusLine: not set up, or running something else, is a warning', () => {
  const t = tmpEnv();
  try {
    launcher.sync(t.p);
    writeJson(t.p.settingsFile, { statusLine: { type: 'command', command: settings.command(t.p), refreshInterval: 30 } });
    let c = byId(doctor.doctor(t.p, t.env, { cwd: t.home, now: NOW, platform: 'linux' }), 'subagentStatusLine');
    assert.equal(c.level, 'warn');
    assert.match(c.message, /not set up/);
    assert.match(c.fix, /sline:init/);

    writeJson(t.p.settingsFile, {
      statusLine: { type: 'command', command: settings.command(t.p), refreshInterval: 30 },
      subagentStatusLine: { type: 'command', command: 'bash my-rows.sh' },
    });
    c = byId(doctor.doctor(t.p, t.env, { cwd: t.home, now: NOW, platform: 'linux' }), 'subagentStatusLine');
    assert.equal(c.level, 'warn');
    assert.match(c.message, /runs something else: bash my-rows\.sh/);
  } finally { t.cleanup(); }
});
