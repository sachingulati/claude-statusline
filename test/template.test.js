'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../src/template');

const opts = { paint: (role, text) => (role ? '<' + role + '>' + text + '</>' : text), sep: ' · ' };
function r(tpl, values) {
  const p = T.parse(tpl);
  assert.equal(p.error, null, JSON.stringify(p.error));
  return T.render(p.parts, values, opts);
}
const v = t => ({ text: t, role: null });

test('text and fields; a field shows its value in its colour role', () => {
  assert.equal(r('dir:{dir} x', { dir: v('~/a') }), 'dir:~/a x');
  assert.equal(r('{ctx}', { ctx: { text: '12%', role: 'ok' } }), '<ok>12%</>');
});

test('an optional group is dropped when any field inside is empty', () => {
  assert.equal(r('{dir}[ ({branch})]', { dir: v('a'), branch: null }), 'a');
  assert.equal(r('{dir}[ ({branch})]', { dir: v('a'), branch: v('main') }), 'a (main)');
  assert.equal(r('[{a}, {b}]', { a: v('1'), b: null }), '');
  assert.equal(r('[no fields]', {}), 'no fields');
});

test('an empty field outside a group prints nothing', () => {
  assert.equal(r('<{a}>', { a: null }), '<>');
});

test('escapes print the character', () => {
  assert.equal(r('\\[{a}\\] \\{x\\} \\\\', { a: v('A') }), '[A] {x} \\');
});

test('{sep} only between two non-empty parts; consecutive ones count as one', () => {
  const vals = { a: v('A'), b: v('B'), n: null };
  assert.equal(r('{a}{sep}{b}', vals), 'A · B');
  assert.equal(r('{n}{sep}{b}', vals), 'B');
  assert.equal(r('{a}{sep}{n}', vals), 'A');
  assert.equal(r('{a}{sep}[{n}]{sep}{b}', vals), 'A · B');
  assert.equal(r('[{n}]{sep}[x{n}]{sep}{b}{sep}', vals), 'B');
  assert.equal(r('[{n}]{sep}[{n}]', vals), '');
  assert.equal(r('{a}{sep}[{n}]{b}', vals), 'AB');
  assert.equal(r('[x{a}]{sep}[y{n}][  {b}]', vals), 'xA  B');
});

test('an unknown field prints as typed', () => {
  assert.equal(r('{dri} {a}', { a: v('A') }), '{dri} A');
});

test('parse errors name the column and a fix', () => {
  const cases = [
    ['ab{dir', 'Unclosed "{"', 3],
    ['a}b', 'Stray "}"', 2],
    ['x[{a}', 'Unclosed "["', 2],
    ['a]', 'Stray "]"', 2],
    ['[a[b]]', '"[" inside another [ ]', 3],
    ['[{sep}]', '{sep} inside [ ]', 2],
    ['a{}', 'Empty "{}"', 2],
    ['a\\', 'Lone "\\" at the end', 2],
    ['', 'Template must be non-empty text', 1],
  ];
  for (const [tpl, msg, col] of cases) {
    const e = T.parse(tpl).error;
    assert.ok(e, tpl);
    assert.equal(e.message, msg, tpl);
    assert.equal(e.column, col, tpl);
    assert.ok(e.fix, tpl);
    assert.equal(T.parse(tpl).parts, null, tpl);
  }
  assert.ok(T.parse(null).error);
  assert.ok(T.parse(42).error);
});

test('check refuses unknown fields and lists the valid ones', () => {
  assert.equal(T.check('{a} {b}', ['a', 'b']), null);
  const e = T.check('x {c}', ['a', 'b']);
  assert.equal(e.message, 'Unknown field {c}');
  assert.equal(e.column, 3);
  assert.match(e.fix, /a, b/);
  assert.equal(T.check('{a', ['a']).message, 'Unclosed "{"');
});

test('fields lists fields at the top level and inside groups', () => {
  assert.deepEqual(T.fields(T.parse('{a}[x{b}]{sep}').parts).map(f => f.name), ['a', 'b']);
});

test('check accepts a predicate and a hint', () => {
  assert.equal(T.check('{a.b}', n => n.startsWith('a.'), 'x'), null);
  const e = T.check('{zz}', n => n === 'a', 'Fields here: a');
  assert.equal(e.message, 'Unknown field {zz}');
  assert.equal(e.fix, 'Fields here: a');
  assert.equal(T.check('{b}', ['a', 'b']), null); // arrays still work
});
