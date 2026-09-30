'use strict';
// Per-account quota cache: <stateDir>/cache/<key>.json.
//
// Other accounts are refreshed by a detached background process (stale-while-
// revalidate). The active account's live numbers arrive free on stdin and are
// written here too, so the moment you switch accounts the one you left shows the
// quota it really ended on.

const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const { writeFileAtomic } = require('./fsutil');

const WRITE_MIN_INTERVAL = 60; // seconds; unchanged numbers only refresh the timestamp this often
const REFRESH_JS = path.join(__dirname, 'refresh.js');

function file(p, key) { return path.join(p.cacheDir, key + '.json'); }

function read(p, key) {
  try { return JSON.parse(fs.readFileSync(file(p, key), 'utf8')); } catch (e) { return null; }
}

function sameSlot(a, b) {
  if (!a || !b) return !a && !b;
  return a.utilization === b.utilization && a.resets_at === b.resets_at;
}

function writeActive(p, key, prev, live, refresh, nowSec) {
  if (prev && sameSlot(prev.five_hour, live.five) && sameSlot(prev.seven_day, live.seven) &&
      prev.fetched_at != null && (nowSec - prev.fetched_at) < WRITE_MIN_INTERVAL) {
    return prev;
  }
  // Exactly 0% means nothing is using the 5h window: back off further.
  const idle = live.five && live.five.utilization === 0;
  const out = {
    key: key,
    status: 'ok',
    fetched_at: nowSec,
    checked_at: nowSec,
    next_attempt_at: nowSec + (idle ? refresh.idleSeconds : refresh.okSeconds),
    five_hour: live.five,
    seven_day: live.seven,
  };
  try {
    writeFileAtomic(file(p, key), JSON.stringify(out));
    return out;
  } catch (e) {
    return prev; // the cache is an optimisation, never a dependency
  }
}

function resetPassed(c, nowSec) {
  const f = c.five_hour;
  const s = c.seven_day;
  return !!((f && f.resets_at != null && f.resets_at <= nowSec) ||
    (s && s.resets_at != null && s.resets_at <= nowSec));
}

// A passed reset makes the cached percentage wrong, so refresh early, but keep a
// 30 s floor so a lagging API can't cause a spawn on every render.
function isDue(c, nowSec) {
  if (!c || !c.next_attempt_at || nowSec >= c.next_attempt_at) return true;
  return resetPassed(c, nowSec) && (nowSec - (c.checked_at || 0)) > 30;
}

function spawnRefresh(acct, env) {
  try {
    const child = cp.spawn(process.execPath, [REFRESH_JS, acct.key, acct.dir], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: env || process.env,
    });
    // A spawn that fails later reports through 'error'; unheard, it would crash the render.
    child.on('error', function () { /* the next render tries again */ });
    child.unref();
  } catch (e) { /* a failed refresh must never break the status line */ }
}

module.exports = { WRITE_MIN_INTERVAL, file, read, writeActive, resetPassed, isDue, spawnRefresh };
