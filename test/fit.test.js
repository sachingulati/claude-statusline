'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const FIT = require('../src/fit');
const F = require('../src/format');
const T = require('../src/template');

test('dirVariants: leading folders give way to …; the last folder name stays whole', () => {
  assert.deepEqual(FIT.dirVariants('~/projects/ai/claude-statusline'),
    ['~/projects/ai/claude-statusline', '~/…/ai/claude-statusline', '~/…/claude-statusline', '…/claude-statusline']);
  assert.deepEqual(FIT.dirVariants('C:/work/app'), ['C:/work/app', 'C:/…/app', '…/app']);
  assert.deepEqual(FIT.dirVariants('/srv/app'), ['/srv/app', '…/app']);
  assert.deepEqual(FIT.dirVariants('~'), ['~']);
  assert.deepEqual(FIT.dirVariants('~/app'), ['~/app', '…/app']);
});

test('dropGroups removes top-level groups from the right; groupCount counts them', () => {
  const p = T.parse('a{sep}[b {x}]{sep}[c {y}]').parts;
  assert.equal(FIT.groupCount(p), 2);
  const v = { x: { text: '1', role: null }, y: { text: '2', role: null } };
  const r = parts => T.render(parts, v, { paint: (role, t) => t, sep: ' · ' });
  assert.equal(r(FIT.dropGroups(p, 0)), 'a · b 1 · c 2');
  assert.equal(r(FIT.dropGroups(p, 1)), 'a · b 1');
  assert.equal(r(FIT.dropGroups(p, 5)), 'a');
});

test('truncate: fits the width with …, keeps colours balanced, counts wide characters', () => {
  assert.equal(FIT.truncate('abcdef', 10), 'abcdef');
  assert.equal(FIT.truncate('abcdef', 4), 'abc…');
  const red = '\x1b[31mabcdef\x1b[0m';
  const t = FIT.truncate(red, 4);
  assert.equal(t, '\x1b[31mabc\x1b[0m…');
  assert.equal(F.visibleWidth(t), 4);
  assert.equal(FIT.truncate('日本語テキスト', 5), '日本…');
  assert.equal(F.visibleWidth(FIT.truncate('日本語テキスト', 6)), 5); // a wide char never straddles the edge
  assert.equal(FIT.truncate('abc', 0), '');
});

test('truncate: a coloured segment followed by a plain hint never exceeds the width and stays balanced', () => {
  const line = '\x1b[32mabcdef\x1b[0m hint';
  for (let w = 1; w <= 12; w++) {
    const t = FIT.truncate(line, w);
    assert.ok(F.visibleWidth(t) <= w, `width ${w}: ${JSON.stringify(t)}`);
    const opens = (t.match(/\x1b\[(?!0?m)[0-9;]*m/g) || []).length;
    const resets = (t.match(/\x1b\[0?m/g) || []).length;
    assert.ok(opens === 0 || resets >= opens, `unbalanced at ${w}: ${JSON.stringify(t)}`);
  }
  assert.equal(F.visibleWidth(FIT.truncate(line, 1)), 1);
});
