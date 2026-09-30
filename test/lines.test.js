'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../src/lines');
const F = require('../src/format');
const T = require('../src/template');
const { stripAnsi } = require('./helpers');

const NOW = new Date(2026, 8, 28, 20, 0, 0).getTime(); // Mon 28 Sep 2026 20:00 local
const S = Math.floor(NOW / 1000);
const ALL = [0, 1, 2, 3, 4, 5, 6];

function style(over) {
  const d = Object.assign(L.defaultDisplay(), over || {});
  return { d, s: F.makeStyle(d, {}) };
}

test('line1 values', () => {
  const { s } = style();
  const v = L.line1({
    model: { id: 'claude-opus-5-5', display_name: 'Opus 5.5' },
    effort: { level: 'high' },
    context_window: { used_percentage: 70.4, total_input_tokens: 300000, total_output_tokens: 40000 },
  }, '/home/me/projects/app', '/home/me', 'main', s);
  assert.deepEqual(v.dir, { text: '~/projects/app', role: null });
  assert.equal(v['dir.full'].text, '/home/me/projects/app');
  assert.equal(v['dir.name'].text, 'app');
  assert.equal(v.branch.text, 'main');
  assert.equal(v.model.text, 'claude-opus-5-5');
  assert.equal(v['model.name'].text, 'Opus 5.5');
  assert.equal(v.effort.text, 'high');
  assert.deepEqual(v.ctx, { text: '70%', role: 'high' });
  assert.equal(v.session.text, '340.0ktk');
  const e = L.line1({}, '/x', '/home/me', '', s);
  for (const k of ['branch', 'model', 'model.name', 'effort', 'ctx', 'session']) assert.equal(e[k], null, k);
  assert.deepEqual(Object.keys(v).sort(), L.FIELDS.line1.slice().sort());
});

test('account values: default thresholds, pace rule and reset windows', () => {
  const { s } = style();
  const v = L.account({
    five: { utilization: 52, resets_at: S + 30 * 60 },   // 20:30, inside the 60-minute window
    seven: { utilization: 70, resets_at: S + 6 * 86400 }, // Sun 20:00; pace 14% so ahead of pace
    spend: { used_percentage: 120, resets_at: null },
  }, NOW, ALL, s);
  assert.deepEqual(v['5h'], { text: '52%', role: 'warn' });
  assert.deepEqual(v['5h.reset'], { text: '20:30', role: 'ok' });
  assert.deepEqual(v['7d'], { text: '70%', role: 'high' });
  assert.deepEqual(v['7d.pace'], { text: '14%', role: null });
  assert.deepEqual(v['7d.reset'], { text: 'Sun 20:00', role: null });
  assert.deepEqual(v.spend, { text: '120%', role: 'high' });
  assert.deepEqual(v['spend.reset'], { text: '--- --:--', role: 'dim' });
  assert.equal(v.age, null);
  assert.equal(v.status, null);
  assert.deepEqual(Object.keys(v).sort(), L.FIELDS.account.slice().sort());
});

test('account values follow custom thresholds, pace switch and windows', () => {
  const th = Object.assign({}, L.DEFAULT_DISPLAY.thresholds,
    { '5h': [60, 90], '7d': [80, 90], '7dPace': false, '5hResetSoon': 0, '7dResetSoon': 200 });
  const { s } = style({ thresholds: th });
  const v = L.account({ five: { utilization: 52, resets_at: S + 30 * 60 }, seven: { utilization: 70, resets_at: S + 6 * 86400 } }, NOW, ALL, s);
  assert.equal(v['5h'].role, 'ok');
  assert.equal(v['5h.reset'].role, null);
  assert.equal(v['7d'].role, 'ok');
  assert.equal(v['7d.reset'].role, 'high');
  assert.equal(v.spend, null);
});

test('account values: unknown resets, 12h clock, age and status', () => {
  const { s } = style({ clock: '12h' });
  const v = L.account({ five: { utilization: 5, resets_at: null }, seven: { utilization: 5, resets_at: null }, age: { seconds: 180, failing: true } }, NOW, ALL, s);
  assert.deepEqual(v['5h.reset'], { text: '--:--', role: 'dim' });
  assert.deepEqual(v['7d.pace'], { text: '--%', role: 'dim' });
  assert.deepEqual(v['7d.reset'], { text: '--- --:--', role: 'dim' });
  assert.deepEqual(v.age, { text: '(3m ago, stale)', role: 'warn' });
  assert.deepEqual(L.account({ age: { seconds: 60, failing: false } }, NOW, ALL, s).age, { text: '(1m ago)', role: 'dim' });
  assert.equal(L.account({ five: { utilization: 5, resets_at: S + 3 * 3600 } }, NOW, ALL, s)['5h.reset'].text, '11:00pm');
  assert.deepEqual(L.account({ status: 'auth' }, NOW, ALL, s).status, { text: 'auth?', role: 'high' });
  const nd = L.account({ status: 'nodata' }, NOW, ALL, s);
  assert.deepEqual(nd.status, { text: 'usage:--', role: 'dim' });
  assert.equal(nd['5h'], null);
});

test('line1 model.name: Claude Code\'s display name, else the name read from the ID', () => {
  const { s } = style();
  const name = m => L.line1({ model: m }, '/home/me/p', '/home/me', null, s)['model.name'];
  assert.equal(name({ id: 'claude-opus-5-5', display_name: 'Opus 5.5 (1M context)' }).text, 'Opus 5.5 (1M context)');
  assert.equal(name({ id: 'claude-haiku-4-5-20251001' }).text, 'Haiku 4.5');
  assert.equal(name({ id: 'm' }).text, 'm');
  assert.equal(name({}), null);
});

test('default templates draw today\'s lines; only values are coloured', () => {
  const { d, s } = style();
  const l1 = L.line1({ model: { id: 'm' }, context_window: { used_percentage: 12 } }, '/home/me/p', '/home/me', 'main', s);
  assert.equal(L.drawLine(d.templates.line1, l1, s, d.separator), 'dir:~/p (main) · model:m · ctx: ' + F.GREEN + '12%' + F.RESET);
  const acct = L.account({ five: { utilization: 52, resets_at: S + 3 * 3600 }, age: { seconds: 180, failing: false } }, NOW, ALL, s);
  assert.equal(stripAnsi(L.drawAccount(d, 'B', acct, s)), '[B] 5h: 52%, 23:00  (3m ago)');
  assert.equal(stripAnsi(L.drawAccount(d, null, acct, s)), '5h: 52%, 23:00  (3m ago)');
  assert.equal(stripAnsi(L.drawAccount(d, 'B', L.account({ status: 'nodata' }, NOW, ALL, s), s)), '[B] usage:--');
  assert.equal(stripAnsi(L.drawAccount(d, null, L.account({ spend: { used_percentage: 64, resets_at: S + 2 * 86400 } }, NOW, ALL, s), s)), 'spend: 64%, Wed 20:00');
});

test('a broken template draws the default plus a dim hint', () => {
  const { d, s } = style();
  d.templates.account = Object.assign({}, d.templates.account, { broken: true });
  const out = L.drawAccount(d, 'A', L.account({ status: 'nodata' }, NOW, ALL, s), s);
  assert.equal(stripAnsi(out), '[A] usage:--  (template error: /sline:doctor)');
  assert.ok(out.endsWith(F.DIM + '(template error: /sline:doctor)' + F.RESET));
});

test('drawAccount is empty when the account body renders empty, even with a label', () => {
  const { d, s } = style();
  d.templates.account = { parts: T.parse('[5h: {5h}]').parts, broken: false };
  const values = {};
  L.FIELDS.account.forEach(k => { values[k] = null; });
  assert.equal(L.drawAccount(d, 'B', values, s), '');
});

test('sampleLines renders plain text through the current templates and clock', () => {
  const d = L.defaultDisplay();
  const lines = L.sampleLines(d);
  assert.equal(lines.length, 4);
  assert.equal(lines[3], '○ general-purpose  Reading fsutil.js · model:Haiku 4.5 · ctx: 16% · tokens:32.4k · 1m42s');
  assert.equal(lines[0], 'dir:~/projects/app (main) · model:Opus 5.5 · effort:high · ctx: 12% · session:340.0ktk');
  assert.match(lines[1], /^\[A\] 5h: 52%, 23:49 · 7d: 38% \/ \d+%, Mon 17:29$/);
  assert.match(lines[2], /^\[B\] 5h: 29%, 01:00 · 7d: 28% \/ \d+%, Mon 17:29 {2}\(3m ago\)$/);
  assert.ok(!/\x1b/.test(lines.join('')));
  d.clock = '12h';
  assert.match(L.sampleLines(d)[1], /, 11:49pm · /);
});

const TASK = {
  status: 'running', description: 'Probe', label: 'Reading fsutil.js', startTime: NOW - 102000,
  model: 'claude-haiku-4-5-20251001', contextWindowSize: 200000, tokenCount: 32400, effort: 'low',
};

test('modelName: claude-<family>-<major>[-<minor>][-<date>], anything else as is', () => {
  assert.equal(L.modelName('claude-haiku-4-5-20251001'), 'Haiku 4.5');
  assert.equal(L.modelName('claude-opus-5-5'), 'Opus 5.5');
  assert.equal(L.modelName('claude-sonnet-4-20250514'), 'Sonnet 4');
  assert.equal(L.modelName('claude-3-5-haiku-20241022'), 'claude-3-5-haiku-20241022');
  assert.equal(L.modelName('claude-opus-5-5[1m]'), 'Opus 5.5 (1M)');
  assert.equal(L.modelName('claude-opus-4-5-20251101[1m]'), 'Opus 4.5 (1M)');
  assert.equal(L.modelName('claude-opus-5-5[]'), 'claude-opus-5-5[]');
  assert.equal(L.modelName('gpt-5'), 'gpt-5');
});

test('subagent values', () => {
  const { s } = style();
  const v = L.subagent(TASK, 'general-purpose', NOW, s);
  assert.deepEqual(Object.keys(v).sort(), L.FIELDS.subagent.slice().sort());
  assert.deepEqual(v.type, { text: 'general-purpose', role: null });
  assert.equal(v.activity.text, 'Reading fsutil.js');
  assert.equal(v.model.text, 'claude-haiku-4-5-20251001');
  assert.equal(v['model.name'].text, 'Haiku 4.5');
  assert.equal(v.effort.text, 'low');
  assert.deepEqual(v.ctx, { text: '16%', role: 'ok' });
  assert.equal(v.tokens.text, '32.4k');
  assert.equal(v.elapsed.text, '1m42s');
});

test('subagent values: fallbacks and empties', () => {
  const { s } = style();
  const v = L.subagent({ description: 'Probe', label: '' }, null, NOW, s);
  assert.equal(v.activity.text, 'Probe');
  for (const k of ['type', 'model', 'model.name', 'effort', 'ctx', 'tokens', 'elapsed']) assert.equal(v[k], null, k);
  assert.equal(L.subagent({ label: 'x', effort: 2048 }, null, NOW, s).effort.text, '2048');
  // elapsed only while running
  assert.equal(L.subagent(Object.assign({}, TASK, { status: 'completed' }), null, NOW, s).elapsed, null);
  assert.equal(L.subagent({ label: 'x', tokenCount: 0 }, null, NOW, s).tokens.text, '0');
});

test('subagent values: odd inputs never print NaN, negatives or control characters', () => {
  const { s } = style();
  const v = L.subagent({
    status: 'running', label: 'line one\nline two\x1b[31m  red\t', startTime: NOW + 5000,
    tokenCount: '900', contextWindowSize: 0, model: 42,
  }, 'Explore\n', NOW, s);
  assert.equal(v.type.text, 'Explore');
  assert.equal(v.activity.text, 'line one line two [31m red');
  assert.equal(v.elapsed, null); // start in the future
  assert.equal(v.tokens, null); // not a number
  assert.equal(v.ctx, null);
  assert.equal(v.model, null);
  assert.equal(L.subagent({ label: 'x', tokenCount: 50, contextWindowSize: 0 }, null, NOW, s).ctx, null);
  assert.equal(L.subagent({ label: 'x', tokenCount: -5, contextWindowSize: 100 }, null, NOW, s).ctx, null);
  assert.equal(L.subagent({ label: 'x', tokenCount: -5 }, null, NOW, s).tokens, null);
});

test('default subagent template draws the agreed row', () => {
  const { d, s } = style();
  const v = L.subagent(TASK, 'general-purpose', NOW, s);
  assert.equal(stripAnsi(L.drawLine(d.templates.subagent, v, s, d.separator)),
    'general-purpose  Reading fsutil.js · model:Haiku 4.5 · effort:low · ctx: 16% · tokens:32.4k · 1m42s');
  const bare = L.subagent({ label: 'Starting' }, null, NOW, s);
  assert.equal(L.drawLine(d.templates.subagent, bare, s, d.separator), 'Starting');
});

test('subagent values: 8-bit controls, bidi and zero-width characters never reach the terminal', () => {
  const { s } = style();
  const v = L.subagent({ label: 'a\u009b31mb\u0085c‮d​e⁦f' }, null, NOW, s);
  assert.equal(v.activity.text, 'a 31mb c d e f');
});
