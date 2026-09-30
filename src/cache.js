'use strict';
// Per-account usage records: <stateDir>/cache/<key>.json.
//
// Each session records its own account's live numbers from Claude Code (stdin), but only
// after a reply (settleActive; <stateDir>/sessions/<session_id>.json tells replies apart).
// Other accounts show their last record, rolled forward past any reset. When a record is
// more than 30 minutes old, a detached runner (refresh.js) asks Claude Code's own
// /usage for it; <key>.attempt.json paces those runs.

const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const { writeFileAtomic } = require('./fsutil');

const WRITE_MIN_INTERVAL = 60; // seconds; unchanged numbers only refresh the timestamp this often
const FETCH_AFTER = 1800;      // a record older than this is checked in the background,
const RETRY_OK = 1800;         // but not within this long of a check that worked
const RETRY_FAILED = 3600;     // or this long of one that didn't (the endpoint rate-limits hard)
const WEEK = 7 * 86400;
const SAME_WINDOW = 4 * 3600;  // reset times closer than this are one window (windows are 5h+ apart)
const SESSION_TTL = 2 * 86400; // a session state file untouched this long is removed
const FUTURE = 300;            // a stored time further ahead than this is a clock that jumped back
const REFRESH_JS = path.join(__dirname, 'refresh.js');

function file(p, key) { return path.join(p.cacheDir, key + '.json'); }
function attemptFile(p, key) { return path.join(p.cacheDir, key + '.attempt.json'); }

// Claude Code's config folder for this account's checks. A key of only dots would name
// the accounts folder or its parent.
function accountDir(p, key) {
  return path.join(p.accountsDir, /^\.+$/.test(key) ? key.replace(/\./g, '_') : key);
}

function readQuiet(f) {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; }
}

function read(p, key) { return readQuiet(file(p, key)); }
function readAttempt(p, key) { return readQuiet(attemptFile(p, key)); }
function writeAttempt(p, key, a) { writeFileAtomic(attemptFile(p, key), JSON.stringify(a)); }

// extra: { scoped, checked_at } from a background check, kept across session writes.
function writeRecord(p, key, five, seven, nowSec, extra) {
  const out = Object.assign({ key: key, status: 'ok', fetched_at: nowSec, five_hour: five, seven_day: seven }, extra || {});
  writeFileAtomic(file(p, key), JSON.stringify(out));
  return out;
}

// What a session's live write must not lose: only a background check knows these.
function checkFields(prev) {
  const out = {};
  if (prev && Array.isArray(prev.scoped)) out.scoped = prev.scoped;
  if (prev && prev.checked_at != null) out.checked_at = prev.checked_at;
  return out;
}

function sameSlot(a, b) {
  if (!a || !b) return !a && !b;
  return a.utilization === b.utilization && a.resets_at === b.resets_at;
}

function writeActive(p, key, prev, live, nowSec) {
  if (prev && sameSlot(prev.five_hour, live.five) && sameSlot(prev.seven_day, live.seven) &&
      prev.fetched_at != null && (nowSec - prev.fetched_at) < WRITE_MIN_INTERVAL) {
    return prev;
  }
  try {
    return writeRecord(p, key, live.five, live.seven, nowSec, checkFields(prev));
  } catch (e) {
    return prev; // the record is an optimisation, never a dependency
  }
}

// Of two readings of one limit, the newer: usage only grows within a window, so the later
// window wins, and within one window the higher figure. A tie keeps a.
function newer(a, b) {
  if (!b) return a;
  if (!a) return b;
  if (a.resets_at != null && b.resets_at != null) {
    const d = a.resets_at - b.resets_at;
    if (d >= SAME_WINDOW) return a;
    if (d <= -SAME_WINDOW) return b;
  }
  return a.utilization >= b.utilization ? a : b;
}

// <stateDir>/sessions/<session_id>.json: { api_ms, reply_at }. Only a plain name is a file.
function sessionFile(p, id) {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id) ? path.join(p.sessionsDir, id + '.json') : null;
}
function readSession(p, id) { const f = sessionFile(p, id); return f ? readQuiet(f) : null; }
function writeSession(p, id, st) { const f = sessionFile(p, id); if (f) writeFileAtomic(f, JSON.stringify(st)); }

// A state file is rewritten on every reply, so an untouched one belongs to a session that
// ended or has sat idle for days; the latter just starts over as a session seen first.
function pruneSessions(p, nowSec) {
  let names;
  try { names = fs.readdirSync(p.sessionsDir); } catch (e) { return; }
  names.forEach(function (n) {
    const f = path.join(p.sessionsDir, n);
    try { if (nowSec - fs.statSync(f).mtimeMs / 1000 > SESSION_TTL) fs.unlinkSync(f); } catch (e) { /* gone, or in use */ }
  });
}

// This session's figures from stdin against the account's record. Claude Code redraws an
// idle session with the rate limits of its last reply, and its record could overwrite a
// newer one from another session. cost.total_api_duration_ms grows with every reply and
// nothing else, so each session keeps it (session.apiMs) and the time of that reply.
//   reply since the last redraw  -> record stdin
//   no reply                     -> nothing written; a record written after the reply is newer
//   first seen, or no id/total   -> record stdin only if no limit is older than the record's
// Returns { rec, show }: show is the figures to draw, or null to draw the record.
function settleActive(p, key, prev, live, session, nowSec) {
  const st = session ? readSession(p, session.id) : null;
  try {
    if (st && st.api_ms === session.apiMs) {
      const replyAt = st.reply_at > nowSec + FUTURE ? 0 : st.reply_at;
      const later = prev && prev.fetched_at != null && prev.fetched_at > replyAt;
      return { rec: prev, show: later ? null : live };
    }
    if (st) {
      const rec = writeActive(p, key, prev, live, nowSec);
      writeSession(p, session.id, { api_ms: session.apiMs, reply_at: nowSec });
      return { rec: rec, show: live };
    }
    const isNew = !prev ||
      (newer(live.five, prev.five_hour) === live.five && newer(live.seven, prev.seven_day) === live.seven);
    const rec = isNew ? writeActive(p, key, prev, live, nowSec) : prev;
    if (session) {
      pruneSessions(p, nowSec);
      writeSession(p, session.id, { api_ms: session.apiMs, reply_at: isNew ? nowSec : 0 });
    }
    return { rec: rec, show: isNew ? live : null };
  } catch (e) {
    return { rec: prev, show: live }; // the state is an optimisation, never a dependency
  }
}

// The record as it stands at nowSec; the file is left alone. A passed 5h reset ends that
// window, and the next starts only when the account is used again, so its reset time is
// unknown. Weekly limits reset at a fixed weekly time.
function rollForward(c, nowSec) {
  if (!c) return null;
  const out = Object.assign({}, c);
  const f = c.five_hour;
  if (f && f.resets_at != null && f.resets_at <= nowSec) out.five_hour = { utilization: 0, resets_at: null };
  const s = c.seven_day;
  if (s && s.resets_at != null && s.resets_at <= nowSec) {
    const weeks = Math.floor((nowSec - s.resets_at) / WEEK) + 1;
    out.seven_day = { utilization: 0, resets_at: s.resets_at + weeks * WEEK };
  }
  if (Array.isArray(c.scoped)) {
    out.scoped = c.scoped.map(function (r) {
      if (!r || r.resets_at == null || r.resets_at > nowSec) return r;
      const weeks = Math.floor((nowSec - r.resets_at) / WEEK) + 1;
      return { name: r.name, utilization: 0, resets_at: r.resets_at + weeks * WEEK };
    });
  }
  return out;
}

// A stored time counts only while it is at most `span` old and not more than FUTURE seconds ahead: a
// clock that was ahead and got corrected would otherwise stop every check until it caught up.
function fresh(at, nowSec, span) {
  return at != null && nowSec - at <= span && at <= nowSec + FUTURE;
}

// The last attempt allows another check: 30 min after one that worked, 60 after a failure.
function attemptAllows(p, key, nowSec) {
  const a = readAttempt(p, key);
  return !(a && fresh(a.at, nowSec, a.ok ? RETRY_OK : RETRY_FAILED));
}

// Called on every render for each other account: the attempt file is read only once
// the record is old.
function fetchDue(p, key, c, nowSec) {
  if (c && fresh(c.fetched_at, nowSec, FETCH_AFTER)) return false;
  return attemptAllows(p, key, nowSec);
}

// The active account's own session keeps fetched_at fresh, so its checks (only for
// per-model rows) are paced by when a check last worked.
function checkDue(p, key, c, nowSec) {
  if (c && fresh(c.checked_at, nowSec, FETCH_AFTER)) return false;
  return attemptAllows(p, key, nowSec);
}

function spawnFetch(acct, env, mode) {
  try {
    const child = cp.spawn(process.execPath, [REFRESH_JS, acct.key, acct.dir].concat(mode === 'scoped' ? ['scoped'] : []), {
      detached: true,
      cwd: os.tmpdir(), // not the session's project: Windows would keep that folder in use
      stdio: 'ignore',
      windowsHide: true,
      env: env || process.env,
    });
    // A spawn that fails later reports through 'error'; unheard, it would crash the render.
    child.on('error', function () { /* the next render tries again */ });
    child.unref();
  } catch (e) { /* a failed check must never break the status line */ }
}

module.exports = {
  WRITE_MIN_INTERVAL, FETCH_AFTER, RETRY_OK, RETRY_FAILED, SESSION_TTL, FUTURE,
  file, attemptFile, accountDir, read, readAttempt, writeAttempt, writeRecord, writeActive,
  newer, sessionFile, readSession, writeSession, pruneSessions, settleActive,
  rollForward, fresh, attemptAllows, fetchDue, checkDue, spawnFetch,
};
