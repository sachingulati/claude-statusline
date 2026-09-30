'use strict';
// Health checks for /sline:doctor. Reports; never throws, never writes.

const fs = require('fs');
const path = require('path');
const config = require('./config');
const settings = require('./settings');
const launcher = require('./launcher');
const cache = require('./cache');
const usage = require('./usage');
const F = require('./format');
const { normPath } = require('./paths');

function check(id, level, message, fix) { return { id: id, level: level, message: message, fix: fix || '' }; }

function doctor(p, env, opts) {
  const now = opts.now;
  const nowSec = Math.floor(now / 1000);
  const out = [];

  const major = Number(process.versions.node.split('.')[0]);
  out.push(major >= 18 ? check('node', 'ok', 'Node ' + process.versions.node)
    : check('node', 'fail', 'Node ' + process.versions.node + ' is too old', 'Install Node 18 or later'));

  let s = null;
  try { s = settings.read(p); } catch (e) { out.push(check('settings', 'fail', e.message, e.fix)); }
  if (s) {
    const sl = s.statusLine;
    if (settings.isOurs(sl, p)) {
      out.push(check('statusLine', 'ok', 'settings.json runs the SLine launcher'));
      out.push(sl.refreshInterval
        ? check('refreshInterval', 'ok', 'Refreshes every ' + sl.refreshInterval + 's')
        : check('refreshInterval', 'warn', 'No refreshInterval: idle sessions show other accounts\' numbers from their last reply', 'Run /sline:init again'));
    } else {
      out.push(check('statusLine', 'fail',
        sl ? 'settings.json statusLine runs something else: ' + (sl.command || JSON.stringify(sl)) : 'settings.json has no statusLine',
        'Run /sline:init'));
    }
    const sub = s.subagentStatusLine;
    if (settings.isOursSubagent(sub, p)) out.push(check('subagentStatusLine', 'ok', 'settings.json runs the SLine subagent rows'));
    else if (sub === undefined) {
      out.push(check('subagentStatusLine', 'warn', 'Subagent rows are not set up: they show Claude Code\'s default', 'Run /sline:init'));
    } else {
      out.push(check('subagentStatusLine', 'warn',
        'settings.json subagentStatusLine runs something else: ' + ((sub && sub.command) || JSON.stringify(sub)),
        'Run /sline:init to use SLine\'s rows'));
    }
  }

  ['settings.json', 'settings.local.json'].forEach(function (name) {
    const file = path.join(opts.cwd, '.claude', name);
    if (normPath(file) === normPath(p.settingsFile)) return;
    try {
      if (JSON.parse(fs.readFileSync(file, 'utf8')).statusLine) {
        out.push(check('shadow', 'warn', file + ' sets its own statusLine, which overrides yours in this project', 'Remove statusLine from ' + file));
      }
    } catch (e) { /* no project file, or not ours to judge */ }
  });

  const ls = launcher.status(p);
  if (!ls.launcherExists) out.push(check('launcher', 'fail', 'Launcher missing: ' + p.launcher, 'Run /sline:init'));
  else if (!ls.launcherCurrent) out.push(check('launcher', 'warn', 'Launcher is from another plugin version', 'It updates itself on the next status line refresh; or run /sline:init'));
  else out.push(check('launcher', 'ok', 'Launcher is current'));
  out.push(ls.rootValid ? check('root', 'ok', 'Plugin files: ' + ls.root)
    : check('root', 'fail', ls.root ? 'Plugin folder missing: ' + ls.root : 'No plugin pointer yet', 'Run /sline:init'));

  let configOk = false;
  try {
    config.readRaw(p);
    out.push(check('config', 'ok', fs.existsSync(p.configFile) ? 'config.json is valid' : 'No config.json: showing the single default account'));
    configOk = true;
  } catch (e) {
    out.push(check('config', 'fail', e.message, e.fix));
  }

  // A broken config.json already failed above; running the display check against it
  // would either throw or report on stale/default data next to that failure.
  if (configOk) {
    const problems = config.load(p).display.problems;
    if (!problems.length) out.push(check('display', 'ok', 'Display settings are valid'));
    problems.forEach(function (x) { out.push(check('display', 'warn', x.message, x.fix)); });
  }

  const cfg = config.load(p);
  const fetching = cfg.fetch.otherAccounts && cfg.accounts.length > 1;
  cfg.accounts.forEach(function (a) {
    const name = 'Account ' + (a.label || '(default)');
    const c = cache.read(p, a.key);
    if (!c || c.fetched_at == null || (!c.five_hour && !c.seven_day)) {
      out.push(check('usage:' + a.key, 'info', name + ': no usage recorded yet', 'Start a Claude Code session as this account'));
    } else {
      out.push(check('usage:' + a.key, 'ok', name + ': last recorded ' + F.formatAge(nowSec - c.fetched_at) + ' ago'));
    }
    const at = fetching ? cache.readAttempt(p, a.key) : null;
    if (at && at.ok === false && at.at != null) {
      out.push(check('fetch:' + a.key, 'info', name + ': last background check failed ' + F.formatAge(nowSec - at.at) + ' ago; it retries hourly'));
    }
  });
  if (fetching) {
    const cmd = usage.command(env, opts.platform);
    out.push(cmd ? check('claude', 'ok', 'Claude Code found: ' + cmd.path)
      : check('claude', 'warn', 'Claude Code not found on PATH: other accounts show recorded numbers only',
        'Put claude on PATH, or turn background checks off: /sline:config fetch.otherAccounts false'));
  }

  out.push(check('hidden', 'info', fs.existsSync(p.hiddenFlag) ? 'Usage is hidden (/sline:usage show brings it back)' : 'Usage is visible'));
  return out;
}

module.exports = { doctor };
