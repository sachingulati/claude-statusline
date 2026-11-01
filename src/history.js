'use strict';
// This session's cost after each reply, as its status line saw it: <stateDir>/sessions/<id>.cost.json.
// The turn line (turn.js) matches its transcript's replies against these entries to find what a
// turn cost. An entry: s = the reply's signature (input, cache read and cache write tokens of
// context_window.current_usage), c = cost.total_cost_usd, la/lr = lines added/removed, t = time (ms).
// Cache reads grow with every reply, so a signature names one reply.

const path = require('path');
const { readJson, writeJsonAtomic } = require('./fsutil');

const CAP = 200; // entries kept; a turn only needs the ones since its prompt

function file(p, id) {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id) ? path.join(p.sessionsDir, id + '.cost.json') : null;
}

function count(n) { return typeof n === 'number' && isFinite(n) && n >= 0 ? n : 0; }

function sig(u) {
  if (!u || typeof u !== 'object') return null;
  return [count(u.input_tokens), count(u.cache_read_input_tokens), count(u.cache_creation_input_tokens)].join(',');
}

function read(p, id) {
  const f = file(p, id);
  if (!f) return null;
  try {
    const h = readJson(f, null);
    return h && typeof h === 'object' && Array.isArray(h.h) ? h : null;
  } catch (e) { return null; }
}

// Called on every render; writes only when a reply or the cost moved.
function record(p, d, now) {
  try {
    const cw = d && d.context_window;
    const c = d && d.cost;
    const f = file(p, d && d.session_id);
    if (!f || !cw || !cw.current_usage || !c || typeof c.total_cost_usd !== 'number') return;
    const s = sig(cw.current_usage);
    const prev = read(p, d.session_id) || { h: [] };
    const window = count(cw.context_window_size) || prev.window || null;
    const last = prev.h[prev.h.length - 1];
    if (last && last.s === s && last.c === c.total_cost_usd && prev.window === window) return;
    const h = prev.h.concat({ s: s, c: c.total_cost_usd, la: count(c.total_lines_added), lr: count(c.total_lines_removed), t: now });
    writeJsonAtomic(f, { window: window, h: h.slice(-CAP) });
  } catch (e) { /* the history is an extra, never a reason for the status line to fail */ }
}

module.exports = { CAP, file, sig, read, record };
