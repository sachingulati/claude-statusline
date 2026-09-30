'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { tmpEnv, addCreds, writeJson, writeCache } = require('./helpers');
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
    addCreds(t.p.claudeDir);
    launcher.sync(t.p);
    settings.install(t.p);
    writeCache(t.p, 'default', { status: 'ok', fetched_at: NOW / 1000 - 60, five_hour: { utilization: 1, resets_at: null } });
    const c = doctor.doctor(t.p, t.env, { cwd: t.home, now: NOW, platform: 'linux' });
    for (const id of ['node', 'statusLine', 'refreshInterval', 'subagentStatusLine', 'launcher', 'root', 'config', 'cache:default']) {
      assert.equal(byId(c, id).level, 'ok', id + ': ' + byId(c, id).message);
    }
    assert.equal(byId(c, 'shadow'), undefined); // cwd = home: user settings are not a shadow
    assert.equal(byId(c, 'hidden').level, 'info');
  } finally { t.cleanup(); }
});

test('project statusLine shadowing, failing cache, missing creds, macOS note', () => {
  const t = tmpEnv();
  try {
    const bDir = path.join(t.home, '.creds-b');
    writeJson(t.p.configFile, { accounts: [{ label: 'A', credsDir: t.p.claudeDir }, { label: 'B', credsDir: bDir }] });
    addCreds(t.p.claudeDir);
    writeCache(t.p, 'A', { status: 'auth', fetched_at: NOW / 1000 - 7200 });
    const proj = path.join(t.home, 'proj');
    writeJson(path.join(proj, '.claude', 'settings.local.json'), { statusLine: { type: 'command', command: 'x' } });
    const c = doctor.doctor(t.p, t.env, { cwd: proj, now: NOW, platform: 'darwin' });
    assert.equal(byId(c, 'shadow').level, 'warn');
    assert.equal(byId(c, 'cache:A').level, 'warn');
    assert.match(byId(c, 'cache:A').fix, /login/);
    assert.equal(byId(c, 'creds:B').level, 'warn');
    assert.equal(byId(c, 'macos').level, 'warn');
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
