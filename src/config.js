'use strict';
// config.json: accounts, display, pace, refresh cadence, hidden marker.
//
// load() is used by the status line and must never throw: a broken file falls back
// to defaults. The CLI uses readRaw()/set(), which refuse to overwrite a broken file.

const fs = require('fs');
const path = require('path');
const { expandHome, normPath, toForward } = require('./paths');
const { UserError, readJson, writeJsonAtomic } = require('./fsutil');
const T = require('./template');
const F = require('./format');
const L = require('./lines');

// Deliberately long: normally only one account is active at a time, so the others'
// quota is essentially frozen. A rolled-over window forces an early refresh anyway.
const DEFAULT_REFRESH = {
  okSeconds: 1800,
  idleSeconds: 3600,
  errorSeconds: 240,
  rateLimitedSeconds: 1800,
};
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

function slug(s) {
  return String(s).replace(/[^A-Za-z0-9._-]/g, '_');
}

function readRaw(p) {
  let raw;
  try {
    raw = readJson(p.configFile, {});
  } catch (e) {
    throw new UserError('config.json is not valid JSON: ' + e.message,
      'Fix or delete ' + p.configFile);
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new UserError('config.json must hold a JSON object ({ ... })', 'Fix or delete ' + p.configFile);
  }
  return raw;
}

// Parses the value of `key`, or returns undefined when it's missing or invalid.
function tryParse(key, value) {
  if (value === undefined) return undefined;
  try { return KEYS[key].parse(value); } catch (e) { return undefined; }
}

function normalize(raw, p) {
  let accounts = [];
  if (Array.isArray(raw.accounts)) {
    accounts = raw.accounts.map(function (a, i) {
      const rawLabel = a && a.label != null ? String(a.label) : '';
      const label = rawLabel !== '' ? rawLabel : String(i + 1);
      return { label: label, key: slug(label) || ('acct' + i), dir: expandHome(a && (a.credsDir || a.dir), p.home) };
    }).filter(function (a) { return a.dir; });
  }
  if (!accounts.length) accounts = [{ label: '', key: 'default', dir: p.claudeDir }];

  // A hand-edited value that doesn't parse falls back to its default, as `config set` would refuse it.
  const workingDays = tryParse('pace.workingDays', raw.pace && raw.pace.workingDays) || ALL_DAYS;
  const rawRefresh = raw.refresh && typeof raw.refresh === 'object' ? raw.refresh : {};
  const refresh = Object.assign({}, DEFAULT_REFRESH, rawRefresh);
  Object.keys(DEFAULT_REFRESH).forEach(function (k) {
    const v = tryParse('refresh.' + k, rawRefresh[k]);
    refresh[k] = v !== undefined ? v : DEFAULT_REFRESH[k];
  });

  return {
    accounts: accounts,
    refresh: refresh,
    pace: { workingDays: workingDays },
    display: normalizeDisplay(raw),
    hiddenMarker: raw.hidden && raw.hidden.marker != null ? String(raw.hidden.marker) : 'hidden',
    ignoredDirs: (Array.isArray(raw.ignoredDirs) ? raw.ignoredDirs : [])
      .map(function (d) { return expandHome(d, p.home); }),
  };
}

function load(p) {
  let raw = {};
  try { raw = readRaw(p); } catch (e) { raw = {}; }
  return normalize(raw, p);
}

// A hand-edited template that doesn't parse draws the default (with a hint); one naming an
// unknown field is kept, and the field prints as typed. Both are reported by doctor.
function loadTemplate(which, value, problems) {
  const key = 'display.' + which;
  const def = L.defaultDisplay().templates[which];
  if (value === undefined) return def;
  const r = T.parse(value);
  if (r.error) {
    problems.push({ key: key, message: key + ': ' + r.error.message + ' at column ' + r.error.column, fix: r.error.fix });
    return { parts: def.parts, broken: true };
  }
  T.fields(r.parts).forEach(function (f) {
    if (L.FIELDS[which].indexOf(f.name) === -1) {
      problems.push({
        key: key,
        message: key + ': unknown field {' + f.name + '} at column ' + f.column + ' (shown as typed)',
        fix: 'Fields here: ' + L.FIELDS[which].join(', '),
      });
    }
  });
  return { parts: r.parts, broken: false };
}

// Never throws: each bad value falls back to its default and is recorded in problems.
function normalizeDisplay(raw) {
  const r = raw.display && typeof raw.display === 'object' ? raw.display : {};
  const d = L.defaultDisplay();
  const pick = function (key, value, def) {
    if (value === undefined) return def;
    try { return KEYS[key].parse(value); } catch (e) {
      d.problems.push({ key: key, message: key + ': ' + e.message,
        fix: e.fix || 'Set it again with /sline:config, or remove it from config.json' });
      return def;
    }
  };
  d.otherAccounts = pick('display.otherAccounts', r.otherAccounts, true);
  ['line1', 'label', 'account', 'subagent'].forEach(function (w) { d.templates[w] = loadTemplate(w, r[w], d.problems); });
  d.separator = pick('display.separator', r.separator, d.separator);
  const th = r.thresholds && typeof r.thresholds === 'object' ? r.thresholds : {};
  Object.keys(d.thresholds).forEach(function (k) { d.thresholds[k] = pick('display.thresholds.' + k, th[k], d.thresholds[k]); });
  const co = r.colors && typeof r.colors === 'object' ? r.colors : {};
  Object.keys(d.colors).forEach(function (k) { d.colors[k] = pick('display.colors.' + k, co[k], d.colors[k]); });
  d.clock = pick('display.clock', r.clock, d.clock);
  return d;
}

function parseBool(v) {
  const s = String(v).toLowerCase();
  if (['true', 'on', 'yes', '1'].includes(s)) return true;
  if (['false', 'off', 'no', '0'].includes(s)) return false;
  throw new UserError('Expected true or false, got "' + v + '"');
}

// A whole number written as a number or as digits. '', true, [5] and 1.5 are not.
function wholeNumber(v) {
  if (typeof v === 'number') return Number.isInteger(v) ? v : NaN;
  if (typeof v === 'string' && /^\s*-?\d+\s*$/.test(v)) return Number(v);
  return NaN;
}

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

// 0-6 (0 = Sunday), or a name or its first three or more letters: mon, tues, Thursday.
function dayNumber(t) {
  const n = wholeNumber(t);
  if (n >= 0 && n <= 6) return n;
  const s = typeof t === 'string' ? t.trim().toLowerCase() : '';
  return s.length >= 3 ? DAY_NAMES.findIndex(function (d) { return d.startsWith(s); }) : -1;
}

// Days as numbers or names, with ranges: 1,2,3,4,5 or mon-fri; fri-mon wraps past Sunday.
function parseDays(v) {
  const parts = Array.isArray(v) ? v : String(v).split(/[\s,]+/).filter(Boolean);
  const days = [];
  const ok = parts.length > 0 && parts.every(function (t) {
    const range = typeof t === 'string' && /^([^-]+)-([^-]+)$/.exec(t.trim());
    if (!range) {
      const d = dayNumber(t);
      if (d >= 0) days.push(d);
      return d >= 0;
    }
    const a = dayNumber(range[1]);
    const b = dayNumber(range[2]);
    if (a < 0 || b < 0) return false;
    for (let d = a; ; d = (d + 1) % 7) { days.push(d); if (d === b) break; }
    return true;
  });
  if (!ok) {
    throw new UserError('Expected days as 0-6 (0 = Sunday) or names, e.g. 1,2,3,4,5 or mon-fri; got "' + v + '"');
  }
  return Array.from(new Set(days)).sort(function (a, b) { return a - b; });
}

function intMin(min) {
  return function (v) {
    const n = wholeNumber(v);
    if (!Number.isInteger(n) || n < min) {
      throw new UserError('Expected a whole number of seconds >= ' + min + ', got "' + v + '"');
    }
    return n;
  };
}

function templateKey(which) {
  return function (v) {
    const e = T.check(v, L.FIELDS[which]);
    if (e) throw new UserError('display.' + which + ': ' + e.message + ' at column ' + e.column, e.fix);
    return v;
  };
}

function parseSeparator(v) {
  if (typeof v !== 'string' || v === '') throw new UserError('Expected some text for the separator, e.g. " · " or " | "');
  return v;
}

function parsePair(v) {
  const parts = Array.isArray(v) ? v : String(v).split(/[\s,]+/).filter(Boolean);
  const n = parts.map(wholeNumber);
  if (n.length !== 2 || n.some(function (x) { return !Number.isInteger(x) || x < 0 || x > 100; }) || n[0] > n[1]) {
    throw new UserError('Expected two whole numbers 0-100, low first, e.g. 30,75; got "' + v + '"');
  }
  return n;
}

function wholeAtLeast0(unit) {
  return function (v) {
    const n = wholeNumber(v);
    if (!Number.isInteger(n) || n < 0) {
      throw new UserError('Expected a whole number of ' + unit + ' >= 0 (0 = off), got "' + v + '"');
    }
    return n;
  };
}

function parseColor(v) {
  if (F.colorCode(v) == null) {
    throw new UserError('Unknown colour "' + v + '"',
      'Use a name (' + Object.keys(F.COLOR_NAMES).join(', ') + '), a number 0-255, #rrggbb, or none');
  }
  return typeof v === 'number' ? v : String(v).toLowerCase();
}

function parseClock(v) {
  const s = String(v).toLowerCase();
  if (s === '12h' || s === '12') return '12h';
  if (s === '24h' || s === '24') return '24h';
  throw new UserError('Expected 12h or 24h, got "' + v + '"');
}

const KEYS = {
  'display.otherAccounts': { parse: parseBool, def: true },
  'pace.workingDays': { parse: parseDays, def: ALL_DAYS },
  'refresh.okSeconds': { parse: intMin(60), def: DEFAULT_REFRESH.okSeconds },
  'refresh.idleSeconds': { parse: intMin(60), def: DEFAULT_REFRESH.idleSeconds },
  'refresh.errorSeconds': { parse: intMin(30), def: DEFAULT_REFRESH.errorSeconds },
  'refresh.rateLimitedSeconds': { parse: intMin(60), def: DEFAULT_REFRESH.rateLimitedSeconds },
  'hidden.marker': { parse: String, def: 'hidden' },
  'display.line1': { parse: templateKey('line1'), def: L.DEFAULT_TEMPLATES.line1 },
  'display.label': { parse: templateKey('label'), def: L.DEFAULT_TEMPLATES.label },
  'display.account': { parse: templateKey('account'), def: L.DEFAULT_TEMPLATES.account },
  'display.subagent': { parse: templateKey('subagent'), def: L.DEFAULT_TEMPLATES.subagent },
  'display.separator': { parse: parseSeparator, def: L.DEFAULT_DISPLAY.separator },
  'display.thresholds.7dPace': { parse: parseBool, def: L.DEFAULT_DISPLAY.thresholds['7dPace'] },
  'display.thresholds.5hResetSoon': { parse: wholeAtLeast0('minutes'), def: L.DEFAULT_DISPLAY.thresholds['5hResetSoon'] },
  'display.thresholds.7dResetSoon': { parse: wholeAtLeast0('hours'), def: L.DEFAULT_DISPLAY.thresholds['7dResetSoon'] },
  'display.clock': { parse: parseClock, def: L.DEFAULT_DISPLAY.clock },
};
['ctx', '5h', '7d', 'spend'].forEach(function (k) {
  KEYS['display.thresholds.' + k] = { parse: parsePair, def: L.DEFAULT_DISPLAY.thresholds[k] };
});
['ok', 'warn', 'high', 'dim'].forEach(function (k) {
  KEYS['display.colors.' + k] = { parse: parseColor, def: L.DEFAULT_DISPLAY.colors[k] };
});

function getPath(obj, key) {
  return key.split('.').reduce(function (o, k) { return o && o[k] !== undefined ? o[k] : undefined; }, obj);
}

function setPath(obj, key, value) {
  const ks = key.split('.');
  let o = obj;
  for (let i = 0; i < ks.length - 1; i++) {
    if (typeof o[ks[i]] !== 'object' || o[ks[i]] === null) o[ks[i]] = {};
    o = o[ks[i]];
  }
  o[ks[ks.length - 1]] = value;
}

function set(p, key, value) {
  const spec = KEYS[key];
  if (!spec) {
    throw new UserError('Unknown setting "' + key + '"',
      'Settable keys: ' + Object.keys(KEYS).concat('refreshInterval').join(', '));
  }
  const parsed = spec.parse(value);
  const raw = readRaw(p);
  setPath(raw, key, parsed);
  writeJsonAtomic(p.configFile, raw);
  return parsed;
}

function listAccounts(p) {
  return normalize(readRaw(p), p).accounts.map(function (a) {
    return { label: a.label, credsDir: a.dir, hasCredentials: fs.existsSync(path.join(a.dir, '.credentials.json')) };
  });
}

function show(p) {
  const raw = readRaw(p);
  // The value in use: a hand-edited one that doesn't parse shows as the default it falls
  // back to. A template naming an unknown field is still used (the field prints as typed).
  const rows = Object.keys(KEYS).map(function (key) {
    const v = getPath(raw, key);
    if (v === undefined) return { key: key, value: KEYS[key].def, origin: 'default' };
    const tpl = /^display\.(line1|label|account|subagent)$/.test(key);
    const parsed = tpl ? (T.parse(v).error ? undefined : v) : tryParse(key, v);
    return parsed !== undefined
      ? { key: key, value: parsed, origin: 'config.json' }
      : { key: key, value: KEYS[key].def, origin: 'default, config.json has invalid ' + JSON.stringify(v) };
  });
  return { rows: rows, accounts: listAccounts(p), sample: L.sampleLines(normalize(raw, p).display) };
}

// Back to the default look; which accounts show is /sline:usage's business.
function resetDisplay(p) {
  const raw = readRaw(p);
  if (raw.display && typeof raw.display === 'object' && raw.display.otherAccounts !== undefined) {
    raw.display = { otherAccounts: raw.display.otherAccounts };
  } else {
    delete raw.display;
  }
  writeJsonAtomic(p.configFile, raw);
  return { reset: 'display' };
}

function addAccount(p, label, credsDir) {
  label = String(label || '').trim();
  credsDir = String(credsDir || '').trim();
  if (!label || !credsDir) throw new UserError('Usage: config account add <label> <credsDir>');
  // Stored the way render registers folders (clean, ~/ under home), so both find it again.
  let clean = path.normalize(expandHome(credsDir, p.home));
  if (clean.length > path.parse(clean).root.length) clean = clean.replace(/[\\/]+$/, '');
  credsDir = toTilde(clean, p.home);
  const raw = readRaw(p);
  const list = Array.isArray(raw.accounts) ? raw.accounts : [];
  if (list.some(function (a) { return a && String(a.label) === label; })) {
    throw new UserError('Account "' + label + '" already exists', 'Remove it first, or pick another label');
  }
  list.push({ label: label, credsDir: credsDir });
  raw.accounts = list;
  const dir = expandHome(credsDir, p.home);
  if (Array.isArray(raw.ignoredDirs)) {
    raw.ignoredDirs = raw.ignoredDirs.filter(function (d) { return normPath(expandHome(d, p.home)) !== normPath(dir); });
  }
  writeJsonAtomic(p.configFile, raw);
  const warning = fs.existsSync(path.join(dir, '.credentials.json')) ? ''
    : 'No .credentials.json in ' + dir + ' yet. Log in as that account: CLAUDE_SECURESTORAGE_CONFIG_DIR="' +
      toForward(dir) + '" claude, then /login';
  return { label: label, credsDir: credsDir, warning: warning };
}

function findAccount(raw, label) {
  const list = Array.isArray(raw.accounts) ? raw.accounts : [];
  const i = list.findIndex(function (a) { return a && String(a.label) === String(label); });
  if (i === -1) throw new UserError('No account labelled "' + label + '"', 'See the labels with /sline:config');
  return { list: list, i: i };
}

function renameAccount(p, label, newLabel) {
  newLabel = String(newLabel || '').trim();
  if (!newLabel) throw new UserError('Usage: config account rename <label> <new label>');
  const raw = readRaw(p);
  const f = findAccount(raw, label);
  if (f.list.some(function (a) { return a && String(a.label) === newLabel; })) {
    throw new UserError('Account "' + newLabel + '" already exists', 'Pick another label');
  }
  f.list[f.i].label = newLabel;
  writeJsonAtomic(p.configFile, raw);
  // The cache file is named after the label; carry the numbers over.
  try { fs.renameSync(path.join(p.cacheDir, slug(label) + '.json'), path.join(p.cacheDir, slug(newLabel) + '.json')); } catch (e) { /* no cache yet */ }
  return { label: String(label), newLabel: newLabel };
}

// Remove an account and remember its folder, so render doesn't register it again.
function forgetAccount(p, label) {
  const raw = readRaw(p);
  const f = findAccount(raw, label);
  const credsDir = f.list[f.i].credsDir || f.list[f.i].dir;
  f.list.splice(f.i, 1);
  raw.accounts = f.list;
  const ignored = Array.isArray(raw.ignoredDirs) ? raw.ignoredDirs : [];
  if (credsDir && !ignored.some(function (d) { return normPath(expandHome(d, p.home)) === normPath(expandHome(credsDir, p.home)); })) {
    ignored.push(credsDir);
  }
  raw.ignoredDirs = ignored;
  writeJsonAtomic(p.configFile, raw);
  return { label: String(label), credsDir: credsDir };
}

// ~/... when the folder is under home, so config.json stays readable and portable.
function toTilde(dir, home) {
  const d = normPath(dir);
  const h = normPath(home);
  if (d === h) return '~';
  if (d.startsWith(h + '/')) return '~/' + toForward(dir).replace(/^\/([a-zA-Z])\//, '$1:/').slice(h.length + 1);
  return toForward(dir);
}

function nextLabel(used) {
  for (let i = 0; i < 26; i++) {
    const l = String.fromCharCode(65 + i);
    if (!used.has(l)) return l;
  }
  for (let n = 27; ; n++) if (!used.has(String(n))) return String(n);
}

// Render calls this on every line with the loaded config, so it must not touch the disk.
function knows(cfg, dir) {
  const want = normPath(dir);
  const same = function (d) { return normPath(d) === want; };
  return cfg.accounts.some(function (a) { return same(a.dir); }) || cfg.ignoredDirs.some(same);
}

// Render calls this when a session's login folder is new (spec §3a).
function registerFolder(p, dir) {
  // Store the clean spelling: load() normalizes what it reads, so a stored "~//x"
  // would never match again and the folder would register on every render.
  dir = path.normalize(expandHome(String(dir), p.home));
  const raw = readRaw(p);
  const cfg = normalize(raw, p);
  const want = normPath(dir);
  const configured = Array.isArray(raw.accounts) && raw.accounts.length > 0;
  if (configured && cfg.accounts.some(function (a) { return normPath(a.dir) === want; })) return { added: [] };
  if (cfg.ignoredDirs.some(function (d) { return normPath(d) === want; })) return { added: [] };
  // Zero-config already shows the default login.
  if (!configured && want === normPath(p.claudeDir)) return { added: [] };

  const list = configured ? raw.accounts : [];
  const used = new Set(list.map(function (a) { return String(a && a.label); }));
  const added = [];
  if (!configured) {
    list.push({ label: 'A', credsDir: toTilde(p.claudeDir, p.home) });
    used.add('A');
    added.push('A');
  }
  const label = nextLabel(used);
  list.push({ label: label, credsDir: toTilde(dir, p.home) });
  added.push(label);
  raw.accounts = list;
  writeJsonAtomic(p.configFile, raw);
  return { added: added };
}

module.exports = {
  DEFAULT_REFRESH, KEYS, slug, readRaw, normalize, load, set, show, resetDisplay,
  listAccounts, addAccount, renameAccount, forgetAccount, knows, registerFolder,
};
