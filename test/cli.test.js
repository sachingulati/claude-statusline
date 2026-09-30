'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const { tmpEnv, writeJson, childEnv } = require('./helpers');

const CLI = path.join(__dirname, '..', 'cli', 'sl.js');

function sl(t, args, opts) {
  opts = opts || {};
  const env = childEnv(t, opts.env);
  const r = cp.spawnSync(process.execPath, [CLI].concat(args), { env, cwd: opts.cwd || t.home, input: opts.input || '', encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr, json: args.includes('--json') ? JSON.parse(r.stdout) : null };
}

test('init wires settings.json, launcher and root; second run changes nothing', () => {
  const t = tmpEnv();
  try {
    const r = sl(t, ['init', '--json']);
    assert.equal(r.code, 0);
    assert.equal(r.json.ok, true);
    assert.equal(r.json.result.settingsChanged, true);
    assert.equal(r.json.result.hasConfig, false);
    assert.ok(fs.existsSync(t.p.launcher));
    assert.equal(JSON.parse(fs.readFileSync(t.p.settingsFile, 'utf8')).statusLine.refreshInterval, 30);
    assert.equal(sl(t, ['init', '--json']).json.result.settingsChanged, false);
  } finally { t.cleanup(); }
});

test('init --refresh sets the interval; a bad value is exit 1 with a fix', () => {
  const t = tmpEnv();
  try {
    assert.equal(sl(t, ['init', '--refresh', '15', '--json']).json.result.statusLine.refreshInterval, 15);
    const bad = sl(t, ['init', '--refresh', '1', '--json']);
    assert.equal(bad.code, 1);
    assert.equal(bad.json.ok, false);
    assert.match(bad.json.error, />= 5/);
  } finally { t.cleanup(); }
});

test('usage: bare reports, explicit actions set state, twice is the same as once', () => {
  const t = tmpEnv();
  try {
    const state = args => sl(t, ['usage'].concat(args, ['--json'])).json.result;
    assert.deepEqual(state([]), { usage: 'visible', accounts: 'all' });
    assert.equal(fs.existsSync(t.p.stateDir), false); // bare changes nothing

    assert.deepEqual(state(['hide']), { usage: 'hidden', accounts: 'all' });
    assert.ok(fs.existsSync(t.p.hiddenFlag));
    assert.deepEqual(state(['hide']), { usage: 'hidden', accounts: 'all' }); // no toggle back

    assert.deepEqual(state(['active']), { usage: 'hidden', accounts: 'active' });
    assert.equal(JSON.parse(fs.readFileSync(t.p.configFile, 'utf8')).display.otherAccounts, false);
    assert.deepEqual(state(['show']), { usage: 'visible', accounts: 'active' }); // independent settings
    assert.deepEqual(state(['all']), { usage: 'visible', accounts: 'all' });

    state(['hide']);
    state(['active']);
    assert.deepEqual(state(['reset']), { usage: 'visible', accounts: 'all' });
    assert.equal(fs.existsSync(t.p.hiddenFlag), false);

    const bad = sl(t, ['usage', 'bogus', '--json']);
    assert.equal(bad.code, 1);
    assert.match(bad.json.fix, /hide\|show\|active\|all\|reset/);
  } finally { t.cleanup(); }
});

test('config show/set/account and refreshInterval', () => {
  const t = tmpEnv();
  try {
    sl(t, ['init']);
    assert.equal(sl(t, ['config', 'set', 'hidden.marker', 'numbers', 'off', '--json']).json.result.value, 'numbers off');
    assert.equal(sl(t, ['config', 'set', 'refreshInterval', '60', '--json']).json.result.refreshInterval, 60);
    sl(t, ['config', 'account', 'add', 'A', '~/.claude']);
    const add = sl(t, ['config', 'account', 'add', 'B', '~/.creds-b', '--json']);
    assert.match(add.json.result.warning, /first Claude Code session/);
    assert.equal(sl(t, ['config', 'set', 'fetch.otherAccounts', 'false', '--json']).json.result.value, false);
    const show = sl(t, ['config', 'show', '--json']).json.result;
    assert.deepEqual(show.rows.find(r => r.key === 'refreshInterval'), { key: 'refreshInterval', value: 60, origin: 'settings.json' });
    assert.deepEqual(show.accounts.map(a => a.label), ['A', 'B']);
    assert.equal(sl(t, ['config', 'account', 'rename', 'B', 'Work', '--json']).json.result.newLabel, 'Work');
    assert.equal(sl(t, ['config', 'account', 'forget', 'Work', '--json']).code, 0);
    assert.deepEqual(sl(t, ['config', 'account', 'list', '--json']).json.result.map(a => a.label), ['A']);
    assert.deepEqual(JSON.parse(fs.readFileSync(t.p.configFile, 'utf8')).ignoredDirs, ['~/.creds-b']); // render won't re-add it
    assert.equal(sl(t, ['config', 'set', 'nope', '1', '--json']).code, 1);
  } finally { t.cleanup(); }
});

test('quota and doctor return JSON; doctor exits 1 when something fails', () => {
  const t = tmpEnv();
  try {
    assert.equal(sl(t, ['quota', '--json']).json.ok, true);
    const d = sl(t, ['doctor', '--json']);
    assert.equal(d.code, 1);
    assert.ok(d.json.result.checks.some(c => c.id === 'statusLine' && c.level === 'fail'));
  } finally { t.cleanup(); }
});

test('uninstall restores settings and removes the launcher; --purge removes state', () => {
  const t = tmpEnv();
  try {
    writeJson(t.p.settingsFile, { statusLine: { type: 'command', command: 'old' } });
    sl(t, ['init']);
    sl(t, ['config', 'set', 'hidden.marker', 'x']);
    const r = sl(t, ['uninstall', '--json']);
    assert.equal(r.code, 0);
    assert.deepEqual(JSON.parse(fs.readFileSync(t.p.settingsFile, 'utf8')).statusLine, { type: 'command', command: 'old' });
    assert.equal(fs.existsSync(t.p.launcher), false);
    assert.equal(fs.existsSync(t.p.configFile), true);
    sl(t, ['init']);
    sl(t, ['uninstall', '--purge']);
    assert.equal(fs.existsSync(t.p.stateDir), false);
  } finally { t.cleanup(); }
});

test('config: display values pass through as one argument; samples; reset display', () => {
  const t = tmpEnv();
  try {
    const tpl = '\\[{label}\\] ';
    const r = sl(t, ['config', 'set', 'display.label', tpl, '--json']);
    assert.equal(r.code, 0);
    assert.equal(r.json.result.value, tpl);
    assert.equal(r.json.result.sample.length, 4);
    assert.match(r.json.result.sample[1], /^\[A\] 5h: 52%/);
    assert.equal(sl(t, ['config', 'set', 'display.separator', ' · ', '--json']).json.result.value, ' · ');
    assert.equal(JSON.parse(fs.readFileSync(t.p.configFile, 'utf8')).display.label, tpl);

    const bad = sl(t, ['config', 'set', 'display.line1', '{dir', '--json']);
    assert.equal(bad.code, 1);
    assert.match(bad.json.error, /Unclosed "\{" at column 1/);
    assert.ok(bad.json.fix);

    sl(t, ['config', 'set', 'display.clock', '12h']);
    const reset = sl(t, ['config', 'reset', 'display', '--json']);
    assert.equal(reset.code, 0);
    assert.equal(reset.json.result.sample.length, 4);
    assert.equal(JSON.parse(fs.readFileSync(t.p.configFile, 'utf8')).display, undefined);
    assert.match(sl(t, ['config', 'show']).out, /Sample\n.*dir:~\/projects\/app/);
    assert.equal(sl(t, ['config', 'reset', 'nope', '--json']).code, 1);
  } finally { t.cleanup(); }
});

test('config set --stdin: Git Bash-hostile values (leading "/", quotes, \\r\\n) pass through exactly', () => {
  const t = tmpEnv();
  try {
    sl(t, ['init']);
    const sep = sl(t, ['config', 'set', 'display.separator', '--stdin', '--json'], { input: ' / \n' });
    assert.equal(sep.code, 0);
    assert.equal(sep.json.result.value, ' / ');
    assert.equal(JSON.parse(fs.readFileSync(t.p.configFile, 'utf8')).display.separator, ' / ');

    const line1 = sl(t, ['config', 'set', 'display.line1', '--stdin', '--json'], { input: '/{dir}{sep}{model}\n' });
    assert.equal(line1.code, 0);
    assert.equal(line1.json.result.value, '/{dir}{sep}{model}');
    assert.equal(JSON.parse(fs.readFileSync(t.p.configFile, 'utf8')).display.line1, '/{dir}{sep}{model}');

    const marker = sl(t, ['config', 'set', 'hidden.marker', '--stdin', '--json'], { input: "x'y\r\n" });
    assert.equal(marker.code, 0);
    assert.equal(marker.json.result.value, "x'y");
    assert.equal(JSON.parse(fs.readFileSync(t.p.configFile, 'utf8')).hidden.marker, "x'y");

    // The positional form still works, and an empty value after stripping is still refused.
    assert.equal(sl(t, ['config', 'set', 'hidden.marker', 'plain', '--json']).json.result.value, 'plain');
    const empty = sl(t, ['config', 'set', 'hidden.marker', '--stdin', '--json'], { input: '\n' });
    assert.equal(empty.code, 1);
    assert.match(empty.json.error, /Usage: config set <key> <value>/);
  } finally { t.cleanup(); }
});

test('unknown command is exit 1 with usage', () => {
  const t = tmpEnv();
  try {
    const r = sl(t, ['frobnicate']);
    assert.equal(r.code, 1);
    assert.match(r.err, /Usage/);
  } finally { t.cleanup(); }
});

test('init sets up the subagent rows; uninstall takes them away again', () => {
  const t = tmpEnv();
  try {
    const r = sl(t, ['init', '--json']);
    assert.match(r.json.result.subagentStatusLine.command, /launch\.js" subagents$/);
    assert.match(sl(t, ['init']).out, /Subagent rows/);
    assert.match(JSON.parse(fs.readFileSync(t.p.settingsFile, 'utf8')).subagentStatusLine.command, / subagents$/);
    const u = sl(t, ['uninstall', '--json']);
    assert.equal(u.json.result.subagentLeftAlone, false);
    assert.equal('subagentStatusLine' in JSON.parse(fs.readFileSync(t.p.settingsFile, 'utf8')), false);
  } finally { t.cleanup(); }
});

test('fields lists sline fields and documented Claude Code fields', () => {
  const t = tmpEnv();
  try {
    const r = sl(t, ['fields', '--json']);
    assert.equal(r.code, 0);
    assert.equal(r.json.ok, true);
    assert.ok(r.json.result.claudeCode.includes('session_name'));
    assert.ok(r.json.result.sline.line1.includes('dir'));
  } finally { t.cleanup(); }
});

test('childEnv drops the real session\'s pointers and cannot launch a real claude', () => {
  const t = tmpEnv();
  const keep = ['CLAUDE_SECURESTORAGE_CONFIG_DIR', 'CLAUDE_SLINE_HOME', 'COLUMNS'].map(k => [k, process.env[k]]);
  try {
    Object.assign(process.env, { CLAUDE_SECURESTORAGE_CONFIG_DIR: 'x', CLAUDE_SLINE_HOME: 'y', COLUMNS: '50' });
    const env = childEnv(t, { FOO: '1' });
    assert.equal(env.CLAUDE_SECURESTORAGE_CONFIG_DIR, undefined);
    assert.equal(env.CLAUDE_SLINE_HOME, undefined);
    assert.equal(env.COLUMNS, undefined);
    assert.equal(env.FOO, '1');
    assert.equal(env.CLAUDE_CONFIG_DIR, t.env.CLAUDE_CONFIG_DIR);
    assert.ok(!fs.existsSync(env.CLAUDE_SLINE_CLAUDE));
  } finally {
    keep.forEach(([k, v]) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; });
    t.cleanup();
  }
});
