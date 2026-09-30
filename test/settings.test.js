'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { tmpEnv, writeJson } = require('./helpers');
const settings = require('../src/settings');
const paths = require('../src/paths');
const { UserError } = require('../src/fsutil');

const OLD = { type: 'command', command: 'bash "/old/statusline-command.sh"' };

function readSettings(t) { return JSON.parse(fs.readFileSync(t.p.settingsFile, 'utf8')); }
function backups(t) { return fs.readdirSync(t.p.claudeDir).filter(f => f.startsWith('settings.json.bak.')); }

test('command uses forward slashes and quotes, even with spaces', () => {
  const p = paths.resolve({ HOME: 'C:\\Users\\John Smith' });
  assert.equal(settings.command(p), 'node "C:/Users/John Smith/.claude/sline/launch.js"');
});

test('install records the previous statusLine once, backs up, keeps other keys and padding', () => {
  const t = tmpEnv();
  try {
    writeJson(t.p.settingsFile, { theme: 'dark', statusLine: Object.assign({ padding: 2 }, OLD) });
    const r = settings.install(t.p);
    assert.equal(r.changed, true);
    assert.equal(r.recorded, true);
    const s = readSettings(t);
    assert.equal(s.theme, 'dark');
    assert.deepEqual(s.statusLine, { type: 'command', command: settings.command(t.p), refreshInterval: 30, padding: 2 });
    assert.deepEqual(JSON.parse(fs.readFileSync(t.p.installFile, 'utf8')).previousStatusLine, Object.assign({ padding: 2 }, OLD));
    assert.equal(backups(t).length, 1);

    const again = settings.install(t.p);
    assert.equal(again.changed, false);
    assert.equal(again.recorded, false);
    assert.equal(backups(t).length, 1);
  } finally { t.cleanup(); }
});

test('install creates settings.json when there is none', () => {
  const t = tmpEnv();
  try {
    settings.install(t.p, { refreshInterval: 10 });
    assert.equal(readSettings(t).statusLine.refreshInterval, 10);
    assert.equal(JSON.parse(fs.readFileSync(t.p.installFile, 'utf8')).previousStatusLine, null);
  } finally { t.cleanup(); }
});

test('re-init when settings already runs our launcher but install.json is gone records null', () => {
  const t = tmpEnv();
  try {
    writeJson(t.p.settingsFile, { statusLine: { type: 'command', command: settings.command(t.p), refreshInterval: 45 } });
    const r = settings.install(t.p);
    assert.equal(JSON.parse(fs.readFileSync(t.p.installFile, 'utf8')).previousStatusLine, null);
    assert.equal(r.statusLine.refreshInterval, 45); // keeps the user's interval
  } finally { t.cleanup(); }
});

test('invalid settings.json is refused and left untouched', () => {
  const t = tmpEnv();
  try {
    fs.writeFileSync(t.p.settingsFile, '{ // comment\n "theme": "dark" }');
    assert.throws(() => settings.install(t.p), UserError);
    assert.equal(fs.readFileSync(t.p.settingsFile, 'utf8'), '{ // comment\n "theme": "dark" }');
    assert.equal(fs.existsSync(t.p.installFile), false);
  } finally { t.cleanup(); }
});

test('setRefreshInterval validates and needs an install', () => {
  const t = tmpEnv();
  try {
    assert.throws(() => settings.setRefreshInterval(t.p, 30), /not set up/);
    settings.install(t.p);
    assert.throws(() => settings.setRefreshInterval(t.p, 2), />= 5/);
    assert.equal(settings.setRefreshInterval(t.p, '60').changed, true);
    assert.equal(readSettings(t).statusLine.refreshInterval, 60);
  } finally { t.cleanup(); }
});

test('restore puts back the previous statusLine, or removes the key', () => {
  const t = tmpEnv();
  try {
    writeJson(t.p.settingsFile, { statusLine: OLD });
    settings.install(t.p);
    assert.deepEqual(settings.restore(t.p).restored, OLD);
    assert.deepEqual(readSettings(t).statusLine, OLD);
  } finally { t.cleanup(); }
  const t2 = tmpEnv();
  try {
    settings.install(t2.p);
    settings.restore(t2.p);
    assert.equal('statusLine' in readSettings(t2), false);
  } finally { t2.cleanup(); }
});

test('restore leaves a statusLine the user changed since', () => {
  const t = tmpEnv();
  try {
    settings.install(t.p);
    const mine = { type: 'command', command: 'my-own' };
    const s = readSettings(t);
    s.statusLine = mine;
    writeJson(t.p.settingsFile, s);
    assert.equal(settings.restore(t.p).leftAlone, true);
    assert.deepEqual(readSettings(t).statusLine, mine);
  } finally { t.cleanup(); }
});

test('restore without an install is a user error', () => {
  const t = tmpEnv();
  try { assert.throws(() => settings.restore(t.p), /not installed/); } finally { t.cleanup(); }
});

const THEIRS = { type: 'command', command: 'bash "/my/rows.sh"' };
function install(t) { return JSON.parse(fs.readFileSync(t.p.installFile, 'utf8')); }
function oursSub(t) { return { type: 'command', command: settings.command(t.p) + ' subagents' }; }

test('subagentCommand and isOursSubagent', () => {
  const p = paths.resolve({ HOME: 'C:\\Users\\John Smith' });
  assert.equal(settings.subagentCommand(p), 'node "C:/Users/John Smith/.claude/sline/launch.js" subagents');
  assert.equal(settings.isOursSubagent({ type: 'command', command: settings.subagentCommand(p) }, p), true);
  assert.equal(settings.isOursSubagent({ type: 'command', command: settings.command(p) }, p), false);
  assert.equal(settings.isOursSubagent(THEIRS, p), false);
  assert.equal(settings.isOursSubagent(undefined, p), false);
});

test('install sets subagentStatusLine, recording one that is not ours', () => {
  const t = tmpEnv();
  try {
    writeJson(t.p.settingsFile, { subagentStatusLine: THEIRS });
    const r = settings.install(t.p);
    assert.deepEqual(readSettings(t).subagentStatusLine, oursSub(t));
    assert.deepEqual(r.subagentStatusLine, oursSub(t));
    assert.deepEqual(install(t).previousSubagentStatusLine, THEIRS);
    assert.equal(backups(t).length, 1); // one write for both keys
    assert.equal(settings.install(t.p).changed, false);
  } finally { t.cleanup(); }
});

test('init on an install.json from before subagent rows adds the key and keeps the rest', () => {
  const t = tmpEnv();
  try {
    writeJson(t.p.installFile, { previousStatusLine: OLD, installedAt: '2026-09-29T00:00:00.000Z' });
    writeJson(t.p.settingsFile, { statusLine: { type: 'command', command: settings.command(t.p), refreshInterval: 30 } });
    const r = settings.install(t.p);
    assert.equal(r.recorded, true);
    assert.equal(r.changed, true);
    assert.deepEqual(install(t), { previousStatusLine: OLD, installedAt: '2026-09-29T00:00:00.000Z', previousSubagentStatusLine: null });
    assert.equal(settings.install(t.p).recorded, false);
  } finally { t.cleanup(); }
});

test('an unreadable install.json is left alone by install', () => {
  const t = tmpEnv();
  try {
    fs.mkdirSync(t.p.stateDir, { recursive: true });
    fs.writeFileSync(t.p.installFile, '{ broken');
    assert.equal(settings.install(t.p).recorded, false);
    assert.equal(fs.readFileSync(t.p.installFile, 'utf8'), '{ broken');
  } finally { t.cleanup(); }
});

test('restore puts back the previous subagentStatusLine, or removes the key, in the same write', () => {
  const t = tmpEnv();
  try {
    writeJson(t.p.settingsFile, { statusLine: OLD, subagentStatusLine: THEIRS });
    settings.install(t.p);
    const before = backups(t).length;
    const r = settings.restore(t.p);
    assert.deepEqual(r.subagentRestored, THEIRS);
    assert.equal(r.subagentLeftAlone, false);
    assert.deepEqual(readSettings(t).subagentStatusLine, THEIRS);
    assert.equal(backups(t).length, before + 1);
  } finally { t.cleanup(); }
  const t2 = tmpEnv();
  try {
    settings.install(t2.p);
    settings.restore(t2.p);
    assert.equal('subagentStatusLine' in readSettings(t2), false);
  } finally { t2.cleanup(); }
});

test('restore leaves a subagentStatusLine the user changed since', () => {
  const t = tmpEnv();
  try {
    settings.install(t.p);
    const s = readSettings(t);
    s.subagentStatusLine = THEIRS;
    writeJson(t.p.settingsFile, s);
    const r = settings.restore(t.p);
    assert.equal(r.subagentLeftAlone, true);
    assert.equal(r.leftAlone, false);
    assert.deepEqual(readSettings(t).subagentStatusLine, THEIRS);
    assert.equal('statusLine' in readSettings(t), false);
  } finally { t.cleanup(); }
});

test('restore with an install.json from before subagent rows', () => {
  const t = tmpEnv();
  try {
    writeJson(t.p.installFile, { previousStatusLine: null, installedAt: '2026-09-29T00:00:00.000Z' });
    writeJson(t.p.settingsFile, { statusLine: { type: 'command', command: settings.command(t.p) }, subagentStatusLine: oursSub(t) });
    settings.restore(t.p);
    assert.deepEqual(readSettings(t), {});
  } finally { t.cleanup(); }
  const t2 = tmpEnv();
  try {
    writeJson(t2.p.installFile, { previousStatusLine: null, installedAt: '2026-09-29T00:00:00.000Z' });
    writeJson(t2.p.settingsFile, { statusLine: { type: 'command', command: settings.command(t2.p) }, subagentStatusLine: THEIRS });
    // init never set it, so it wasn't "changed since init": nothing to report, nothing touched
    assert.equal(settings.restore(t2.p).subagentLeftAlone, false);
    assert.deepEqual(readSettings(t2), { subagentStatusLine: THEIRS });
  } finally { t2.cleanup(); }
});

test('re-running init records a value set since the last init, so uninstall puts it back', () => {
  const t = tmpEnv();
  try {
    writeJson(t.p.settingsFile, { statusLine: OLD });
    settings.install(t.p);
    const s = readSettings(t);
    s.statusLine = { type: 'command', command: 'bash "/newer/line.sh"' };
    s.subagentStatusLine = THEIRS;
    writeJson(t.p.settingsFile, s);
    assert.equal(settings.install(t.p).recorded, true);
    assert.deepEqual(install(t).previousStatusLine, { type: 'command', command: 'bash "/newer/line.sh"' });
    assert.deepEqual(install(t).previousSubagentStatusLine, THEIRS);
    assert.equal(settings.install(t.p).recorded, false); // ours again: nothing new to record
    settings.restore(t.p);
    assert.deepEqual(readSettings(t), { statusLine: { type: 'command', command: 'bash "/newer/line.sh"' }, subagentStatusLine: THEIRS });
  } finally { t.cleanup(); }
});

test('restore without install.json still removes our entries', () => {
  const t = tmpEnv();
  try {
    settings.install(t.p);
    fs.unlinkSync(t.p.installFile);
    const r = settings.restore(t.p);
    assert.equal(r.restored, null);
    const s = readSettings(t);
    assert.equal('statusLine' in s, false);
    assert.equal('subagentStatusLine' in s, false);
  } finally { t.cleanup(); }
});

test('settings.json holding null or an array is left untouched', () => {
  const t = tmpEnv();
  try {
    ['null', '[]'].forEach(function (text) {
      fs.writeFileSync(t.p.settingsFile, text);
      assert.throws(() => settings.install(t.p), /JSON object/);
      assert.equal(fs.readFileSync(t.p.settingsFile, 'utf8'), text);
    });
  } finally { t.cleanup(); }
});
