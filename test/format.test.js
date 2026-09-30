'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../src/format');

const HOUR = 3600e3;
const DAY = 24 * HOUR;

test('pacePct: even spread over 7 days', () => {
  const now = Date.UTC(2026, 8, 29, 12);
  const resetsAt = Math.floor((now + 3.5 * DAY) / 1000); // half the window elapsed
  assert.ok(Math.abs(F.pacePct(resetsAt, now, [0, 1, 2, 3, 4, 5, 6]) - 50) < 0.01);
  assert.equal(F.pacePct(null, now, [0, 1, 2, 3, 4, 5, 6]), null);
});

test('pacePct: no allocation accrues on non-working days', () => {
  // Window starts Monday 00:00 local; now is Saturday noon; Mon-Fri working.
  const start = new Date(2026, 8, 28, 0, 0, 0).getTime(); // Mon 28 Sep 2026
  const resetsAt = Math.floor((start + 7 * DAY) / 1000);
  const satNoon = new Date(2026, 9, 3, 12, 0, 0).getTime();
  assert.ok(Math.abs(F.pacePct(resetsAt, satNoon, [1, 2, 3, 4, 5]) - 100) < 0.5);
});

test('formatTokens and formatAge', () => {
  assert.equal(F.formatTokens(340000), '340.0k');
  assert.equal(F.formatTokens(1234567), '1.23M');
  assert.equal(F.formatTokens(999), '999');
  assert.equal(F.formatAge(42), '42s');
  assert.equal(F.formatAge(180), '3m');
  assert.equal(F.formatAge(3 * 3600 + 5 * 60), '3h5m');
  assert.equal(F.formatAge(3 * 86400), '3d');
  assert.equal(F.formatAge(26 * 3600 + 10 * 60), '1d2h');
});

test('displayPath shows ~ for home and below, in any slash or drive form', () => {
  assert.equal(F.displayPath('C:\\Users\\Me', 'C:\\Users\\Me'), '~');
  assert.equal(F.displayPath('C:\\Users\\Me\\projects\\x', 'C:\\Users\\Me'), '~/projects/x');
  assert.equal(F.displayPath('/c/Users/Me/projects', 'C:\\Users\\Me'), '~/projects');
  assert.equal(F.displayPath('/home/me/src', '/home/me'), '~/src');
  assert.equal(F.displayPath('D:\\ai-tools', 'C:\\Users\\Me'), 'D:/ai-tools');
  assert.equal(F.displayPath('/', '/home/me'), '/');
});

const D = { colors: { ok: 'green', warn: 'yellow', high: 'orange', dim: 'dim' }, thresholds: {}, clock: '24h' };

test('colorCode: names, 256 numbers, hex, none; anything else is null', () => {
  assert.equal(F.colorCode('green'), F.GREEN);
  assert.equal(F.colorCode('yellow'), F.YELLOW);
  assert.equal(F.colorCode('orange'), F.ORANGE);
  assert.equal(F.colorCode('dim'), F.DIM);
  assert.equal(F.colorCode('RED'), '\x1b[31m');
  assert.equal(F.colorCode(208), '\x1b[38;5;208m');
  assert.equal(F.colorCode('17'), '\x1b[38;5;17m');
  assert.equal(F.colorCode('#ff8800'), '\x1b[38;2;255;136;0m');
  assert.equal(F.colorCode('none'), '');
  assert.equal(F.colorCode('NONE'), '');
  for (const bad of ['purple', '256', '-1', '1.5', '#ff880', 'ff8800', '', null, undefined]) {
    assert.equal(F.colorCode(bad), null, String(bad));
  }
});

test('paint wraps a role in its colour; none, a null role and NO_COLOR print plain', () => {
  const s = F.makeStyle(D, {});
  assert.equal(F.paint(s, 'high', 'x'), F.ORANGE + 'x' + F.RESET);
  assert.equal(F.paint(s, null, 'x'), 'x');
  const none = F.makeStyle(Object.assign({}, D, { colors: Object.assign({}, D.colors, { high: 'none' }) }), {});
  assert.equal(F.paint(none, 'high', 'x'), 'x');
  assert.equal(F.paint(F.makeStyle(D, { NO_COLOR: '1' }), 'ok', 'x'), 'x');
  assert.equal(F.paint(F.makeStyle(D, { NO_COLOR: '' }), 'ok', 'x'), F.GREEN + 'x' + F.RESET);
});

test('level: below low is ok, low..high inclusive is warn, above high is high', () => {
  assert.deepEqual([29, 30, 75, 76].map(v => F.level(v, [30, 75])), ['ok', 'warn', 'warn', 'high']);
});

test('formatResetTime: 24h and 12h, with and without weekday, around midnight and noon', () => {
  const now = new Date(2026, 8, 28, 0, 0, 0).getTime(); // Mon 28 Sep 2026 00:00 local
  const at = (h, m) => Math.floor(new Date(2026, 8, 28, h, m).getTime() / 1000);
  assert.equal(F.formatResetTime(at(23, 49), false, now, '24h'), '23:49');
  assert.equal(F.formatResetTime(at(23, 49), false, now), '23:49');
  assert.equal(F.formatResetTime(at(23, 49), false, now, '12h'), '11:49pm');
  assert.equal(F.formatResetTime(at(0, 5), false, now, '12h'), '12:05am');
  assert.equal(F.formatResetTime(at(12, 30), true, now, '12h'), 'Mon 12:30pm');
  assert.equal(F.formatResetTime(at(17, 29), true, now, '24h'), 'Mon 17:29');
});

test('formatElapsed: seconds, then m+ss, then h+mm', () => {
  assert.equal(F.formatElapsed(0), '0s');
  assert.equal(F.formatElapsed(34999), '34s');
  assert.equal(F.formatElapsed(59999), '59s');
  assert.equal(F.formatElapsed(60000), '1m00s');
  assert.equal(F.formatElapsed(102000), '1m42s');
  assert.equal(F.formatElapsed(3599999), '59m59s');
  assert.equal(F.formatElapsed(3600000), '1h00m');
  assert.equal(F.formatElapsed(3900000), '1h05m');
  assert.equal(F.formatElapsed(26 * HOUR), '26h00m');
});

test('visibleWidth ignores colour codes', () => {
  assert.equal(F.visibleWidth('ab'), 2);
  assert.equal(F.visibleWidth(F.GREEN + '12%' + F.RESET + ' x'), 5);
});

test('visibleWidth: Chinese, Japanese, Korean, fullwidth and emoji take two columns; combining marks none', () => {
  assert.equal(F.visibleWidth('読み込み'), 8); // kanji + hiragana
  assert.equal(F.visibleWidth('カタカナ'), 8); // katakana
  assert.equal(F.visibleWidth('ｶﾀｶﾅ'), 4); // halfwidth katakana
  assert.equal(F.visibleWidth('한국어'), 6); // hangul
  assert.equal(F.visibleWidth('中文，。'), 8); // hanzi + fullwidth/CJK punctuation
  assert.equal(F.visibleWidth('ＡＢ'), 4); // fullwidth Latin
  assert.equal(F.visibleWidth('\u{20000}'), 2); // CJK extension B, outside the BMP
  assert.equal(F.visibleWidth('\u{1F600}\u{1F680}'), 4); // emoji
  assert.equal(F.visibleWidth('é️'), 1); // combining accent, variation selector
  assert.equal(F.visibleWidth(F.GREEN + '読' + F.RESET + 'x'), 3);
  assert.equal(F.charWidth('読'), 2);
  assert.equal(F.charWidth('x'), 1);
});

test('emoji-by-default symbols are wide; U+FE0F widens the one before it', () => {
  assert.equal(F.visibleWidth('⚡'), 2);      // high voltage
  assert.equal(F.visibleWidth('✅'), 2);      // check mark button
  assert.equal(F.visibleWidth('☀'), 1);      // sun, text look
  assert.equal(F.visibleWidth('☀️'), 2); // sun, emoji look
  assert.equal(F.visibleWidth('\u{1f1ee}\u{1f1f3}'), 2); // a flag: two regional indicators
  assert.equal(F.charWidth('☀', '️'), 2);
});
