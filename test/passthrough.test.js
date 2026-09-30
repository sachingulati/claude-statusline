'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const PT = require('../src/passthrough');

const NOW = new Date(2026, 9, 1, 14, 0, 0).getTime(); // Thu 1 Oct 2026 14:00 local
const S = Math.floor(NOW / 1000);
const f = (name, v, clock) => PT.format(name, v, NOW, clock || '24h');

test('names: dotted paths only', () => {
  for (const ok of ['session_name', 'prompt_cache.expires_at', 'a.b_c.d9']) assert.ok(PT.NAME.test(ok), ok);
  for (const bad of ['', '.a', 'a..b', 'a.', '9a', 'a-b', 'a[0]']) assert.ok(!PT.NAME.test(bad), bad);
});

test('lookup walks objects only; arrays and missing keys are undefined', () => {
  const d = { a: { b: { c: 1 } }, list: [1, 2], s: 'x' };
  assert.equal(PT.lookup(d, 'a.b.c'), 1);
  assert.equal(PT.lookup(d, 'list.0'), undefined);
  assert.equal(PT.lookup(d, 's.length'), undefined);
  assert.equal(PT.lookup(d, 'nope.x'), undefined);
  assert.equal(PT.lookup(d, 'constructor'), undefined);
});

test('_at: clock time today, weekday otherwise; seconds, ms or ISO; the past too', () => {
  assert.equal(f('prompt_cache.expires_at', S + 240), '14:04');
  assert.equal(f('x.resets_at', (S + 240) * 1000), '14:04');
  assert.equal(f('x.resets_at', new Date(2026, 9, 5, 17, 29).toISOString()), 'Mon 17:29');
  assert.equal(f('prompt_cache.last_miss_at', S - 3600), '13:00'); // past times still show
  assert.equal(f('x_at', S + 240, '12h'), '2:04pm');
  assert.equal(f('x_at', 'soon'), null);
  assert.equal(f('x_at', -5), null);
});

test('_ms, _usd, _percentage suffixes', () => {
  assert.equal(f('cost.total_duration_ms', 102000), '1m42s');
  assert.equal(f('cost.total_duration_ms', -1), null);
  assert.equal(f('rate_limits.spend_limit.used_usd', 12.4), '$12.40');
  assert.equal(f('context_window.remaining_percentage', 87.6), '88%');
  assert.equal(f('context_window.remaining_percentage', 5000), null);
});

test('other values: strings on one line, numbers as is, booleans on/empty, objects empty', () => {
  assert.equal(f('session_name', 'fix\nlogin'), 'fix login');
  assert.equal(f('session_name', '   '), null);
  assert.equal(f('prompt_cache.hit_ratio', 0.93), '0.93');
  assert.equal(f('fast_mode', true), 'on');
  assert.equal(f('fast_mode', false), null);
  assert.equal(f('prompt_cache', { warm: true }), null);
  assert.equal(f('workspace.added_dirs', ['/a']), null);
  assert.equal(f('x', null), null);
  assert.equal(f('x', undefined), null);
});

test('values: every asked name gets a value or null, never colour', () => {
  const v = PT.values({ session_name: 'demo', vim: { mode: 'NORMAL' } }, ['session_name', 'vim.mode', 'agent.name'], NOW, '24h');
  assert.deepEqual(v, { session_name: { text: 'demo', role: null }, 'vim.mode': { text: 'NORMAL', role: null }, 'agent.name': null });
});
