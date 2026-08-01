#!/usr/bin/env node
'use strict';
// Claude Code status line renderer.
//
//   node statusline-render.js <stdin-json> <display-path> <git-branch>
//
// Line 1  dir, model, effort, context %, session tokens
// Line 2  [active account] 5h, 7d          (active account's live quota, from stdin)
// Line 3+ other accounts' 5h / 7d, read from cache and refreshed in the
//         background (see usage-refresh.js). Never blocks on the network.
//
// The active account's live figures are also written back to its own cache, so
// that switching accounts shows the quota it really ended on rather than the
// last background poll's snapshot.
//
// When ~/.claude/statusline-hidden exists, everything numeric is suppressed:
// only dir/model/effort remain, and no background fetch fires.
//
// Accounts + refresh tuning come from ~/.claude/statusline-accounts.json via
// config.js; sibling scripts are resolved by __dirname so the repo can live
// anywhere (run-in-place). Paths are built from HOME rather than passed in from
// bash: under Git Bash the shell's $HOME is /c/Users/... while node's is
// C:\Users\..., and handing the POSIX form to node yields a bogus C:\c\Users\...

const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const C = require('./config.js');

const cfg = C.load();
const CACHE_DIR = C.CACHE_DIR;
const REFRESH_JS = path.join(__dirname, 'usage-refresh.js');
const ACCOUNTS = cfg.accounts;
const WORKDAYS = new Set(cfg.pace.workingDays);

// Milliseconds between two instants that fall on a configured working day. Walks
// local-day segments (<= 8 iterations for a 7-day window) so day-of-week and the
// user's local midnight boundaries are respected. With all 7 days enabled this
// is just (toMs - fromMs), i.e. the original even-spread pace.
function workMs(fromMs, toMs) {
  if (toMs <= fromMs) return 0;
  let total = 0;
  let cur = fromMs;
  while (cur < toMs) {
    const dt = new Date(cur);
    const dayEnd = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate() + 1).getTime();
    const segEnd = Math.min(dayEnd, toMs);
    if (WORKDAYS.has(dt.getDay())) total += segEnd - cur;
    cur = segEnd;
  }
  return total;
}

const d = JSON.parse(process.argv[2]);
const displayPath = process.argv[3];
const branch = process.argv[4];

const RESET = '\x1b[0m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
// Orange rather than ANSI red (\x1b[31m), which renders too dark to read on
// this terminal. 256-colour is far more widely supported than truecolour.
const ORANGE = '\x1b[38;5;208m';
const DIM = '\x1b[2m';

// Stand-ins for a reset time / pace that isn't known yet or has already
// elapsed. Without them the field simply vanishes and the account lines stop
// lining up. Widths match the real values: HH:MM, "Dow HH:MM", and a
// percentage padded to three digits so 0 / 37 / 100 all occupy one column.
const NO_TIME = DIM + '--:--' + RESET;
const NO_TIME_DAY = DIM + '--- --:--' + RESET;
const NO_PCT = DIM + '--%' + RESET;

// Natural width, no zero-/space-padding: single spacing everywhere reads cleaner
// than reserving a column for the rare 100%. The trade-off is that fields after a
// percentage shift by a character as it grows/shrinks -- an accepted preference.
function pct(v) {
  return String(v) + '%';
}

function colorPct(label, val, low, high) {
  const v = Math.round(val);
  let color;
  if (v < low) color = GREEN;
  else if (v <= high) color = YELLOW;
  else color = ORANGE;
  return color + label + ': ' + pct(v) + RESET;
}

// Always a wall-clock time, never a "in 12m" countdown -- a fixed-width field
// keeps the columns steady, and the clock time is what you actually plan around.
function formatResetTime(resetsAt, withDay) {
  const resetDate = new Date(resetsAt * 1000);
  if (resetDate.getTime() - Date.now() <= 0) return null;
  const h = resetDate.getHours().toString().padStart(2, '0');
  const m = resetDate.getMinutes().toString().padStart(2, '0');
  if (!withDay) return h + ':' + m;
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][resetDate.getDay()];
  return dow + ' ' + h + ':' + m;
}

// The 5h reset, green once it's less than an hour out -- the wait is nearly over.
function fiveHourReset(resetsAt) {
  const t = resetsAt != null ? formatResetTime(resetsAt, false) : null;
  if (t == null) return NO_TIME;
  const soon = (resetsAt * 1000) - Date.now() < 60 * 60 * 1000;
  return soon ? GREEN + t + RESET : t;
}

function formatTokens(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return String(n);
}

// 7d is judged against pace: being at 60% is fine on day 6, alarming on day 1.
function colorPct7d(val, resetsAt) {
  const v = Math.round(val);
  let overPace = false;
  let allottedPct = null;
  if (resetsAt != null) {
    // Pace = fraction of the window's *working* time elapsed. Anthropic's 7-day
    // window is always 7 calendar days; we only change how the expected burn-down
    // is spread across it. On a non-working day nothing accrues, so the pace
    // holds flat (weekend usage then reads as over pace).
    const windowEnd = resetsAt * 1000;
    const windowStart = windowEnd - 7 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const totalWork = workMs(windowStart, windowEnd);
    const elapsedWork = workMs(windowStart, Math.min(now, windowEnd));
    allottedPct = totalWork > 0 ? (elapsedWork / totalWork) * 100 : 0;
    if (v > allottedPct) overPace = true;
  }
  let color;
  if (overPace) color = ORANGE;
  else if (v < 30) color = GREEN;
  else if (v <= 75) color = YELLOW;
  else color = ORANGE;
  let result = color + '7d: ' + pct(v) + RESET;
  result += ' / ' + (allottedPct != null
    ? pct(Math.round(Math.max(0, Math.min(100, allottedPct))))
    : NO_PCT);
  const timeStr = resetsAt != null ? formatResetTime(resetsAt, true) : null;
  if (timeStr != null) {
    const msUntilReset = (resetsAt * 1000) - Date.now();
    const rstColor = msUntilReset < 48 * 60 * 60 * 1000 ? ORANGE : '';
    const rstReset = rstColor ? RESET : '';
    result += ', ' + rstColor + timeStr + rstReset;
  } else {
    result += ', ' + NO_TIME_DAY;
  }
  return result;
}

function formatAge(s) {
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm';
  return Math.floor(m / 60) + 'h' + (m % 60) + 'm';
}

// --- line 1 (never carries account quota) -----------------------------------

const line1 = [];
line1.push('dir:' + displayPath + (branch ? ' (' + branch + ')' : ''));

const modelId = d && d.model && d.model.id;
if (modelId) line1.push('model:' + modelId);

const effort = d && d.effort && d.effort.level;
if (effort) line1.push('effort:' + effort);

// Hidden usage: suppress everything numeric (ctx, session, all quota,
// and the fact that multiple accounts exist). No background fetch either.
if (C.isHidden()) {
  if (cfg.hiddenMarker) line1.push(DIM + cfg.hiddenMarker + RESET);
  console.log(line1.join(' \u00b7 '));
  process.exit(0);
}

const ctx = d && d.context_window && d.context_window.used_percentage;
if (ctx != null) line1.push(colorPct('ctx', ctx, 30, 65));

const totIn = d && d.context_window && d.context_window.total_input_tokens;
const totOut = d && d.context_window && d.context_window.total_output_tokens;
if (totIn != null && totOut != null) line1.push('session:' + formatTokens(totIn + totOut) + 'tk');

// --- account plumbing -------------------------------------------------------

// $CLAUDE_SECURESTORAGE_CONFIG_DIR arrives as C:/Users/... while path.join
// produces C:\Users\...; normalise separators, drive form and case before
// comparing.
function normPath(p) {
  return String(p || '')
    .replace(/\\/g, '/')
    .replace(/^\/([a-zA-Z])\//, '$1:/')
    .replace(/\/+$/, '')
    .toLowerCase();
}

function readCache(key) {
  try {
    return JSON.parse(fs.readFileSync(path.join(CACHE_DIR, key + '.json'), 'utf8'));
  } catch (e) {
    return null;
  }
}

function spawnRefresh(acct) {
  try {
    cp.spawn(process.execPath, [REFRESH_JS, acct.key, acct.dir], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    }).unref();
  } catch (e) { /* a failed refresh must never break the status line */ }
}

// The active account is the one account we never poll -- its live quota rides in
// free on stdin. Persist it, or the cache freezes at whatever the last
// background poll happened to write: the moment you switch accounts this one
// becomes a line 3+ account rendered purely from cache, and a snapshot taken at
// the start of a long session would report quota that's an hour out of date.
// The data is already in hand, so this costs no network call -- and the fresh
// next_attempt_at legitimately keeps the poller off for a full interval.
const CACHE_WRITE_MIN_INTERVAL = 60; // seconds; don't churn disk on every render

function sameSlot(a, b) {
  if (!a || !b) return !a && !b;
  return a.utilization === b.utilization && a.resets_at === b.resets_at;
}

function writeActiveCache(key, fhVal, fhRst, sdVal, sdRst) {
  const five = fhVal != null
    ? { utilization: fhVal, resets_at: fhRst != null ? fhRst : null } : null;
  const seven = sdVal != null
    ? { utilization: sdVal, resets_at: sdRst != null ? sdRst : null } : null;

  // Unchanged numbers still need their timestamp refreshed now and then, or the
  // "(Nm ago)" tag shown after a switch would claim the reading is older than it
  // is. Bounded to one write a minute rather than one per render.
  const prev = caches[key];
  if (prev && sameSlot(prev.five_hour, five) && sameSlot(prev.seven_day, seven) &&
      prev.fetched_at != null && (nowSec - prev.fetched_at) < CACHE_WRITE_MIN_INTERVAL) {
    return;
  }

  // Mirrors usage-refresh.js: an account sitting at exactly 0% has nothing worth
  // watching, so it backs off further.
  const idle = five && five.utilization === 0;
  const out = {
    key: key,
    status: 'ok',
    fetched_at: nowSec,
    checked_at: nowSec,
    next_attempt_at: nowSec + (idle ? cfg.refresh.idleSeconds : cfg.refresh.okSeconds),
    five_hour: five,
    seven_day: seven,
  };

  const file = path.join(CACHE_DIR, key + '.json');
  const tmp = file + '.tmp' + process.pid;
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(out));
    fs.renameSync(tmp, file); // atomic, so a concurrent reader never sees a partial file
    caches[key] = out;
  } catch (e) {
    // Cache is an optimisation, never a dependency -- a failed write must not
    // break the status line.
    try { fs.unlinkSync(tmp); } catch (e2) {}
  }
}

const nowSec = Math.floor(Date.now() / 1000);

const present = ACCOUNTS.filter(function (a) {
  try { return fs.existsSync(path.join(a.dir, '.credentials.json')); } catch (e) { return false; }
});

let activeKey = present.length ? present[0].key : ACCOUNTS[0].key;
const secure = process.env.CLAUDE_SECURESTORAGE_CONFIG_DIR;
if (secure) {
  const match = present.find(function (a) { return normPath(a.dir) === normPath(secure); });
  if (match) activeKey = match.key;
}

const caches = {};
present.forEach(function (a) { caches[a.key] = readCache(a.key); });

// The active account's quota comes free from stdin, so it needs no polling --
// unless stdin hasn't reported limits yet (very start of a session).
const stdinHasLimits = d && d.rate_limits && d.rate_limits.five_hour &&
  d.rate_limits.five_hour.used_percentage != null;

// Once a window's reset time has passed the cached percentage is known to be
// wrong (the quota has rolled over), so don't sit on it for the rest of the
// interval -- but keep a floor so a lagging API can't cause a spawn per render.
function resetPassed(c) {
  if (!c) return false;
  const f = c.five_hour;
  const s = c.seven_day;
  return (f && f.resets_at != null && f.resets_at <= nowSec) ||
    (s && s.resets_at != null && s.resets_at <= nowSec);
}

present.forEach(function (a) {
  if (a.key === activeKey && stdinHasLimits) return;
  const c = caches[a.key];
  if (c && c.next_attempt_at && nowSec < c.next_attempt_at) {
    const overdue = resetPassed(c) && (nowSec - (c.checked_at || 0)) > 30;
    if (!overdue) return;
  }
  spawnRefresh(a);
});

// --- lines 2+ (account quota) -----------------------------------------------

const line2 = [];

// Only label lines when there's more than one account to tell apart. The label
// is a prefix, not a field, so it isn't joined with a separator.
const multi = present.length > 1;
const activeAcct = present.find(function (a) { return a.key === activeKey; });
const activeLabel = activeAcct ? activeAcct.label : '';

// Prefer stdin for the active account; fall back to its cache if absent.
let fh = d && d.rate_limits && d.rate_limits.five_hour &&
  d.rate_limits.five_hour.used_percentage;
let fhRst = d && d.rate_limits && d.rate_limits.five_hour &&
  d.rate_limits.five_hour.resets_at;
let sd = d && d.rate_limits && d.rate_limits.seven_day &&
  d.rate_limits.seven_day.used_percentage;
let sdRst = d && d.rate_limits && d.rate_limits.seven_day &&
  d.rate_limits.seven_day.resets_at;

// Snapshot the live figures before any cache fallback below can mix in older
// values -- only what stdin actually reported is worth persisting.
if (stdinHasLimits) writeActiveCache(activeKey, fh, fhRst, sd, sdRst);

const activeCache = caches[activeKey];
if (fh == null && activeCache && activeCache.five_hour) {
  fh = activeCache.five_hour.utilization;
  fhRst = activeCache.five_hour.resets_at;
}
if (sd == null && activeCache && activeCache.seven_day) {
  sd = activeCache.seven_day.utilization;
  sdRst = activeCache.seven_day.resets_at;
}

if (fh != null) {
  line2.push(colorPct('5h', fh, 30, 75) + ', ' + fiveHourReset(fhRst));
}
if (sd != null) line2.push(colorPct7d(sd, sdRst));

function accountLine(acct) {
  const cache = caches[acct.key];
  const label = '[' + acct.label + ']';

  if (!cache || !cache.five_hour) {
    if (cache && cache.status === 'auth') return label + ' ' + ORANGE + 'auth?' + RESET;
    return label + ' ' + DIM + 'usage:--' + RESET;
  }
  if (cache.status === 'auth') return label + ' ' + ORANGE + 'auth?' + RESET;

  const seg = [];
  const f = cache.five_hour;
  const s = cache.seven_day;
  if (f && f.utilization != null) {
    seg.push(colorPct('5h', f.utilization, 30, 75) + ', ' + fiveHourReset(f.resets_at));
  }
  if (s && s.utilization != null) seg.push(colorPct7d(s.utilization, s.resets_at));

  let out = label + ' ' + seg.join(' \u00b7 ');
  if (cache.fetched_at != null) {
    const age = nowSec - cache.fetched_at;
    const failing = cache.status != null && cache.status !== 'ok';
    const tag = '(' + formatAge(age) + ' ago' + (failing ? ', stale' : '') + ')';
    out += '  ' + (failing ? YELLOW : DIM) + tag + RESET;
  }
  return out;
}

console.log(line1.join(' \u00b7 '));
if (line2.length) console.log((multi ? '[' + activeLabel + '] ' : '') + line2.join(' \u00b7 '));
present.forEach(function (a) {
  if (a.key === activeKey) return;
  console.log(accountLine(a));
});
