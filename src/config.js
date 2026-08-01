'use strict';
// Shared config + path resolution for the status line scripts.
//
// The *code* lives in this repo (run-in-place: settings.json points straight at
// src/statusline-command.sh, so `git pull` is the whole update). Everything
// personal or per-machine lives under ~/.claude and is never committed:
//
//   ~/.claude/statusline-accounts.json   which accounts + refresh tuning
//   ~/.claude/usage-cache/               background-fetched quota, per account
//   ~/.claude/statusline-hidden          presence = hide usage
//
// If statusline-accounts.json is absent we fall back to a single default
// account, so a fresh single-login machine works with zero config.

const fs = require('fs');
const path = require('path');

const HOME = process.env.HOME || process.env.USERPROFILE || '';
const DATA_DIR = path.join(HOME, '.claude');
const CONFIG_PATH = path.join(DATA_DIR, 'statusline-accounts.json');
const CACHE_DIR = path.join(DATA_DIR, 'usage-cache');
const HIDE_FLAG = path.join(DATA_DIR, 'statusline-hidden');

// Defaults are deliberately long: normally only one account is active at a time,
// so an inactive account's quota is essentially frozen. A rolled-over window
// forces an early refresh regardless, so staleness stays bounded.
const DEFAULT_REFRESH = {
  okSeconds: 1800,        // normal cadence
  idleSeconds: 3600,      // account sitting at exactly 0% -- nothing to watch
  errorSeconds: 240,      // after a transient failure, retry soon to recover
  rateLimitedSeconds: 1800, // after a 429; never shorter than okSeconds
};

function expandHome(p) {
  if (!p) return p;
  p = String(p);
  if (p === '~') return HOME;
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(HOME, p.slice(2));
  return p;
}

// Turn a display label into something safe for a cache filename.
function slug(s) {
  return String(s).replace(/[^A-Za-z0-9._-]/g, '_');
}

function load() {
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch (e) { /* fall back */ }

  let accounts = null;
  if (Array.isArray(raw.accounts) && raw.accounts.length) {
    accounts = raw.accounts.map(function (a, i) {
      const rawLabel = a && a.label != null ? String(a.label) : '';
      const label = rawLabel !== '' ? rawLabel : String(i + 1);
      return {
        label: label,
        key: slug(label) || ('acct' + i),
        dir: expandHome(a && (a.credsDir || a.dir)),
      };
    }).filter(function (a) { return a.dir; });
  }
  if (!accounts || !accounts.length) {
    // Zero-config: one account in the standard location, unlabelled (no prefix).
    accounts = [{ label: '', key: 'default', dir: DATA_DIR }];
  }

  const refresh = Object.assign({}, DEFAULT_REFRESH, raw.refresh || {});
  const marker = raw.hidden && raw.hidden.marker != null ? String(raw.hidden.marker) : 'hidden';

  // Pace model for the 7-day figure: which weekdays the weekly quota is spread
  // ("allotted") over. Default = all 7 days (even spread, matching the raw
  // calendar window). Set e.g. [1,2,3,4,5] for a Mon-Fri work week (0=Sun..6=Sat)
  // -- weekends then accrue no allocation, so the pace sits still across Sat/Sun.
  let workingDays = [0, 1, 2, 3, 4, 5, 6];
  if (raw.pace && Array.isArray(raw.pace.workingDays)) {
    const wd = Array.from(new Set(
      raw.pace.workingDays.map(Number).filter(function (n) { return n >= 0 && n <= 6; })
    ));
    if (wd.length) workingDays = wd;
  }

  return {
    accounts: accounts,
    refresh: refresh,
    hiddenMarker: marker,
    pace: { workingDays: workingDays },
  };
}

function isHidden() {
  try { return fs.existsSync(HIDE_FLAG); } catch (e) { return false; }
}

module.exports = {
  HOME: HOME,
  DATA_DIR: DATA_DIR,
  CONFIG_PATH: CONFIG_PATH,
  CACHE_DIR: CACHE_DIR,
  HIDE_FLAG: HIDE_FLAG,
  DEFAULT_REFRESH: DEFAULT_REFRESH,
  expandHome: expandHome,
  slug: slug,
  load: load,
  isHidden: isHidden,
};
