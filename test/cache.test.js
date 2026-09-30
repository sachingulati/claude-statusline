'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { tmpEnv } = require('./helpers');
const cache = require('../src/cache');

const WEEK = 7 * 86400;

test('writeActive records live figures, nothing about fetching', () => {
  const t = tmpEnv();
  try {
    const out = cache.writeActive(t.p, 'A', null, { five: { utilization: 52, resets_at: 2000 }, seven: { utilization: 38, resets_at: 9000 } }, 1000);
    assert.deepEqual(out, { key: 'A', status: 'ok', fetched_at: 1000,
      five_hour: { utilization: 52, resets_at: 2000 }, seven_day: { utilization: 38, resets_at: 9000 } });
    assert.deepEqual(cache.read(t.p, 'A'), out);
  } finally { t.cleanup(); }
});

test('writeActive is throttled when nothing changed, immediate when a number moves', () => {
  const t = tmpEnv();
  try {
    const live = { five: { utilization: 52, resets_at: 2000 }, seven: null };
    const first = cache.writeActive(t.p, 'A', null, live, 1000);
    assert.equal(cache.writeActive(t.p, 'A', first, live, 1030), first);
    const moved = cache.writeActive(t.p, 'A', first, { five: { utilization: 53, resets_at: 2000 }, seven: null }, 1031);
    assert.equal(moved.fetched_at, 1031);
    assert.equal(cache.writeActive(t.p, 'A', moved, { five: { utilization: 53, resets_at: 2000 }, seven: null }, 1092).fetched_at, 1092);
  } finally { t.cleanup(); }
});

test('rollForward: no record, nothing passed', () => {
  assert.equal(cache.rollForward(null, 1000), null);
  const c = { key: 'B', fetched_at: 900, five_hour: { utilization: 29, resets_at: 5000 }, seven_day: { utilization: 28, resets_at: 9000 } };
  assert.deepEqual(cache.rollForward(c, 1000), c);
});

test('rollForward: a passed 5h reset is an unstarted window', () => {
  const c = { fetched_at: 900, five_hour: { utilization: 29, resets_at: 1000 }, seven_day: { utilization: 28, resets_at: 9000 } };
  const r = cache.rollForward(c, 1000);
  assert.deepEqual(r.five_hour, { utilization: 0, resets_at: null });
  assert.deepEqual(r.seven_day, c.seven_day);
  assert.equal(r.fetched_at, 900);
  assert.equal(c.five_hour.utilization, 29); // the record itself is not changed
});

test('rollForward: a passed 7d reset moves on by whole weeks', () => {
  const once = cache.rollForward({ seven_day: { utilization: 60, resets_at: 1000 } }, 1000 + 3600);
  assert.deepEqual(once.seven_day, { utilization: 0, resets_at: 1000 + WEEK });
  const thrice = cache.rollForward({ seven_day: { utilization: 60, resets_at: 1000 } }, 1000 + 2 * WEEK + 5);
  assert.deepEqual(thrice.seven_day, { utilization: 0, resets_at: 1000 + 3 * WEEK });
});

test('rollForward: an idle 5h (no reset time) and a missing 7d stay as they are', () => {
  const c = { five_hour: { utilization: 0, resets_at: null } };
  assert.deepEqual(cache.rollForward(c, 1e9), { five_hour: { utilization: 0, resets_at: null } });
});

test('attempt file round-trips; a missing or broken one reads as null', () => {
  const t = tmpEnv();
  try {
    assert.equal(cache.readAttempt(t.p, 'B'), null);
    cache.writeAttempt(t.p, 'B', { at: 5, ok: false });
    assert.deepEqual(cache.readAttempt(t.p, 'B'), { at: 5, ok: false });
    assert.equal(cache.attemptFile(t.p, 'B'), path.join(t.p.cacheDir, 'B.attempt.json'));
    fs.writeFileSync(cache.attemptFile(t.p, 'B'), '{');
    assert.equal(cache.readAttempt(t.p, 'B'), null);
  } finally { t.cleanup(); }
});

test('accountDir stays inside <stateDir>/accounts, even for a label of dots', () => {
  const t = tmpEnv();
  try {
    assert.equal(t.p.accountsDir, path.join(t.p.stateDir, 'accounts'));
    assert.equal(cache.accountDir(t.p, 'B'), path.join(t.p.accountsDir, 'B'));
    for (const k of ['.', '..', '...']) {
      const d = cache.accountDir(t.p, k);
      assert.equal(path.dirname(d), t.p.accountsDir, k);
      assert.notEqual(path.basename(d), k, k);
    }
  } finally { t.cleanup(); }
});

test('fetchDue: record age first, then the last attempt (30 min after ok, 60 after a failure)', () => {
  const t = tmpEnv();
  try {
    const N = 100000;
    const due = rec => cache.fetchDue(t.p, 'B', rec, N);
    assert.equal(due(null), true);                                    // never recorded
    assert.equal(due({ status: 'auth', fetched_at: null }), true);    // 0.1.0 file without numbers
    assert.equal(due({ fetched_at: N - 1799 }), false);               // fresh
    assert.equal(due({ fetched_at: N + 50 }), false);                 // written after "now" (clock skew, a race)
    const old = { fetched_at: N - 1801 };
    assert.equal(due(old), true);
    cache.writeAttempt(t.p, 'B', { at: N - 1799, ok: true });
    assert.equal(due(old), false);
    cache.writeAttempt(t.p, 'B', { at: N - 1801, ok: true });
    assert.equal(due(old), true);
    cache.writeAttempt(t.p, 'B', { at: N - 59 * 60, ok: false });
    assert.equal(due(old), false);
    cache.writeAttempt(t.p, 'B', { at: N - 61 * 60, ok: false });
    assert.equal(due(old), true);
  } finally { t.cleanup(); }
});

test('newer: the later window wins; within one window, the higher figure', () => {
  const a = { utilization: 28, resets_at: 20000 };
  const b = { utilization: 75, resets_at: 20000 };
  assert.equal(cache.newer(a, b), b);
  assert.equal(cache.newer(b, a), b);
  assert.equal(cache.newer(a, { utilization: 28, resets_at: 20000 }), a); // a tie keeps the first
  const next = { utilization: 3, resets_at: 20000 + 5 * 3600 };
  assert.equal(cache.newer(next, b), next);
  assert.equal(cache.newer(b, next), next);
  const near = { utilization: 30, resets_at: 20030 }; // seconds apart: the same window
  assert.equal(cache.newer(a, near), near);
  assert.equal(cache.newer(near, a), near);
  assert.equal(cache.newer(null, b), b);
  assert.equal(cache.newer(a, null), a);
});

test('session state: an id that is not a plain name is never a file', () => {
  const t = tmpEnv();
  try {
    assert.equal(cache.sessionFile(t.p, 'ab-12_C'), path.join(t.p.sessionsDir, 'ab-12_C.json'));
    for (const bad of ['', '..', '../x', 'a/b', 'a\b', null, undefined]) assert.equal(cache.sessionFile(t.p, bad), null, String(bad));
    assert.equal(cache.readSession(t.p, 's1'), null);
    cache.writeSession(t.p, 's1', { api_ms: 5, reply_at: 9 });
    assert.deepEqual(cache.readSession(t.p, 's1'), { api_ms: 5, reply_at: 9 });
  } finally { t.cleanup(); }
});

test('pruneSessions: removes state files untouched for 2 days, keeps the rest', () => {
  const t = tmpEnv();
  try {
    const N = 1790000000;
    cache.writeSession(t.p, 'old', { api_ms: 1, reply_at: 1 });
    cache.writeSession(t.p, 'new', { api_ms: 1, reply_at: 1 });
    const oldAt = N - cache.SESSION_TTL - 60;
    fs.utimesSync(cache.sessionFile(t.p, 'old'), oldAt, oldAt);
    fs.utimesSync(cache.sessionFile(t.p, 'new'), N - 60, N - 60);
    cache.pruneSessions(t.p, N);
    assert.equal(cache.readSession(t.p, 'old'), null);
    assert.deepEqual(cache.readSession(t.p, 'new'), { api_ms: 1, reply_at: 1 });
  } finally { t.cleanup(); }
});

// Two sessions of one account: X is being used, Y sits idle and is redrawn with its last reply.
test('settleActive: only a reply is recorded; an idle redraw shows a record written after its reply', () => {
  const t = tmpEnv();
  try {
    const R = 50000;
    const stale = { five: { utilization: 28, resets_at: R }, seven: { utilization: 48, resets_at: R * 9 } };
    const fresh = { five: { utilization: 75, resets_at: R }, seven: { utilization: 54, resets_at: R * 9 } };
    // Y's first redraw: its numbers are recorded, with its reply's total.
    let s = cache.settleActive(t.p, 'A', null, stale, { id: 'Y', apiMs: 900 }, 1000);
    assert.deepEqual(s.show, stale);
    assert.equal(cache.read(t.p, 'A').five_hour.utilization, 28);
    // X gets a reply (its first redraw, higher in the same window): recorded.
    s = cache.settleActive(t.p, 'A', cache.read(t.p, 'A'), fresh, { id: 'X', apiMs: 100 }, 2000);
    assert.deepEqual(s.show, fresh);
    assert.equal(cache.read(t.p, 'A').five_hour.utilization, 75);
    // Y redraws with the same total: no reply, nothing written, and X's newer record is shown.
    s = cache.settleActive(t.p, 'A', cache.read(t.p, 'A'), stale, { id: 'Y', apiMs: 900 }, 2030);
    assert.equal(s.show, null);
    assert.equal(cache.read(t.p, 'A').five_hour.utilization, 75);
    assert.equal(cache.read(t.p, 'A').fetched_at, 2000);
    // X redraws with no new reply: its own numbers stand, nothing written.
    s = cache.settleActive(t.p, 'A', cache.read(t.p, 'A'), fresh, { id: 'X', apiMs: 100 }, 2090);
    assert.deepEqual(s.show, fresh);
    assert.equal(cache.read(t.p, 'A').fetched_at, 2000);
    // Y gets a reply: whatever it says is recorded, even a lower figure.
    const yReply = { five: { utilization: 70, resets_at: R }, seven: fresh.seven };
    s = cache.settleActive(t.p, 'A', cache.read(t.p, 'A'), yReply, { id: 'Y', apiMs: 950 }, 3000);
    assert.deepEqual(s.show, yReply);
    assert.equal(cache.read(t.p, 'A').five_hour.utilization, 70);
    assert.deepEqual(cache.readSession(t.p, 'Y'), { api_ms: 950, reply_at: 3000 });
  } finally { t.cleanup(); }
});

test('settleActive: a session seen first with older numbers than the record writes nothing', () => {
  const t = tmpEnv();
  try {
    const R = 50000;
    const rec = cache.writeRecord(t.p, 'A', { utilization: 75, resets_at: R }, { utilization: 54, resets_at: R * 9 }, 2000);
    const stale = { five: { utilization: 28, resets_at: R }, seven: { utilization: 48, resets_at: R * 9 } };
    const s = cache.settleActive(t.p, 'A', rec, stale, { id: 'Y', apiMs: 900 }, 2030);
    assert.equal(s.show, null);
    assert.deepEqual(cache.read(t.p, 'A'), rec);
    assert.deepEqual(cache.readSession(t.p, 'Y'), { api_ms: 900, reply_at: 0 });
    // Nothing to tell replies apart by (no id or no total): the window rule every time.
    assert.equal(cache.settleActive(t.p, 'A', rec, stale, null, 2040).show, null);
    const next = { five: { utilization: 2, resets_at: R + 5 * 3600 }, seven: rec.seven_day };
    assert.deepEqual(cache.settleActive(t.p, 'A', rec, next, null, 2050).show, next);
    assert.equal(cache.read(t.p, 'A').five_hour.utilization, 2);
  } finally { t.cleanup(); }
});

test('guard c: a record or attempt dated over 5 min in the future means a check is due', () => {
  const t = tmpEnv();
  try {
    const now = 1790000000;
    assert.equal(cache.fetchDue(t.p, 'B', { fetched_at: now + 86400 }, now), true);
    assert.equal(cache.fetchDue(t.p, 'B', { fetched_at: now + 60 }, now), false); // small skew is fine
    cache.writeAttempt(t.p, 'B', { at: now + 86400, ok: true });
    assert.equal(cache.fetchDue(t.p, 'B', null, now), true);
    cache.writeAttempt(t.p, 'B', { at: now - 60, ok: true });
    assert.equal(cache.fetchDue(t.p, 'B', null, now), false);
  } finally { t.cleanup(); }
});

test('guard c: a session reply_at in the future is treated as 0', () => {
  const t = tmpEnv();
  try {
    const live = { five: { utilization: 40, resets_at: 50000 }, seven: null };
    cache.settleActive(t.p, 'A', null, live, { id: 'Z', apiMs: 5 }, 1000);
    fs.writeFileSync(path.join(t.p.sessionsDir, 'Z.json'), JSON.stringify({ api_ms: 5, reply_at: 99999999 }));
    const rec = cache.writeRecord(t.p, 'A', { utilization: 60, resets_at: 50000 }, null, 1100);
    const s = cache.settleActive(t.p, 'A', rec, live, { id: 'Z', apiMs: 5 }, 1200);
    assert.equal(s.show, null); // the record (1100) is later than a reply at "0"
  } finally { t.cleanup(); }
});

test('scoped rows: writeActive keeps them and checked_at; rollForward rolls them by whole weeks', () => {
  const t = tmpEnv();
  try {
    const R = 100000;
    cache.writeRecord(t.p, 'A', null, null, 500, { scoped: [{ name: 'Fable', utilization: 42, resets_at: R }], checked_at: 500 });
    const live = { five: { utilization: 10, resets_at: R }, seven: { utilization: 20, resets_at: R } };
    const rec = cache.writeActive(t.p, 'A', cache.read(t.p, 'A'), live, 900);
    assert.deepEqual(rec.scoped, [{ name: 'Fable', utilization: 42, resets_at: R }]);
    assert.equal(rec.checked_at, 500);
    const rolled = cache.rollForward(rec, R + 10);
    assert.deepEqual(rolled.scoped, [{ name: 'Fable', utilization: 0, resets_at: R + WEEK }]);
  } finally { t.cleanup(); }
});

test('checkDue: paced by checked_at, not by fetched_at', () => {
  const t = tmpEnv();
  try {
    const now = 1790000000;
    assert.equal(cache.checkDue(t.p, 'A', { fetched_at: now, checked_at: now - 3600 }, now), true);
    assert.equal(cache.checkDue(t.p, 'A', { fetched_at: now, checked_at: now - 60 }, now), false);
    assert.equal(cache.checkDue(t.p, 'A', { fetched_at: now }, now), true);
  } finally { t.cleanup(); }
});
