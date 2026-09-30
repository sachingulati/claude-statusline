#!/usr/bin/env node
'use strict';
// sline CLI. The plugin's skills call this; it owns every file write.
//
//   node cli/sl.js <command> [args] [--json]
//
//   init [--refresh N]                 set up settings.json, launcher, pointer
//   config show | set <key> <value> | reset display | account list | account add <label> <dir>
//          | account rename <label> <new> | account forget <label>
//   usage [hide|show|active|all|reset] usage visibility and which accounts show (bare = report)
//   fields                             template fields: sline's and Claude Code's
//   quota                            every account's usage from the cache
//   doctor                             health checks (exit 1 if any fail)
//   uninstall [--purge]                restore settings.json, remove launcher

const major = Number(process.versions.node.split('.')[0]);
if (major < 18) {
  console.error('SLine needs Node 18 or later (found ' + process.versions.node + ').');
  process.exit(1);
}

const fs = require('fs');
const paths = require('../src/paths');
const config = require('../src/config');
const settings = require('../src/settings');
const launcher = require('../src/launcher');
const quota = require('../src/quota');
const doctor = require('../src/doctor');
const lines = require('../src/lines');
const CC = require('../src/ccfields');
const { UserError, writeFileAtomic } = require('../src/fsutil');

const argv = process.argv.slice(2);
const json = argv.includes('--json');
const args = argv.filter(function (a) { return a !== '--json'; });
const p = paths.resolve(process.env);

const USAGE = 'Usage: sl.js <init|config|usage|fields|quota|doctor|uninstall> [args] [--json]';

function takeFlag(name) {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const v = args[i + 1];
  args.splice(i, 2);
  if (v === undefined) throw new UserError(name + ' needs a value');
  return v;
}

function cmdInit() {
  const interval = takeFlag('--refresh');
  const opts = interval !== undefined ? { refreshInterval: settings.parseInterval(interval) } : {};
  // Validate settings.json before creating anything.
  settings.read(p);
  fs.mkdirSync(p.stateDir, { recursive: true });
  const synced = launcher.sync(p);
  const r = settings.install(p, opts);
  const hasConfig = fs.existsSync(p.configFile);
  return {
    data: {
      stateDir: p.stateDir, settingsFile: p.settingsFile, launcher: p.launcher, pluginRoot: synced.pluginRoot,
      settingsChanged: r.changed, backup: r.backup, statusLine: r.statusLine,
      subagentStatusLine: r.subagentStatusLine, hasConfig: hasConfig,
    },
    text: [
      r.changed ? 'Status line set up in ' + p.settingsFile : 'Status line already set up; nothing changed',
      r.backup ? 'Backup: ' + r.backup : '',
      'Refreshes every ' + r.statusLine.refreshInterval + 's',
      'Subagent rows under the prompt show each subagent\'s model, context, tokens and time',
      hasConfig ? '' : 'Other logins are added automatically the first time a session uses them.',
    ].filter(Boolean).join('\n'),
  };
}

// Two independent settings, each set explicitly (no toggles): whether any usage
// numbers show (hide/show), and which accounts show (active/all). Bare = report.
function cmdUsage() {
  const action = (args[1] || 'status').toLowerCase();
  const hiddenNow = fs.existsSync(p.hiddenFlag);
  const activeOnlyNow = !config.load(p).display.otherAccounts;
  let hidden = hiddenNow;
  let activeOnly = activeOnlyNow;
  if (action === 'hide') hidden = true;
  else if (action === 'show') hidden = false;
  else if (action === 'active') activeOnly = true;
  else if (action === 'all') activeOnly = false;
  else if (action === 'reset') { hidden = false; activeOnly = false; }
  else if (action !== 'status') {
    throw new UserError('Unknown action "' + action + '"', 'Use: usage [hide|show|active|all|reset]');
  }
  if (hidden && !hiddenNow) writeFileAtomic(p.hiddenFlag, '');
  if (!hidden && hiddenNow) fs.unlinkSync(p.hiddenFlag);
  if (activeOnly !== activeOnlyNow) config.set(p, 'display.otherAccounts', !activeOnly);
  return {
    data: { usage: hidden ? 'hidden' : 'visible', accounts: activeOnly ? 'active' : 'all' },
    text: 'Usage: ' + (hidden ? 'HIDDEN' : 'visible') + ' · accounts: ' + (activeOnly ? 'active only' : 'all'),
  };
}

function accountsText(list) {
  return list.map(function (a) {
    return '  ' + (a.label || '(default)').padEnd(10) + a.credsDir + (a.recorded ? '' : '  (no usage recorded yet)');
  }).join('\n');
}

function cmdConfig() {
  const sub = args[1] || 'show';
  if (sub === 'show') {
    const r = config.show(p);
    let sl = null;
    try { sl = settings.read(p).statusLine; } catch (e) { sl = null; }
    const ri = settings.isOurs(sl, p) && sl.refreshInterval != null ? sl.refreshInterval : null;
    r.rows.push(ri != null
      ? { key: 'refreshInterval', value: ri, origin: 'settings.json' }
      : { key: 'refreshInterval', value: settings.DEFAULT_REFRESH_INTERVAL, origin: 'default' });
    return {
      data: r,
      // A value too long for its column (a template) still gets two spaces before the origin.
      text: r.rows.map(function (x) {
        const v = JSON.stringify(x.value);
        return x.key.padEnd(32) + (v.length < 22 ? v.padEnd(22) : v + '  ') + x.origin;
      }).join('\n') +
        '\n\nAccounts\n' + accountsText(r.accounts) +
        '\n\nSample\n' + r.sample.join('\n'),
    };
  }
  if (sub === 'set') {
    const key = args[2];
    // --stdin in place of the value: Git Bash on Windows rewrites an argument that starts
    // with "/" into a Windows path before node ever sees it. Reading stdin sidesteps that.
    const value = args[3] === '--stdin'
      ? fs.readFileSync(0, 'utf8').replace(/\r\n$|\n$/, '')
      : args.slice(3).join(' ');
    if (!key || value === '') throw new UserError('Usage: config set <key> <value>');
    if (key === 'refreshInterval') {
      const r = settings.setRefreshInterval(p, value);
      return { data: r, text: 'refreshInterval = ' + r.refreshInterval };
    }
    const v = config.set(p, key, value);
    const data = { key: key, value: v };
    if (key.indexOf('display.') === 0) data.sample = lines.sampleLines(config.load(p).display);
    const warnings = key.indexOf('display.') === 0 ? config.templateWarnings(key.slice(8), String(v)) : [];
    if (warnings.length) data.warnings = warnings;
    return { data: data, text: key + ' = ' + JSON.stringify(v) + (data.sample ? '\n\n' + data.sample.join('\n') : '') +
      (warnings.length ? '\nWarning: ' + warnings.join('\nWarning: ') : '') };
  }
  if (sub === 'reset') {
    if (args[2] !== 'display') throw new UserError('Usage: config reset display');
    config.resetDisplay(p);
    const sample = lines.sampleLines(config.load(p).display);
    return { data: { reset: 'display', sample: sample }, text: 'Display settings are back to the defaults\n\n' + sample.join('\n') };
  }
  if (sub === 'account') {
    const op = args[2] || 'list';
    if (op === 'add') {
      const r = config.addAccount(p, args[3], args.slice(4).join(' '));
      return { data: r, text: 'Added account ' + r.label + ' (' + r.credsDir + ')' + (r.warning ? '\nWarning: ' + r.warning : '') };
    }
    if (op === 'rename') {
      const r = config.renameAccount(p, args[3], args.slice(4).join(' '));
      return { data: r, text: 'Renamed account ' + r.label + ' to ' + r.newLabel };
    }
    if (op === 'forget' || op === 'remove') {
      const r = config.forgetAccount(p, args[3]);
      return { data: r, text: 'Forgot account ' + r.label + '; ' + r.credsDir + ' will not be added again' };
    }
    if (op === 'list') {
      const r = config.listAccounts(p);
      return { data: r, text: accountsText(r) };
    }
    throw new UserError('Unknown account action "' + op + '"', 'Use: config account list|add|rename|forget');
  }
  throw new UserError('Unknown config action "' + sub + '"', 'Use: config show | set <key> <value> | reset display | account list|add|rename|forget');
}

function cmdQuota() {
  const r = quota.quota(p, process.env, Date.now());
  return {
    data: r,
    text: r.map(function (a) {
      const five = a.fiveHour ? a.fiveHour.usedPct + '% (resets ' + a.fiveHour.resetsAtLocal + ')' : '--';
      const seven = a.sevenDay ? a.sevenDay.usedPct + '% of week, pace ' + a.sevenDay.pacePct + '%' : '--';
      return (a.active ? '* ' : '  ') + a.label.padEnd(10) + '5h ' + five + '  7d ' + seven +
        (a.ageSeconds != null ? '  (' + a.ageSeconds + 's old, ' + a.status + ')' : '  (' + a.status + ')');
    }).join('\n'),
  };
}

function cmdDoctor() {
  const checks = doctor.doctor(p, process.env, { cwd: process.cwd(), now: Date.now(), platform: process.platform });
  return {
    data: { checks: checks },
    text: checks.map(function (c) { return c.level.toUpperCase().padEnd(5) + ' ' + c.message + (c.fix ? '\n      fix: ' + c.fix : ''); }).join('\n'),
    exit: checks.some(function (c) { return c.level === 'fail'; }) ? 1 : 0,
  };
}

function cmdUninstall() {
  const purge = args.includes('--purge');
  const r = settings.restore(p);
  [p.launcher, p.rootFile, p.installFile].forEach(function (f) {
    try { fs.unlinkSync(f); } catch (e) { /* already gone */ }
  });
  if (purge) fs.rmSync(p.stateDir, { recursive: true, force: true });
  return {
    data: Object.assign({ purged: purge }, r),
    text: [
      r.leftAlone ? 'settings.json statusLine was changed since init; left as is'
        : r.restored ? 'Restored your previous status line' : 'Removed the status line from settings.json',
      r.subagentLeftAlone ? 'settings.json subagentStatusLine was changed since init; left as is' : '',
      r.backup ? 'Backup: ' + r.backup : '',
      purge ? 'Deleted ' + p.stateDir : 'Kept your config and cache in ' + p.stateDir,
      'Next: /plugin uninstall sline@sachingulati',
    ].filter(Boolean).join('\n'),
  };
}

function cmdFields() {
  const data = { sline: lines.FIELDS, claudeCode: CC.DOCUMENTED,
    suffixes: { _at: 'clock time', _ms: 'duration', _usd: 'dollars', _percentage: 'whole percent' } };
  return {
    data: data,
    text: 'SLine fields\n' + Object.keys(lines.FIELDS).map(function (k) { return '  ' + k.padEnd(9) + lines.FIELDS[k].join(', '); }).join('\n') +
      '\n\nClaude Code fields (line 1 only; names ending _at, _ms, _usd, _percentage are formatted)\n  ' + CC.DOCUMENTED.join('\n  '),
  };
}

const COMMANDS = {
  init: cmdInit, config: cmdConfig, usage: cmdUsage, fields: cmdFields,
  quota: cmdQuota, doctor: cmdDoctor, uninstall: cmdUninstall,
};

function main() {
  const name = args[0];
  const fn = COMMANDS[name];
  if (!fn) {
    if (json) console.log(JSON.stringify({ ok: false, error: USAGE, fix: '' }, null, 2));
    else console.error(USAGE);
    return 1;
  }
  try {
    const r = fn();
    if (json) console.log(JSON.stringify({ ok: true, result: r.data }, null, 2));
    else if (r.text) console.log(r.text);
    return r.exit || 0;
  } catch (e) {
    const user = e instanceof UserError;
    if (json) console.log(JSON.stringify({ ok: false, error: e.message, fix: user ? e.fix : '', internal: !user }, null, 2));
    else console.error((user ? '' : 'Internal error: ') + e.message + (user && e.fix ? '\nFix: ' + e.fix : ''));
    return user ? 1 : 2;
  }
}

process.exitCode = main();
