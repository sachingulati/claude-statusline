'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const { tmpEnv, writeCache } = require('./helpers');
const cache = require('../src/cache');
const config = require('../src/config');

const REFRESH = config.DEFAULT_REFRESH;

test('writeActive writes live figures and sets next_attempt_at', () => {
  const t = tmpEnv();
  try {
    const out = cache.writeActive(t.p, 'A', null, { five: { utilization: 52, resets_at: 2000 }, seven: { utilization: 38, resets_at: 9000 } }, REFRESH, 1000);
    assert.equal(out.fetched_at, 1000);
    assert.equal(out.next_attempt_at, 1000 + REFRESH.okSeconds);
    assert.deepEqual(cache.read(t.p, 'A').five_hour, { utilization: 52, resets_at: 2000 });
  } finally { t.cleanup(); }
});

test('writeActive is throttled when nothing changed, immediate when a number moves', () => {
  const t = tmpEnv();
  try {
    const live = { five: { utilization: 52, resets_at: 2000 }, seven: null };
    const first = cache.writeActive(t.p, 'A', null, live, REFRESH, 1000);
    assert.equal(cache.writeActive(t.p, 'A', first, live, REFRESH, 1030), first);
    const moved = cache.writeActive(t.p, 'A', first, { five: { utilization: 53, resets_at: 2000 }, seven: null }, REFRESH, 1031);
    assert.equal(moved.fetched_at, 1031);
    const refreshed = cache.writeActive(t.p, 'A', moved, { five: { utilization: 53, resets_at: 2000 }, seven: null }, REFRESH, 1031 + 61);
    assert.equal(refreshed.fetched_at, 1092);
  } finally { t.cleanup(); }
});

test('idle (exactly 0%) backs off to idleSeconds', () => {
  const t = tmpEnv();
  try {
    const out = cache.writeActive(t.p, 'A', null, { five: { utilization: 0, resets_at: null }, seven: null }, REFRESH, 1000);
    assert.equal(out.next_attempt_at, 1000 + REFRESH.idleSeconds);
  } finally { t.cleanup(); }
});

test('isDue: missing, expired, not yet, and a passed reset', () => {
  assert.equal(cache.isDue(null, 1000), true);
  assert.equal(cache.isDue({ next_attempt_at: 900 }, 1000), true);
  assert.equal(cache.isDue({ next_attempt_at: 2000, checked_at: 990 }, 1000), false);
  assert.equal(cache.isDue({ next_attempt_at: 2000, checked_at: 900, five_hour: { resets_at: 950 } }, 1000), true);
  assert.equal(cache.isDue({ next_attempt_at: 2000, checked_at: 990, five_hour: { resets_at: 950 } }, 1000), false);
});

test('refresh.js records nocreds for a folder without credentials, in the env state dir', () => {
  const t = tmpEnv();
  try {
    const env = Object.assign({}, process.env, t.env);
    cp.execFileSync(process.execPath, [path.join(__dirname, '..', 'src', 'refresh.js'), 'X', path.join(t.home, 'none')], { env });
    const c = cache.read(t.p, 'X');
    assert.equal(c.status, 'nocreds');
    assert.ok(c.next_attempt_at > c.checked_at);
  } finally { t.cleanup(); }
});
