'use strict';
// Builds the status line.
//
// Line 1  this session: folder, branch, model, effort, context, tokens (display.line1)
// Line 2  [active account] 5h, 7d, spend  live from stdin, recorded after each reply; an
//         idle session shows the record once another session has recorded newer figures
// Line 3+ every other configured account from its record, rolled past any reset; a
//         record older than 30 minutes is checked in the background through Claude
//         Code's /usage (display.label + display.account)
//
// While <stateDir>/hidden exists, lines 2+ become the hidden marker and nothing is checked.
// A session whose login folder isn't configured yet registers it here (spec §3a).

const fs = require('fs');
const paths = require('./paths');
const config = require('./config');
const git = require('./git');
const F = require('./format');
const L = require('./lines');
const accounts = require('./accounts');
const cache = require('./cache');

function isHidden(p) {
  try { return fs.existsSync(p.hiddenFlag); } catch (e) { return false; }
}

// What an other-account line has to show, from its rolled-forward record.
function otherData(c, nowSec) {
  if (!c || (!c.five_hour && !c.seven_day)) return { status: 'nodata' };
  return {
    five: c.five_hour,
    seven: c.seven_day,
    scoped: c.scoped,
    // A time from a clock that jumped back says nothing about the age.
    age: c.fetched_at != null && c.fetched_at <= nowSec + cache.FUTURE ? { seconds: Math.max(0, nowSec - c.fetched_at) } : null,
  };
}

// The status line inherits the session's environment, so it sees which login folder
// the session uses. Checking is in memory; the disk is touched only for a new folder.
function loadRegistered(p, env) {
  const cfg = config.load(p);
  const loginDir = paths.loginDir(p, env);
  if (config.knows(cfg, loginDir)) return cfg;
  try {
    if (config.registerFolder(p, loginDir).added.length) return config.load(p);
  } catch (e) { /* broken config.json: never overwrite it; doctor reports it */ }
  return cfg;
}

function render(payload, opts) {
  opts = opts || {};
  const env = opts.env || process.env;
  const now = opts.now != null ? opts.now : Date.now();
  const nowSec = Math.floor(now / 1000);
  const spawn = opts.spawn || function (acct, mode) { cache.spawnFetch(acct, env, mode); };
  const p = paths.resolve(env);
  const cfg = loadRegistered(p, env);
  const d = payload && typeof payload === 'object' ? payload : {};
  const lines = [];

  const disp = cfg.display;
  const style = F.makeStyle(disp, env);
  const cwd = (d.workspace && d.workspace.current_dir) || d.cwd || process.cwd();
  const hidden = isHidden(p);
  // Hiding usage covers the usage fields a line 1 template can name, too.
  const d1 = hidden && d.rate_limits !== undefined ? Object.assign({}, d, { rate_limits: undefined }) : d;
  const v1 = L.withPassThrough(L.line1(d, cwd, p.home, git.branch(cwd), style), d1, disp.templates.line1.parts, now, style.clock);
  const width = L.lineWidth(disp, env);
  const line1 = L.fitLine1(width, disp.templates.line1, v1, style, disp.separator);
  // A valid template can still render blank for this payload; the status line always needs a line 1.
  lines.push(line1 === '' ? L.fitLine1(width, L.defaultDisplay().templates.line1, v1, style, disp.separator) : line1);

  // Hiding covers account usage only; line 1 is about this session and stays.
  if (hidden) {
    if (cfg.hiddenMarker) lines.push(F.paint(style, 'dim', cfg.hiddenMarker));
  } else {
    L.fitAccounts(width, disp, quotaLines(d, p, cfg, env, now, nowSec, spawn, style), style)
      .forEach(function (l) { if (l !== '') lines.push(l); });
  }

  if (env.RECAP) lines.push(env.RECAP);
  return lines.join('\n') + '\n';
}

function quotaLines(d, p, cfg, env, now, nowSec, spawn, style) {
  const all = cfg.accounts;
  const activeKey = accounts.activeKey(all, paths.loginDir(p, env));
  const active = all.find(function (a) { return a.key === activeKey; });
  const others = cfg.display.otherAccounts ? all.filter(function (a) { return a.key !== activeKey; }) : [];
  // Label lines only when more than one account line is on screen.
  const multi = others.length > 0;

  const rl = d.rate_limits || {};
  const five = rl.five_hour || {};
  const seven = rl.seven_day || {};
  // Rate limits appear only after the session's first API response.
  let fh = F.cleanPct(five.used_percentage, 100);
  let fhRst = five.resets_at;
  let sd = F.cleanPct(seven.used_percentage, 100);
  let sdRst = seven.resets_at;
  const stdinHasLimits = fh != null;

  let rec = cache.read(p, activeKey);
  if (stdinHasLimits) {
    // An idle session is redrawn with its last reply's limits: recorded only after a reply.
    const apiMs = d.cost && d.cost.total_api_duration_ms;
    const session = typeof apiMs === 'number' && d.session_id ? { id: d.session_id, apiMs: apiMs } : null;
    const s = cache.settleActive(p, activeKey, rec, {
      five: fh != null ? { utilization: fh, resets_at: fhRst != null ? fhRst : null } : null,
      seven: sd != null ? { utilization: sd, resets_at: sdRst != null ? sdRst : null } : null,
    }, session, nowSec);
    rec = s.rec;
    // Another session recorded newer figures since this one's last reply: draw those.
    if (!s.show) { fh = fhRst = sd = sdRst = null; }
  }

  // Per-model rows never reach the status line's JSON: only if the template shows them is
  // the active account checked too, on the same 30-minute pacing.
  if (active && cfg.fetch.otherAccounts && L.usesModel(cfg.display.templates.account) &&
      cache.checkDue(p, activeKey, rec, nowSec)) {
    spawn(active, 'scoped');
  }

  // Before its first reply the active account shows its record.
  const ac = cache.rollForward(rec, nowSec);
  if (fh == null && ac && ac.five_hour) { fh = ac.five_hour.utilization; fhRst = ac.five_hour.resets_at; }
  if (sd == null && ac && ac.seven_day) { sd = ac.seven_day.utilization; sdRst = ac.seven_day.resets_at; }

  const wd = cfg.pace.workingDays;
  // Behind a Claude apps gateway the payload can carry a spend limit, possibly without 5h/7d.
  // Spending can pass 100%, so only nonsense is dropped.
  const spendPct = rl.spend_limit ? F.cleanPct(rl.spend_limit.used_percentage, Infinity) : null;
  const spend = spendPct != null ? Object.assign({}, rl.spend_limit, { used_percentage: spendPct }) : null;
  const live = {
    five: fh != null ? { utilization: fh, resets_at: fhRst != null ? fhRst : null } : null,
    seven: sd != null ? { utilization: sd, resets_at: sdRst != null ? sdRst : null } : null,
    spend: spend,
    scoped: ac ? ac.scoped : null,
  };

  const out = [];
  if (live.five || live.seven || live.spend) {
    out.push({ label: multi ? active.label : null, values: L.account(live, now, wd, style) });
  }
  others.forEach(function (a) {
    const r = cache.read(p, a.key);
    // Old numbers: ask Claude Code in the background; this line shows them meanwhile.
    if (cfg.fetch.otherAccounts && cache.fetchDue(p, a.key, r, nowSec)) spawn(a);
    const c = cache.rollForward(r, nowSec);
    out.push({ label: multi ? a.label : null, values: L.account(otherData(c, nowSec), now, wd, style) });
  });
  return out;
}

function run(stdinText, opts) {
  let payload = {};
  try { payload = JSON.parse(stdinText || '{}') || {}; } catch (e) { payload = {}; }
  return render(payload, opts);
}

module.exports = { render, run };
