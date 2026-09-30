'use strict';
// Claude Code's settings.json: point statusLine and subagentStatusLine at our launcher,
// and undo it. Every write is preceded by a timestamped backup; invalid JSON is never touched.

const fs = require('fs');
const { UserError, readJson, writeJsonAtomic, timestamp } = require('./fsutil');
const { toForward, normPath } = require('./paths');

// Claude Code only re-runs the status line on conversation events, so without a
// timer an idle session keeps showing other accounts' numbers from its last reply.
const DEFAULT_REFRESH_INTERVAL = 30;

function read(p) {
  let s;
  try {
    s = readJson(p.settingsFile, {});
  } catch (e) {
    throw new UserError('settings.json is not valid JSON, so it was left untouched: ' + e.message,
      'Fix ' + p.settingsFile + ' (plain JSON, no comments), then run /sline:init again');
  }
  if (s === null || typeof s !== 'object' || Array.isArray(s)) {
    throw new UserError('settings.json does not hold a JSON object ({ ... }), so it was left untouched',
      'Fix ' + p.settingsFile + ', then run /sline:init again');
  }
  return s;
}

function backup(p) {
  if (!fs.existsSync(p.settingsFile)) return null;
  let b = p.settingsFile + '.bak.' + timestamp();
  for (let i = 1; fs.existsSync(b); i++) b = p.settingsFile + '.bak.' + timestamp() + '-' + i;
  fs.copyFileSync(p.settingsFile, b);
  return b;
}

function write(p, obj) {
  const b = backup(p);
  writeJsonAtomic(p.settingsFile, obj);
  return b;
}

function command(p) {
  return 'node "' + toForward(p.launcher) + '"';
}

function isOurs(sl, p) {
  return !!(sl && typeof sl.command === 'string' && normPath(sl.command).includes(normPath(p.launcher)));
}

function subagentCommand(p) { return command(p) + ' subagents'; }

function isOursSubagent(v, p) {
  return isOurs(v, p) && /\ssubagents\s*$/.test(v.command);
}

// install.json keeps what init replaced, so uninstall can put it back. Re-running init
// records a value the user set since the last init (the older one is superseded); an
// install.json from before subagent rows gains that key. An unreadable one is left alone.
// Never record our own command as "previous", or uninstall would restore us.
function record(p, current, ours, currentSub, oursSub) {
  const prev = current !== undefined && !ours ? current : null;
  const prevSub = currentSub !== undefined && !oursSub ? currentSub : null;
  if (!fs.existsSync(p.installFile)) {
    writeJsonAtomic(p.installFile, {
      previousStatusLine: prev,
      previousSubagentStatusLine: prevSub,
      installedAt: new Date().toISOString(),
    });
    return true;
  }
  let rec = null;
  try { rec = readJson(p.installFile, null); } catch (e) { return false; }
  if (!rec || typeof rec !== 'object') return false;
  const same = function (a, b) { return JSON.stringify(a) === JSON.stringify(b); };
  let changed = false;
  if (prev != null && !same(rec.previousStatusLine, prev)) { rec.previousStatusLine = prev; changed = true; }
  if (!Object.prototype.hasOwnProperty.call(rec, 'previousSubagentStatusLine')
    || (prevSub != null && !same(rec.previousSubagentStatusLine, prevSub))) {
    rec.previousSubagentStatusLine = prevSub;
    changed = true;
  }
  if (changed) writeJsonAtomic(p.installFile, rec);
  return changed;
}

function parseInterval(v) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 5) {
    throw new UserError('refreshInterval must be a whole number of seconds >= 5, got "' + v + '"');
  }
  return n;
}

function install(p, opts) {
  opts = opts || {};
  const s = read(p);
  const current = s.statusLine;
  const ours = isOurs(current, p);
  const currentSub = s.subagentStatusLine;
  const recorded = record(p, current, ours, currentSub, isOursSubagent(currentSub, p));

  const interval = opts.refreshInterval != null ? opts.refreshInterval
    : ours && current.refreshInterval != null ? current.refreshInterval : DEFAULT_REFRESH_INTERVAL;
  const next = { type: 'command', command: command(p), refreshInterval: interval };
  if (current && current.padding != null) next.padding = current.padding;
  const nextSub = { type: 'command', command: subagentCommand(p) };

  const r = { changed: false, backup: null, recorded: recorded, statusLine: next, subagentStatusLine: nextSub };
  if (JSON.stringify(current) === JSON.stringify(next) && JSON.stringify(currentSub) === JSON.stringify(nextSub)) return r;
  s.statusLine = next;
  s.subagentStatusLine = nextSub;
  r.changed = true;
  r.backup = write(p, s);
  return r;
}

function setRefreshInterval(p, v) {
  const n = parseInterval(v);
  const s = read(p);
  if (!isOurs(s.statusLine, p)) {
    throw new UserError('The status line is not set up yet', 'Run /sline:init first');
  }
  if (s.statusLine.refreshInterval === n) return { changed: false, refreshInterval: n };
  s.statusLine.refreshInterval = n;
  return { changed: true, backup: write(p, s), refreshInterval: n };
}

// Without a readable install.json the previous values are unknown: our entries are
// removed, and anything else is left as it is.
function restore(p) {
  let rec = null;
  try { rec = readJson(p.installFile, null); } catch (e) { rec = null; }
  const s = read(p);
  if (!rec || typeof rec !== 'object') {
    if (!isOurs(s.statusLine, p) && !isOursSubagent(s.subagentStatusLine, p)) {
      throw new UserError('SLine is not installed: settings.json does not point at it', 'Nothing to undo');
    }
    rec = { previousStatusLine: null, previousSubagentStatusLine: null };
  }
  const prev = rec.previousStatusLine == null ? null : rec.previousStatusLine;
  const prevSub = rec.previousSubagentStatusLine == null ? null : rec.previousSubagentStatusLine;
  const r = { restored: prev, backup: null, leftAlone: false, subagentRestored: prevSub, subagentLeftAlone: false };
  let changed = false;
  // A value the user set to something else since init is theirs: leave it.
  if (s.statusLine !== undefined && !isOurs(s.statusLine, p)) r.leftAlone = true;
  else {
    if (prev == null) delete s.statusLine;
    else s.statusLine = prev;
    changed = true;
  }
  if (s.subagentStatusLine !== undefined && !isOursSubagent(s.subagentStatusLine, p)) {
    // Only an init that set up subagent rows can have had its value changed since.
    r.subagentLeftAlone = Object.prototype.hasOwnProperty.call(rec, 'previousSubagentStatusLine');
  } else if (s.subagentStatusLine !== undefined || prevSub != null) {
    if (prevSub == null) delete s.subagentStatusLine;
    else s.subagentStatusLine = prevSub;
    changed = true;
  }
  if (changed) r.backup = write(p, s);
  return r;
}

module.exports = {
  DEFAULT_REFRESH_INTERVAL, read, command, subagentCommand, isOurs, isOursSubagent, parseInterval,
  install, setRefreshInterval, restore,
};
