'use strict';
// Per-account quota summary for the quota skill, from each account's record.

const config = require('./config');
const accounts = require('./accounts');
const cache = require('./cache');
const F = require('./format');
const { loginDir } = require('./paths');

function local(sec) { return sec != null ? new Date(sec * 1000).toLocaleString() : null; }

function quota(p, env, now) {
  const cfg = config.load(p);
  const nowSec = Math.floor(now / 1000);
  const activeKey = accounts.activeKey(cfg.accounts, loginDir(p, env));
  return cfg.accounts.map(function (a) {
    const c = cache.rollForward(cache.read(p, a.key), nowSec);
    const f = c && c.five_hour;
    const s = c && c.seven_day;
    const pace = s ? F.pacePct(s.resets_at, now, cfg.pace.workingDays) : null;
    return {
      label: a.label || '(default)',
      key: a.key,
      active: a.key === activeKey,
      fiveHour: f && f.utilization != null
        ? { usedPct: Math.round(f.utilization), resetsAt: f.resets_at, resetsAtLocal: local(f.resets_at) } : null,
      sevenDay: s && s.utilization != null
        ? { usedPct: Math.round(s.utilization), pacePct: pace != null ? Math.round(pace) : null, resetsAt: s.resets_at, resetsAtLocal: local(s.resets_at) } : null,
      ageSeconds: c && c.fetched_at != null ? nowSec - c.fetched_at : null,
      status: c ? 'recorded' : 'none',
    };
  });
}

module.exports = { quota };
