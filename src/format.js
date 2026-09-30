'use strict';
// Pure formatting for the status line. Time is always passed in (nowMs) so tests
// are deterministic.

const { toForward, normPath } = require('./paths');

const RESET = '\x1b[0m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
// Orange rather than ANSI red, which renders too dark on many terminals.
const ORANGE = '\x1b[38;5;208m';
const DIM = '\x1b[2m';

// Colour names users can give, as ANSI SGR codes.
const COLOR_NAMES = {
  green: '32', yellow: '33', orange: '38;5;208', red: '31', blue: '34', magenta: '35',
  cyan: '36', white: '37', gray: '90', default: '39', dim: '2',
};

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function pct(v) { return String(v) + '%'; }

// A percentage from outside (stdin, /usage): null unless a finite number from 0 to 1000
// (Claude Code once sent an epoch time here); anything above `cap` is shown as `cap`.
function cleanPct(v, cap) {
  if (typeof v !== 'number' || !isFinite(v) || v < 0 || v > 1000) return null;
  return Math.min(v, cap);
}

// One line of plain text: Claude Code's strings can carry newlines, and a stray escape
// code (7- or 8-bit), bidi override or zero-width character must not reach the terminal.
function oneLine(s) {
  return typeof s === 'string'
    ? s.replace(/[\x00-\x1f\x7f-\x9f؜​-‏‪-‮⁦-⁩]+/g, ' ').replace(/\s+/g, ' ').trim()
    : '';
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function clockTime(d, clock) {
  const mm = String(d.getMinutes()).padStart(2, '0');
  if (clock === '12h') {
    const h = d.getHours();
    return (h % 12 || 12) + ':' + mm + (h < 12 ? 'am' : 'pm');
  }
  return String(d.getHours()).padStart(2, '0') + ':' + mm;
}

// Always a wall-clock time: a fixed-width field keeps the columns steady.
function formatResetTime(resetsAt, withDay, now, clock) {
  const d = new Date(resetsAt * 1000);
  if (d.getTime() - now <= 0) return null;
  const hm = clockTime(d, clock);
  if (!withDay) return hm;
  return DAYS[d.getDay()] + ' ' + hm;
}

function formatTokens(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return String(n);
}

// Milliseconds between two instants that fall on a working day, walking local days.
function workMs(fromMs, toMs, workdays) {
  if (toMs <= fromMs) return 0;
  let total = 0;
  let cur = fromMs;
  while (cur < toMs) {
    const dt = new Date(cur);
    const dayEnd = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate() + 1).getTime();
    const segEnd = Math.min(dayEnd, toMs);
    if (workdays.has(dt.getDay())) total += segEnd - cur;
    cur = segEnd;
  }
  return total;
}

// Share of the 7-day window's working time already elapsed: the "allowed" usage now.
function pacePct(resetsAt, now, workingDays) {
  if (resetsAt == null) return null;
  const set = new Set(workingDays);
  const end = resetsAt * 1000;
  const start = end - 7 * DAY;
  const total = workMs(start, end, set);
  const elapsed = workMs(start, Math.min(now, end), set);
  return total > 0 ? Math.max(0, Math.min(100, (elapsed / total) * 100)) : 0;
}

// Share of the 5-hour window already elapsed. The window starts at first use, so its start
// is exactly five hours before the reset; work days don't apply.
function pace5hPct(resetsAt, now) {
  if (resetsAt == null) return null;
  const start = resetsAt * 1000 - 5 * HOUR;
  return Math.max(0, Math.min(100, ((now - start) / (5 * HOUR)) * 100));
}

function formatAge(s) {
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h' + (m % 60) + 'm';
  return Math.floor(h / 24) + 'd' + (h % 24 ? (h % 24) + 'h' : '');
}

// 34s, 1m42s, 1h05m: how long something has been running.
function formatElapsed(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm' + String(s % 60).padStart(2, '0') + 's';
  return Math.floor(m / 60) + 'h' + String(m % 60).padStart(2, '0') + 'm';
}

// Characters a terminal draws two columns wide: Chinese, Japanese and Korean scripts,
// fullwidth forms and emoji, including the older symbols that are emoji by default (⌚ ⚡ ✅).
// Combining marks and variation selectors take none.
const WIDE = [
  [0x1100, 0x115f], [0x2e80, 0x303e], [0x3041, 0x33ff], [0x3400, 0x4dbf], [0x4e00, 0x9fff],
  [0xa000, 0xa4cf], [0xac00, 0xd7a3], [0xf900, 0xfaff], [0xfe30, 0xfe4f], [0xff00, 0xff60],
  [0xffe0, 0xffe6], [0x1f300, 0x1f64f], [0x1f680, 0x1f6ff], [0x1f900, 0x1faff], [0x20000, 0x3fffd],
  [0x231a, 0x231b], [0x2329, 0x232a], [0x23e9, 0x23ec], [0x23f0, 0x23f0], [0x23f3, 0x23f3],
  [0x25fd, 0x25fe], [0x2614, 0x2615], [0x2648, 0x2653], [0x267f, 0x267f], [0x2693, 0x2693],
  [0x26a1, 0x26a1], [0x26aa, 0x26ab], [0x26bd, 0x26be], [0x26c4, 0x26c5], [0x26ce, 0x26ce],
  [0x26d4, 0x26d4], [0x26ea, 0x26ea], [0x26f2, 0x26f3], [0x26f5, 0x26f5], [0x26fa, 0x26fa],
  [0x26fd, 0x26fd], [0x2705, 0x2705], [0x270a, 0x270b], [0x2728, 0x2728], [0x274c, 0x274c],
  [0x274e, 0x274e], [0x2753, 0x2755], [0x2757, 0x2757], [0x2795, 0x2797], [0x27b0, 0x27b0],
  [0x27bf, 0x27bf], [0x2b1b, 0x2b1c], [0x2b50, 0x2b50], [0x2b55, 0x2b55],
];
const ZERO = [[0x0300, 0x036f], [0x200b, 0x200f], [0xfe00, 0xfe0f]];

function within(cp, ranges) {
  for (let i = 0; i < ranges.length; i++) if (cp >= ranges[i][0] && cp <= ranges[i][1]) return true;
  return false;
}

// Columns one character (code point) takes. `next` is the one after it: U+FE0F asks for
// the emoji look, which terminals draw two columns wide (☀ is one column, ☀️ two).
function charWidth(ch, next) {
  const cp = ch.codePointAt(0);
  if (within(cp, ZERO)) return 0;
  if (within(cp, WIDE)) return 2;
  return next === '️' ? 2 : 1;
}

// Terminal columns a drawn line takes: colour codes take none.
function visibleWidth(s) {
  const chars = Array.from(String(s).replace(/\x1b\[[0-9;]*m/g, ''));
  let w = 0;
  for (let i = 0; i < chars.length; i++) w += charWidth(chars[i], chars[i + 1]);
  return w;
}

// ~ for home and anything below it; forward slashes everywhere.
function displayPath(cwd, home) {
  const unGitBash = function (s) { return toForward(s).replace(/^\/([a-zA-Z])\//, '$1:/').replace(/\/+$/, ''); };
  const c = unGitBash(cwd) || '/';
  const h = unGitBash(home);
  if (h && normPath(c) === normPath(h)) return '~';
  if (h && normPath(c).startsWith(normPath(h) + '/')) return '~/' + c.slice(h.length + 1);
  return c;
}

// A colour setting as an ANSI escape: '' for none, null when it isn't a colour.
function colorCode(v) {
  if (typeof v === 'number' || /^\d+$/.test(String(v))) {
    const n = Number(v);
    return Number.isInteger(n) && n >= 0 && n <= 255 ? '\x1b[38;5;' + n + 'm' : null;
  }
  const s = String(v).toLowerCase();
  if (s === 'none') return '';
  if (Object.prototype.hasOwnProperty.call(COLOR_NAMES, s)) return '\x1b[' + COLOR_NAMES[s] + 'm';
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/.exec(s);
  return m ? '\x1b[38;2;' + parseInt(m[1], 16) + ';' + parseInt(m[2], 16) + ';' + parseInt(m[3], 16) + 'm' : null;
}

// display: the normalized display settings (colours already validated).
function makeStyle(display, env) {
  const noColor = !!(env && env.NO_COLOR);
  const colors = {};
  ['ok', 'warn', 'high', 'dim'].forEach(function (role) {
    colors[role] = noColor ? '' : (colorCode(display.colors[role]) || '');
  });
  return { colors: colors, thresholds: display.thresholds, clock: display.clock };
}

function paint(style, role, text) {
  const code = role ? style.colors[role] : '';
  return code ? code + text + RESET : text;
}

function level(v, pair) { return v < pair[0] ? 'ok' : v <= pair[1] ? 'warn' : 'high'; }

module.exports = {
  RESET, GREEN, YELLOW, ORANGE, DIM, COLOR_NAMES,
  pct, cleanPct, oneLine, formatResetTime, clockTime, DAYS, formatTokens, pacePct, pace5hPct, formatAge, formatElapsed, charWidth, visibleWidth, displayPath,
  HOUR, DAY, colorCode, makeStyle, paint, level,
};
