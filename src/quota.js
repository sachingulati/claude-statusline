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

// The account with the most headroom: the lowest max(5-hour %, 7-day %) among accounts with
// cached usage (a missing window counts as unknown, not 0). First in config order on a tie.
// Returns null when no account has any.
function best(list) {
  let pick = null;
  let pickWorst = Infinity;
  list.forEach(function (a) {
    const used = [a.fiveHour, a.sevenDay].filter(Boolean).map(function (w) { return w.usedPct; });
    if (!used.length) return;
    const worst = Math.max.apply(null, used);
    if (worst < pickWorst) { pick = a; pickWorst = worst; }
  });
  return pick && {
    label: pick.label,
    five_hour: pick.fiveHour ? pick.fiveHour.usedPct : null,
    seven_day: pick.sevenDay ? pick.sevenDay.usedPct : null,
  };
}

module.exports = { quota, best };
