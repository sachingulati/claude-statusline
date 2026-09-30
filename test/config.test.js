'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { tmpEnv, addCreds, writeJson } = require('./helpers');
const config = require('../src/config');
const { UserError } = require('../src/fsutil');

test('zero-config: one unlabelled default account in claudeDir', () => {
  const t = tmpEnv();
  try {
    const c = config.load(t.p);
    assert.deepEqual(c.accounts, [{ label: '', key: 'default', dir: t.p.claudeDir }]);
    assert.equal(c.display.otherAccounts, true);
    assert.deepEqual(c.pace.workingDays, [0, 1, 2, 3, 4, 5, 6]);
    assert.equal(c.refresh.okSeconds, 1800);
    assert.equal(c.hiddenMarker, 'hidden');
  } finally { t.cleanup(); }
});

test('accounts get slug keys and ~ expansion', () => {
  const t = tmpEnv();
  try {
    writeJson(t.p.configFile, { accounts: [{ label: 'A', credsDir: '~/.claude' }, { label: 'B b', credsDir: '~/.creds-b' }] });
    const c = config.load(t.p);
    assert.deepEqual(c.accounts.map(a => a.key), ['A', 'B_b']);
    assert.equal(c.accounts[1].dir, path.join(t.home, '.creds-b'));
  } finally { t.cleanup(); }
});

test('a hand-broken config.json: load falls back, set refuses without overwriting', () => {
  const t = tmpEnv();
  try {
    fs.mkdirSync(t.p.stateDir, { recursive: true });
    fs.writeFileSync(t.p.configFile, '{ "accounts": [ oops');
    assert.equal(config.load(t.p).accounts[0].key, 'default');
    assert.throws(() => config.set(t.p, 'hidden.marker', 'x'), UserError);
    assert.equal(fs.readFileSync(t.p.configFile, 'utf8'), '{ "accounts": [ oops');
  } finally { t.cleanup(); }
});

test('set validates and round-trips each key', () => {
  const t = tmpEnv();
  try {
    assert.equal(config.set(t.p, 'display.otherAccounts', 'off'), false);
    assert.deepEqual(config.set(t.p, 'pace.workingDays', '5,1,2,3,4'), [1, 2, 3, 4, 5]);
    assert.equal(config.set(t.p, 'refresh.okSeconds', '900'), 900);
    assert.equal(config.set(t.p, 'hidden.marker', 'numbers off'), 'numbers off');
    const c = config.load(t.p);
    assert.equal(c.display.otherAccounts, false);
    assert.deepEqual(c.pace.workingDays, [1, 2, 3, 4, 5]);
    assert.equal(c.refresh.okSeconds, 900);
    assert.equal(c.hiddenMarker, 'numbers off');
  } finally { t.cleanup(); }
});

test('set rejects unknown keys and bad values', () => {
  const t = tmpEnv();
  try {
    assert.throws(() => config.set(t.p, 'nope', '1'), /Unknown setting/);
    assert.throws(() => config.set(t.p, 'display.otherAccounts', 'maybe'), /true or false/);
    assert.throws(() => config.set(t.p, 'pace.workingDays', '1,9'), /0-6/);
    assert.throws(() => config.set(t.p, 'refresh.okSeconds', '10'), />= 60/);
    assert.throws(() => config.set(t.p, 'refresh.errorSeconds', '29'), />= 30/);
  } finally { t.cleanup(); }
});

test('show reports origin per key', () => {
  const t = tmpEnv();
  try {
    config.set(t.p, 'refresh.okSeconds', '900');
    const rows = config.show(t.p).rows;
    assert.deepEqual(rows.find(r => r.key === 'refresh.okSeconds'), { key: 'refresh.okSeconds', value: 900, origin: 'config.json' });
    assert.deepEqual(rows.find(r => r.key === 'hidden.marker'), { key: 'hidden.marker', value: 'hidden', origin: 'default' });
  } finally { t.cleanup(); }
});

test('account add/rename/forget/list', () => {
  const t = tmpEnv();
  try {
    addCreds(t.p.claudeDir);
    assert.equal(config.addAccount(t.p, 'A', '~/.claude').warning, '');
    const b = config.addAccount(t.p, 'B', '~/.creds-b');
    assert.match(b.warning, /No \.credentials\.json/);
    assert.throws(() => config.addAccount(t.p, 'A', '~/x'), /already exists/);
    assert.deepEqual(config.listAccounts(t.p).map(a => [a.label, a.hasCredentials]), [['A', true], ['B', false]]);

    writeJson(path.join(t.p.cacheDir, 'B.json'), { key: 'B' });
    assert.deepEqual(config.renameAccount(t.p, 'B', 'Work'), { label: 'B', newLabel: 'Work' });
    assert.ok(fs.existsSync(path.join(t.p.cacheDir, 'Work.json')));
    assert.throws(() => config.renameAccount(t.p, 'Work', 'A'), /already exists/);
    assert.throws(() => config.renameAccount(t.p, 'Z', 'Y'), /No account/);

    config.forgetAccount(t.p, 'Work');
    assert.deepEqual(config.listAccounts(t.p).map(a => a.label), ['A']);
    assert.deepEqual(config.load(t.p).ignoredDirs, [path.join(t.home, '.creds-b')]);
    config.addAccount(t.p, 'B', '~/.creds-b'); // adding it back un-ignores it
    assert.deepEqual(config.load(t.p).ignoredDirs, []);
    assert.throws(() => config.forgetAccount(t.p, 'Z'), /No account/);
  } finally { t.cleanup(); }
});

test('registerFolder: the default login alone registers nothing', () => {
  const t = tmpEnv();
  try {
    assert.deepEqual(config.registerFolder(t.p, t.p.claudeDir), { added: [] });
    assert.equal(fs.existsSync(t.p.configFile), false);
  } finally { t.cleanup(); }
});

test('registerFolder: a second login adds the default as A, then itself as B', () => {
  const t = tmpEnv();
  try {
    const b = path.join(t.home, '.creds-b');
    assert.deepEqual(config.registerFolder(t.p, b), { added: ['A', 'B'] });
    const raw = JSON.parse(fs.readFileSync(t.p.configFile, 'utf8'));
    assert.deepEqual(raw.accounts, [{ label: 'A', credsDir: '~/.claude' }, { label: 'B', credsDir: '~/.creds-b' }]);
    assert.deepEqual(config.registerFolder(t.p, b), { added: [] }); // known
    assert.deepEqual(config.registerFolder(t.p, path.join(t.home, '.creds-c')), { added: ['C'] });
  } finally { t.cleanup(); }
});

test('registerFolder: known in another spelling, ignored, and next free label', () => {
  const t = tmpEnv();
  try {
    writeJson(t.p.configFile, { accounts: [{ label: 'A', credsDir: '~/.claude' }, { label: 'C', credsDir: '~/.creds-c' }], ignoredDirs: ['~/.old'] });
    assert.deepEqual(config.registerFolder(t.p, path.join(t.home, '.creds-c') + path.sep), { added: [] });
    assert.deepEqual(config.registerFolder(t.p, path.join(t.home, '.old')), { added: [] });
    assert.deepEqual(config.registerFolder(t.p, path.join(t.home, '.creds-b')), { added: ['B'] });
  } finally { t.cleanup(); }
});

test('knows: configured, zero-config default, other spelling, ignored', () => {
  const t = tmpEnv();
  try {
    assert.equal(config.knows(config.load(t.p), t.p.claudeDir), true); // zero-config default
    assert.equal(config.knows(config.load(t.p), path.join(t.home, '.creds-b')), false);
    writeJson(t.p.configFile, { accounts: [{ label: 'A', credsDir: '~/.claude' }, { label: 'C', credsDir: '~/.creds-c' }], ignoredDirs: ['~/.old'] });
    const c = config.load(t.p);
    assert.equal(config.knows(c, path.join(t.home, '.creds-c') + path.sep), true);
    assert.equal(config.knows(c, path.join(t.home, '.old')), true);
    assert.equal(config.knows(c, path.join(t.home, '.creds-b')), false);
  } finally { t.cleanup(); }
});

test('display defaults: parsed templates, thresholds, colours, clock, no problems', () => {
  const t = tmpEnv();
  try {
    const d = config.load(t.p).display;
    assert.equal(d.otherAccounts, true);
    assert.equal(d.templates.line1.broken, false);
    assert.ok(Array.isArray(d.templates.account.parts));
    assert.deepEqual(d.thresholds['5h'], [30, 75]);
    assert.equal(d.colors.high, 'orange');
    assert.equal(d.clock, '24h');
    assert.equal(d.separator, ' · ');
    assert.deepEqual(d.problems, []);
  } finally { t.cleanup(); }
});

test('display set: templates are checked before anything is written', () => {
  const t = tmpEnv();
  try {
    assert.equal(config.set(t.p, 'display.line1', '{model} · {dir}[ ({branch})]'), '{model} · {dir}[ ({branch})]');
    const before = fs.readFileSync(t.p.configFile, 'utf8');
    assert.throws(() => config.set(t.p, 'display.line1', '{model} {dri}'),
      e => e instanceof UserError && /Unknown field \{dri\} at column 9/.test(e.message) && /dir, dir\.full/.test(e.fix));
    assert.throws(() => config.set(t.p, 'display.line1', '{dir}[ ({branch})'), /Unclosed "\[" at column 6/);
    assert.throws(() => config.set(t.p, 'display.label', '{dir}'), /Unknown field \{dir\}/);
    assert.throws(() => config.set(t.p, 'display.account', '{ctx}'), /Unknown field \{ctx\}/);
    assert.equal(fs.readFileSync(t.p.configFile, 'utf8'), before);
    assert.equal(config.load(t.p).display.templates.line1.parts[0].name, 'model');
  } finally { t.cleanup(); }
});

test('display set: thresholds, windows, colours, clock, separator', () => {
  const t = tmpEnv();
  try {
    assert.deepEqual(config.set(t.p, 'display.thresholds.5h', '50,80'), [50, 80]);
    assert.throws(() => config.set(t.p, 'display.thresholds.5h', '80,50'), /low first/);
    assert.throws(() => config.set(t.p, 'display.thresholds.ctx', '30'), /two whole numbers/);
    assert.throws(() => config.set(t.p, 'display.thresholds.ctx', '30,101'), /0-100/);
    assert.equal(config.set(t.p, 'display.thresholds.7dPace', 'off'), false);
    assert.equal(config.set(t.p, 'display.thresholds.5hResetSoon', '0'), 0);
    assert.throws(() => config.set(t.p, 'display.thresholds.7dResetSoon', '-1'), />= 0/);
    assert.equal(config.set(t.p, 'display.colors.high', 'red'), 'red');
    assert.equal(config.set(t.p, 'display.colors.ok', '208'), '208');
    assert.equal(config.set(t.p, 'display.colors.warn', '#FF8800'), '#ff8800');
    assert.equal(config.set(t.p, 'display.colors.dim', 'none'), 'none');
    assert.throws(() => config.set(t.p, 'display.colors.ok', 'purple'), /Unknown colour/);
    assert.equal(config.set(t.p, 'display.clock', '12h'), '12h');
    assert.throws(() => config.set(t.p, 'display.clock', '13h'), /12h or 24h/);
    assert.equal(config.set(t.p, 'display.separator', ' | '), ' | ');
    const d = config.load(t.p).display;
    assert.deepEqual([d.thresholds['5h'], d.thresholds['7dPace'], d.colors.high, d.clock, d.separator],
      [[50, 80], false, 'red', '12h', ' | ']);
    assert.deepEqual(d.problems, []);
    config.set(t.p, 'display.separator', ' · ');
    assert.equal(config.load(t.p).display.separator, ' · ');
  } finally { t.cleanup(); }
});

test('hand-edited display settings never throw: bad values fall back and are reported', () => {
  const t = tmpEnv();
  try {
    writeJson(t.p.configFile, { display: {
      otherAccounts: false,
      line1: '{dir}[ ({branch})',
      account: '{5h} {typo}',
      thresholds: { '5h': [90, 10], ctx: '40,70' },
      colors: { high: 'purple', ok: null },
      clock: 12,
    } });
    const d = config.load(t.p).display;
    assert.equal(d.otherAccounts, false);
    assert.equal(d.templates.line1.broken, true);
    assert.equal(d.templates.account.broken, false); // unknown field: kept, shown as typed
    assert.deepEqual(d.thresholds['5h'], [30, 75]);
    assert.deepEqual(d.thresholds.ctx, [40, 70]);
    assert.equal(d.colors.high, 'orange');
    assert.equal(d.colors.ok, 'green');
    assert.equal(d.clock, '12h');
    assert.deepEqual(d.problems.map(x => x.key).sort(),
      ['display.account', 'display.colors.high', 'display.colors.ok', 'display.line1', 'display.thresholds.5h']);
    assert.ok(d.problems.every(x => x.message && x.fix));

    writeJson(t.p.configFile, { display: 'x' });
    const d2 = config.load(t.p).display;
    assert.equal(d2.otherAccounts, true);
    assert.deepEqual(d2.problems, []);
  } finally { t.cleanup(); }
});

test('resetDisplay keeps otherAccounts; show carries a plain sample', () => {
  const t = tmpEnv();
  try {
    config.set(t.p, 'display.otherAccounts', 'false');
    config.set(t.p, 'display.clock', '12h');
    config.set(t.p, 'display.line1', '{model}');
    assert.equal(config.show(t.p).sample[0], 'claude-opus-5-5');
    assert.deepEqual(config.resetDisplay(t.p), { reset: 'display' });
    assert.deepEqual(JSON.parse(fs.readFileSync(t.p.configFile, 'utf8')).display, { otherAccounts: false });
    const s = config.show(t.p);
    assert.equal(s.sample.length, 3); // only the active account, so no [A] label
    assert.doesNotMatch(s.sample[1], /\[A\]/);
    assert.match(s.sample[0], /^dir:~\/projects\/app \(main\)/);
    assert.deepEqual(s.rows.find(r => r.key === 'display.clock'), { key: 'display.clock', value: '24h', origin: 'default' });
  } finally { t.cleanup(); }
});

test('display.subagent: set checks its fields, hand-edited broken one falls back, reset clears it', () => {
  const t = tmpEnv();
  try {
    assert.equal(config.load(t.p).display.templates.subagent.broken, false);
    assert.throws(() => config.set(t.p, 'display.subagent', '{activity} {dir}'), /Unknown field \{dir\}/);
    config.set(t.p, 'display.subagent', '{activity}{sep}[{tokens}]');
    assert.equal(config.load(t.p).display.templates.subagent.parts[0].name, 'activity');
    assert.deepEqual(config.show(t.p).rows.find(r => r.key === 'display.subagent'),
      { key: 'display.subagent', value: '{activity}{sep}[{tokens}]', origin: 'config.json' });

    writeJson(t.p.configFile, { display: { subagent: '[{activity}' } });
    const d = config.load(t.p).display;
    assert.equal(d.templates.subagent.broken, true);
    assert.deepEqual(d.problems.map(x => x.key), ['display.subagent']);

    config.resetDisplay(t.p);
    assert.equal(config.load(t.p).display.templates.subagent.broken, false);
    assert.equal(config.show(t.p).rows.find(r => r.key === 'display.subagent').origin, 'default');
  } finally { t.cleanup(); }
});

test('hand-edited values that do not parse fall back to defaults, and show says so', () => {
  const t = tmpEnv();
  try {
    writeJson(t.p.configFile, {
      display: { thresholds: { ctx: ['', ''], '5hResetSoon': [5] }, otherAccounts: 'no' },
      refresh: { okSeconds: 'abc', idleSeconds: '120' },
      pace: { workingDays: ['', 'mon'] },
    });
    const cfg = config.load(t.p);
    assert.deepEqual(cfg.display.thresholds.ctx, config.KEYS['display.thresholds.ctx'].def);
    assert.equal(cfg.display.thresholds['5hResetSoon'], config.KEYS['display.thresholds.5hResetSoon'].def);
    assert.equal(cfg.display.otherAccounts, false);
    assert.equal(cfg.refresh.okSeconds, config.DEFAULT_REFRESH.okSeconds);
    assert.equal(cfg.refresh.idleSeconds, 120);
    assert.deepEqual(cfg.pace.workingDays, [0, 1, 2, 3, 4, 5, 6]);
    const rows = config.show(t.p).rows;
    const ctx = rows.find(r => r.key === 'display.thresholds.ctx');
    assert.deepEqual(ctx.value, config.KEYS['display.thresholds.ctx'].def);
    assert.match(ctx.origin, /^default, config.json has invalid \["",""\]$/);
    assert.deepEqual(rows.find(r => r.key === 'refresh.idleSeconds'), { key: 'refresh.idleSeconds', value: 120, origin: 'config.json' });
    assert.equal(rows.find(r => r.key === 'display.otherAccounts').value, false);
  } finally { t.cleanup(); }
});

test('show keeps a template with an unknown field, as the status line does', () => {
  const t = tmpEnv();
  try {
    writeJson(t.p.configFile, { display: { line1: '{nope}' } });
    assert.deepEqual(config.show(t.p).rows.find(r => r.key === 'display.line1'),
      { key: 'display.line1', value: '{nope}', origin: 'config.json' });
  } finally { t.cleanup(); }
});

test('working days take names and ranges', () => {
  const parse = config.KEYS['pace.workingDays'].parse;
  assert.deepEqual(parse('mon-fri'), [1, 2, 3, 4, 5]);
  assert.deepEqual(parse('Mon, wed thursday'), [1, 3, 4]);
  assert.deepEqual(parse('fri-mon'), [0, 1, 5, 6]);
  assert.deepEqual(parse('1-3,6'), [1, 2, 3, 6]);
  assert.deepEqual(parse([1, '2']), [1, 2]);
  assert.throws(() => parse('mo'), /names/);
  assert.throws(() => parse(''), /names/);
  assert.throws(() => parse([true]), /names/);
  assert.throws(() => parse('mon-xyz'), /names/);
});

test('number settings refuse blanks, booleans, arrays and fractions', () => {
  const pair = config.KEYS['display.thresholds.5h'].parse;
  assert.deepEqual(pair('30, 75'), [30, 75]);
  assert.throws(() => pair(['', '']), /two whole numbers/);
  assert.throws(() => pair('30.5,75'), /two whole numbers/);
  const secs = config.KEYS['refresh.okSeconds'].parse;
  assert.equal(secs('600'), 600);
  [true, '', [900], 90.5].forEach(v => assert.throws(() => secs(v), /whole number/));
});

test('a config.json holding null or an array is refused by the CLI and ignored by the status line', () => {
  const t = tmpEnv();
  try {
    fs.mkdirSync(path.dirname(t.p.configFile), { recursive: true });
    ['null', '[]', '5'].forEach(function (text) {
      fs.writeFileSync(t.p.configFile, text);
      assert.throws(() => config.readRaw(t.p), /JSON object/);
      assert.equal(config.load(t.p).accounts[0].key, 'default');
    });
  } finally { t.cleanup(); }
});

test('account add stores a clean ~/ path', () => {
  const t = tmpEnv();
  try {
    const r = config.addAccount(t.p, 'B', path.join(t.p.home, 'x', '..', '.creds-b') + path.sep);
    assert.equal(r.credsDir, '~/.creds-b');
    assert.equal(JSON.parse(fs.readFileSync(t.p.configFile, 'utf8')).accounts[0].credsDir, '~/.creds-b');
    assert.doesNotMatch(r.warning, /"~/); // a quoted ~ would not expand in the shell
  } finally { t.cleanup(); }
});
