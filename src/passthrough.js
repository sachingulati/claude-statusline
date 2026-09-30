'use strict';
// Any field of Claude Code's status line JSON on line 1, under Claude Code's own name
// ({session_name}, {prompt_cache.expires_at}). The name's ending says how to show it:
//   _at          a time: 14:32 today, Mon 17:29 otherwise (epoch s, epoch ms or ISO text)
//   _ms          a duration: 42s, 1m42s, 2h05m
//   _usd         dollars: $12.40
//   _percentage  a whole percent: 12%
//   other        text on one line; numbers as they are; true → on, false → empty
// Objects, arrays, null, missing and unreadable values are empty, so their [ … ] drops.

const F = require('./format');

const NAME = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)*$/;

function lookup(d, name) {
  let o = d;
  const keys = name.split('.');
  for (let i = 0; i < keys.length; i++) {
    if (o == null || typeof o !== 'object' || Array.isArray(o) || !Object.prototype.hasOwnProperty.call(o, keys[i])) return undefined;
    o = o[keys[i]];
  }
  return o;
}

function epochMs(v) {
  if (typeof v === 'number') return isFinite(v) && v > 0 ? (v > 1e12 ? v : v * 1000) : null;
  if (typeof v === 'string') { const ms = Date.parse(v); return isFinite(ms) ? ms : null; }
  return null;
}

// Unlike reset times, a past time (last_miss_at) is still worth showing.
function clockAt(ms, now, clock) {
  const d = new Date(ms);
  const n = new Date(now);
  const today = d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
  return (today ? '' : F.DAYS[d.getDay()] + ' ') + F.clockTime(d, clock);
}

function format(name, v, now, clock) {
  if (v == null || typeof v === 'object') return null;
  const last = name.slice(name.lastIndexOf('.') + 1);
  if (/_at$/.test(last)) { const ms = epochMs(v); return ms == null ? null : clockAt(ms, now, clock); }
  if (/_ms$/.test(last)) return typeof v === 'number' && isFinite(v) && v >= 0 ? F.formatElapsed(v) : null;
  if (/_usd$/.test(last)) return typeof v === 'number' && isFinite(v) ? '$' + v.toFixed(2) : null;
  if (/_percentage$/.test(last)) { const p = F.cleanPct(v, 100); return p == null ? null : F.pct(Math.round(p)); }
  if (typeof v === 'boolean') return v ? 'on' : null;
  if (typeof v === 'number') return isFinite(v) ? String(v) : null;
  if (typeof v === 'string') return F.oneLine(v) || null;
  return null;
}

function values(d, names, now, clock) {
  const out = {};
  names.forEach(function (n) {
    const t = format(n, lookup(d, n), now, clock);
    out[n] = t == null ? null : { text: t, role: null };
  });
  return out;
}

module.exports = { NAME, lookup, format, values };
