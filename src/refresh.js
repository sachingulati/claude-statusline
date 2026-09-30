#!/usr/bin/env node
'use strict';
// Background check of ONE other account's usage, through Claude Code's own /usage.
//
//   node refresh.js <key> <login-dir>
//
// Started detached by cache.spawnFetch when that account's record is more than 30
// minutes old; the status line never waits for it. sline reads no credential and makes
// no network call: Claude Code runs under the account's own login
// (CLAUDE_SECURESTORAGE_CONFIG_DIR) with a config folder of its own
// (<stateDir>/accounts/<key>), because Claude Code takes the account's identity and
// caches /usage in its config folder: shared with another account, it reports that
// account's numbers.

const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const paths = require('./paths');
const cache = require('./cache');
const usage = require('./usage');

const LOCK_STALE = 90; // seconds; longer than one run (60 s timeout), so an older lock was abandoned
const TIMEOUT_MS = 60000;

// mkdir is atomic on every platform we care about.
function lock(dir) {
  try { fs.mkdirSync(dir); return true; } catch (e) { /* held, or abandoned */ }
  try {
    if ((Date.now() - fs.statSync(dir).mtimeMs) / 1000 < LOCK_STALE) return false;
    fs.rmdirSync(dir);
    fs.mkdirSync(dir);
    return true;
  } catch (e) {
    return false;
  }
}

function childEnv(env, configDir, loginDir) {
  const out = Object.assign({}, env, { CLAUDE_CONFIG_DIR: configDir, CLAUDE_SECURESTORAGE_CONFIG_DIR: loginDir });
  // Started from inside a session, Claude Code would think it is nested in one.
  delete out.CLAUDECODE;
  delete out.CLAUDE_CODE_ENTRYPOINT;
  // These beat the login in CLAUDE_SECURESTORAGE_CONFIG_DIR: with them, the check would
  // get no numbers, or another account's.
  ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN',
    'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX'].forEach(function (k) { delete out[k]; });
  return out;
}

// 'locked', 'fresh', 'noclaude', 'nodata' or 'ok'.
function run(key, loginDir, env, opts) {
  opts = opts || {};
  const p = paths.resolve(env);
  fs.mkdirSync(p.cacheDir, { recursive: true });
  const lockDir = path.join(p.cacheDir, key + '.lock');
  if (!lock(lockDir)) return 'locked';
  try {
    const start = Math.floor(Date.now() / 1000);
    // Several sessions can start a runner in the moment before the first one writes its
    // attempt; one that gets the lock after another finished has nothing left to do.
    if (!cache.fetchDue(p, key, cache.read(p, key), start)) return 'fresh';
    // First, so a crash or a hang still counts as a failed attempt.
    cache.writeAttempt(p, key, { at: start, ok: false });
    const cmd = usage.command(env, process.platform);
    if (!cmd) return 'noclaude';
    const configDir = cache.accountDir(p, key);
    fs.mkdirSync(configDir, { recursive: true });
    const r = cp.spawnSync(cmd.file, cmd.args, {
      // Not the session's project: its hooks and MCP servers must not run for a check.
      cwd: configDir,
      env: childEnv(env, configDir, loginDir),
      encoding: 'utf8',
      timeout: opts.timeoutMs || TIMEOUT_MS,
      windowsHide: true,
    });
    const got = r.error ? null : usage.parse(r.stdout);
    if (!got) return 'nodata';
    const now = Math.floor(Date.now() / 1000);
    const cur = cache.read(p, key);
    // A session of this account recorded live numbers while we waited: those are newer.
    if (!(cur && cur.fetched_at != null && cur.fetched_at > start)) {
      cache.writeRecord(p, key, got.five_hour, got.seven_day, now);
    }
    cache.writeAttempt(p, key, { at: now, ok: true });
    return 'ok';
  } finally {
    try { fs.rmdirSync(lockDir); } catch (e) { /* already gone */ }
  }
}

if (require.main === module) {
  const env = process.env;
  const key = process.argv[2];
  const loginDir = paths.expandHome(process.argv[3], paths.homeDir(env));
  if (key && loginDir) {
    try { run(key, loginDir, env); } catch (e) { /* the attempt file already says it failed */ }
  }
}

module.exports = { run, LOCK_STALE };
