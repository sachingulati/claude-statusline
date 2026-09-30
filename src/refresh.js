#!/usr/bin/env node
'use strict';
// Fetch live rate-limit usage for ONE Claude account and cache it.
//
//   node refresh.js <key> <credentials-dir>
//
// Called detached by cache.js during a render; never runs in the status line's
// critical path. Writes <cache-dir>/<key>.json atomically.
//
// GET /api/oauth/usage is the same endpoint the /usage command reads. It is a
// plain read: it does NOT consume model quota. It is also undocumented/internal
// and may change in a future Claude Code release -- failure degrades to a stale
// or "usage:--" line, never a broken status line.
//
// Note on 401: we deliberately do NOT refresh the OAuth token here. Doing so
// rotates the refresh token and rewrites .credentials.json, which a live
// session for that account owns -- racing it can break auth. We surface
// 'auth' instead and let a real session re-authenticate.

const fs = require('fs');
const path = require('path');
const https = require('https');
const paths = require('./paths');
const config = require('./config');

const P = paths.resolve(process.env);
const KEY = process.argv[2];
const CREDS_DIR = paths.expandHome(process.argv[3], P.home);
if (!KEY || !CREDS_DIR) process.exit(1);

const cfg = config.load(P);
const CACHE_DIR = P.cacheDir;
const CACHE = path.join(CACHE_DIR, KEY + '.json');
const LOCK = path.join(CACHE_DIR, KEY + '.lock');

const OK_INTERVAL = cfg.refresh.okSeconds;
const IDLE_INTERVAL = cfg.refresh.idleSeconds;
const ERR_INTERVAL = cfg.refresh.errorSeconds;
const RL_INTERVAL = cfg.refresh.rateLimitedSeconds;
const LOCK_STALE = 60;   // a lock older than this is assumed abandoned
const TIMEOUT_MS = 10000;

fs.mkdirSync(CACHE_DIR, { recursive: true });

// --- Lock: mkdir is atomic on every platform we care about. -----------------
try {
  fs.mkdirSync(LOCK);
} catch (e) {
  try {
    const age = (Date.now() - fs.statSync(LOCK).mtimeMs) / 1000;
    if (age < LOCK_STALE) process.exit(0); // a refresh is already in flight
    fs.rmdirSync(LOCK);
    fs.mkdirSync(LOCK);
  } catch (e2) {
    process.exit(0);
  }
}
process.on('exit', () => { try { fs.rmdirSync(LOCK); } catch (e) {} });

function readCache() {
  try { return JSON.parse(fs.readFileSync(CACHE, 'utf8')); } catch (e) { return {}; }
}

// Preserve the last good numbers on failure so the status line keeps showing
// something real; only the age tag grows.
//
// Deliberately does NOT call process.exit(): tearing the process down while a
// socket handle is still closing trips a libuv assertion on Windows
// ("!(handle->flags & UV_HANDLE_CLOSING)"). We let the event loop drain instead,
// which it can because the request uses agent:false (no keep-alive pool).
let done = false;
function finish(status, nextIn, data) {
  if (done) return;
  done = true;
  const prev = readCache();
  const now = Math.floor(Date.now() / 1000);
  const out = {
    key: KEY,
    status: status,
    fetched_at: data ? now : (prev.fetched_at != null ? prev.fetched_at : null),
    checked_at: now,
    next_attempt_at: now + nextIn,
    five_hour: data ? data.five_hour : (prev.five_hour || null),
    seven_day: data ? data.seven_day : (prev.seven_day || null),
  };
  const tmp = CACHE + '.tmp' + process.pid;
  try {
    fs.writeFileSync(tmp, JSON.stringify(out));
    fs.renameSync(tmp, CACHE);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch (e2) {}
  }
}

// resets_at comes back as ISO; the renderer works in epoch seconds.
function pick(o) {
  if (!o) return null;
  return {
    utilization: o.utilization,
    resets_at: o.resets_at ? Math.floor(new Date(o.resets_at).getTime() / 1000) : null,
  };
}

function main() {
  let token = null;
  try {
    const raw = fs.readFileSync(path.join(CREDS_DIR, '.credentials.json'), 'utf8');
    token = JSON.parse(raw).claudeAiOauth.accessToken;
  } catch (e) {
    return finish('nocreds', ERR_INTERVAL, null);
  }
  if (!token) return finish('nocreds', ERR_INTERVAL, null);

  const req = https.request({
    hostname: 'api.anthropic.com',
    path: '/api/oauth/usage',
    method: 'GET',
    agent: false, // no keep-alive pool, so the process can exit on its own
    timeout: TIMEOUT_MS,
    headers: {
      'Authorization': 'Bearer ' + token,
      'anthropic-beta': 'oauth-2025-04-20',
      'User-Agent': 'claude-cli-sline',
      'Accept': 'application/json',
    },
  }, function (res) {
    let body = '';
    res.setEncoding('utf8');
    res.on('data', function (c) { body += c; });
    res.on('end', function () {
      const code = res.statusCode;
      if (code === 401 || code === 403) return finish('auth', ERR_INTERVAL, null);
      if (code === 429) return finish('ratelimited', RL_INTERVAL, null);
      if (code < 200 || code >= 300) return finish('error', ERR_INTERVAL, null);
      try {
        const j = JSON.parse(body);
        const data = { five_hour: pick(j.five_hour), seven_day: pick(j.seven_day) };
        // Exactly 0% means the account is idle: nothing is consuming the 5h
        // window, and the API reports resets_at:null because there's no window
        // in flight. Polling that every few minutes is pure waste, so back well
        // off. Anything that would move the number happens in that account's own
        // session, and a rolled-over 7d window still forces an early refresh.
        // Strict === 0 on purpose: 0.4% renders as "0%" but is genuinely in use.
        const idle = data.five_hour && data.five_hour.utilization === 0;
        finish('ok', idle ? IDLE_INTERVAL : OK_INTERVAL, data);
      } catch (e) {
        finish('error', ERR_INTERVAL, null);
      }
    });
  });

  req.on('timeout', function () { req.destroy(); });
  req.on('error', function () { finish('error', ERR_INTERVAL, null); });
  req.end();
}

main();
