'use strict';
// The turn line: one line under each response, printed by the Stop hook ("launch.js turn",
// turned on by /sline:config turnLine on) as its systemMessage. Every figure is this session's own,
// from its transcript and its status line's history (history.js), so concurrent sessions never mix.
//
//   ctx +12.4k (6%) · in 2.1k · out 3.4k · cache 610k read / 14k write (97% hit) · ...
//
// The transcript (Claude Code 2.1.314): one API reply spans several lines sharing message.id, each
// carrying the reply's full usage, so each id counts once. The prompt and its tool results carry
// the hook's prompt_id as promptId. Claude Code's own turn_duration line is written after Stop
// hooks run, so the duration is measured from the prompt.
//
// Cost is Claude Code's cost.total_cost_usd at the last reply the status line recorded, less the
// one before the prompt. Replies after the last redraw are priced at a rate measured the same way
// (dollars per input-price token, per model, kept in rates.json): no price table to go stale.

const fs = require('fs');
const path = require('path');
const paths = require('./paths');
const config = require('./config');
const history = require('./history');
const T = require('./template');
const L = require('./lines');
const { readJson, writeJsonAtomic } = require('./fsutil');

const CHUNK = 256 * 1024;
// Token prices relative to input: cache writes (5 minutes, 1 hour), cache reads, output.
const W5M = 1.25;
const W1H = 2;
const WREAD = 0.1;
const WOUT = 5;

function count(n) { return typeof n === 'number' && isFinite(n) && n >= 0 ? n : 0; }

function parse(text) {
  const out = [];
  text.split('\n').forEach(function (l) {
    if (!l) return;
    try { const o = JSON.parse(l); if (o && typeof o === 'object') out.push(o); } catch (e) { /* a line being written */ }
  });
  return out;
}

function hasToolResult(o) {
  const c = o.message && o.message.content;
  return Array.isArray(c) && c.some(function (b) { return b && b.type === 'tool_result'; });
}

// Without a prompt id: the last prompt a person typed.
function isPrompt(o) {
  return o.type === 'user' && !o.isMeta && !o.isSidechain && !hasToolResult(o) && (!o.origin || o.origin.kind === 'human');
}

// The prompt's tool results carry its id too, so only the line without a tool result starts the turn.
function startIndex(lines, promptId) {
  if (promptId) return lines.findIndex(function (o) { return o.promptId === promptId && o.type === 'user' && !hasToolResult(o); });
  for (let i = lines.length - 1; i >= 0; i--) if (isPrompt(lines[i])) return i;
  return -1;
}

function isReply(o) {
  const m = o.type === 'assistant' && !o.isSidechain && o.message;
  return !!(m && m.id && m.usage && m.model !== '<synthetic>');
}
function isCompact(o) { return o.type === 'system' && o.subtype === 'compact_boundary'; }

// Read enough of the end of the transcript to hold the turn and the reply before it.
function complete(lines, promptId) {
  const i = startIndex(lines, promptId);
  if (i === -1) return false;
  for (let k = i - 1; k >= 0; k--) if (isReply(lines[k]) || isCompact(lines[k])) return true;
  return false;
}

function readTail(file, promptId, opts) {
  let chunk = (opts && opts.chunk) || CHUNK;
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    for (;;) {
      const len = Math.min(size, chunk);
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, size - len);
      let text = buf.toString('utf8');
      if (len < size) text = text.slice(text.indexOf('\n') + 1); // the first line is cut
      const lines = parse(text);
      if (len === size || complete(lines, promptId)) return lines;
      chunk *= 4;
    }
  } finally { fs.closeSync(fd); }
}

function ctxOf(u) {
  return count(u.input_tokens) + count(u.cache_read_input_tokens) + count(u.cache_creation_input_tokens) + count(u.output_tokens);
}

// mcp__plugin_playwright_playwright__browser_click → browser_click
function toolName(n) {
  const m = /^mcp__.+?__(.+)$/.exec(n);
  return m ? m[1] : n;
}

function analyze(lines, promptId) {
  const start = startIndex(lines, promptId);
  if (start === -1) return null;
  let before = null;
  let first = true;
  for (let k = start - 1; k >= 0; k--) {
    if (isCompact(lines[k])) { first = false; break; }
    if (isReply(lines[k])) { before = lines[k].message.usage; first = false; break; }
  }
  const byId = new Map();
  const toolIds = new Set();
  const tools = new Map();
  let compacted = false;
  let subagents = false;
  for (let k = start + 1; k < lines.length; k++) {
    const o = lines[k];
    if (isCompact(o)) { compacted = true; continue; }
    if (!isReply(o)) continue;
    const m = o.message;
    byId.set(m.id, { id: m.id, model: m.model, usage: m.usage, stop: m.stop_reason });
    (Array.isArray(m.content) ? m.content : []).forEach(function (b) {
      if (!b || b.type !== 'tool_use' || toolIds.has(b.id)) return;
      toolIds.add(b.id);
      if (b.name === 'Agent' || b.name === 'Task') subagents = true;
      const n = toolName(String(b.name));
      tools.set(n, (tools.get(n) || 0) + 1);
    });
  }
  const replies = Array.from(byId.values());
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, thinking: 0 };
  replies.forEach(function (r) {
    const u = r.usage;
    tokens.input += count(u.input_tokens);
    tokens.output += count(u.output_tokens);
    tokens.cacheRead += count(u.cache_read_input_tokens);
    tokens.cacheWrite += count(u.cache_creation_input_tokens);
    tokens.thinking += count(u.output_tokens_details && u.output_tokens_details.thinking_tokens);
  });
  const last = replies[replies.length - 1];
  const stop = last ? last.stop : undefined;
  return {
    startAt: Date.parse(lines[start].timestamp),
    first: first,
    before: before,
    replies: replies,
    tokens: tokens,
    // Most used first; a tie keeps the order of first use.
    tools: Array.from(tools.entries()).sort(function (a, b) { return b[1] - a[1]; }),
    ctxBefore: before ? ctxOf(before) : null,
    ctxAfter: last ? ctxOf(last.usage) : null,
    compacted: compacted,
    subagents: subagents,
    note: !last ? null : stop == null ? 'interrupted' : stop === 'max_tokens' ? 'max tokens' : null,
  };
}

// A reply's tokens in input-price units. A cache write without the 5m/1h split counts as the
// 1-hour cache Claude Code writes.
function weighted(u) {
  const cc = u.cache_creation;
  const w5 = cc ? count(cc.ephemeral_5m_input_tokens) : 0;
  const w1 = Math.max(count(u.cache_creation_input_tokens) - w5, cc ? count(cc.ephemeral_1h_input_tokens) : 0);
  return count(u.input_tokens) + count(u.cache_read_input_tokens) * WREAD + w5 * W5M + w1 * W1H + count(u.output_tokens) * WOUT;
}

function price(a, hist, rates) {
  const H = hist && Array.isArray(hist.h) ? hist.h.filter(function (e) { return e && typeof e.c === 'number'; }) : [];
  const find = function (s, from) {
    for (let k = H.length - 1; k >= from; k--) if (H[k].s === s) return k;
    return -1;
  };
  // The cost before the prompt: the entry of the reply before it, else the last one drawn
  // before the prompt; a session's first turn starts from nothing.
  let start = a.before ? find(history.sig(a.before), 0) : -1;
  if (start === -1) for (let k = H.length - 1; k >= 0; k--) if (H[k].t <= a.startAt) { start = k; break; }
  const from = start !== -1 ? H[start] : a.first ? { c: 0, la: 0, lr: 0 } : null;

  let end = -1;
  let covered = 0;
  if (from) {
    for (let j = a.replies.length - 1; j >= 0 && end === -1; j--) {
      end = find(history.sig(a.replies[j].usage), start + 1);
      if (end !== -1) covered = j + 1;
    }
  }
  let base = end !== -1 ? H[end].c - from.c : 0;
  if (base < 0) { base = 0; covered = 0; } // the cost went back: another process's figures

  const done = a.replies.slice(0, covered);
  let rate = null;
  if (done.length && base > 0 && !a.subagents && done.every(function (r) { return r.model === done[0].model; })) {
    const w = done.reduce(function (s, r) { return s + weighted(r.usage); }, 0);
    if (w > 0) rate = { model: done[0].model, value: base / w };
  }
  let extra = 0;
  let partial = false;
  a.replies.slice(covered).forEach(function (r) {
    const known = rate && rate.model === r.model ? rate.value : rates && rates[r.model] && rates[r.model].rate;
    if (typeof known === 'number' && known > 0) extra += weighted(r.usage) * known;
    else partial = true;
  });
  const lastEntry = H.length - 1 > start ? H[H.length - 1] : null;
  return {
    cost: covered === 0 && extra === 0 ? null : base + extra,
    partial: partial,
    lines: from ? (lastEntry ? { added: lastEntry.la - from.la, removed: lastEntry.lr - from.lr } : { added: 0, removed: 0 }) : null,
    rate: rate,
  };
}

// 950, 12k, 12.4k, 610k, 1.3M
function tk(n) {
  const one = function (x) { return x.toFixed(1).replace(/\.0$/, ''); };
  if (n >= 1e6) return one(n / 1e6) + 'M';
  if (n >= 1e5) return Math.round(n / 1e3) + 'k';
  if (n >= 1e3) return one(n / 1e3) + 'k';
  return String(Math.round(n));
}

// 8s, 1m 43s, 1h 02m
function duration(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm ' + String(s % 60).padStart(2, '0') + 's';
  return Math.floor(m / 60) + 'h ' + String(m % 60).padStart(2, '0') + 'm';
}

const money = L.money;

function plain(text) { return text == null ? null : { text: text, role: null }; }

function values(a, pr, window, now) {
  const share = function (n) {
    const p = n / window * 100;
    return n > 0 && p < 0.5 ? '<1%' : Math.round(p) + '%';
  };
  let ctx = null;
  if (a.compacted) ctx = 'compacted';
  else if (a.ctxAfter != null && a.ctxBefore == null) ctx = tk(a.ctxAfter) + ' (' + share(a.ctxAfter) + ')';
  else if (a.ctxAfter != null) {
    const d = a.ctxAfter - a.ctxBefore;
    ctx = (d < 0 ? '−' : '+') + tk(Math.abs(d)) + ' (' + share(Math.abs(d)) + ')';
  }
  const t = a.tokens;
  const seen = t.input + t.cacheRead + t.cacheWrite;
  const n = a.replies.length;
  const lines = pr.lines && (pr.lines.added || pr.lines.removed) ? pr.lines : null;
  return {
    duration: plain(isFinite(a.startAt) && now >= a.startAt ? duration(now - a.startAt) : null),
    ctx: plain(ctx),
    'ctx.total': plain(a.ctxAfter != null ? tk(a.ctxAfter) : null),
    'ctx.pct': plain(a.ctxAfter != null ? share(a.ctxAfter) : null),
    in: plain(tk(t.input)),
    out: plain(tk(t.output)),
    cacheRead: plain(tk(t.cacheRead)),
    cacheWrite: plain(tk(t.cacheWrite)),
    hit: plain(seen > 0 ? Math.round(t.cacheRead / seen * 100) + '%' : null),
    thinking: plain(t.thinking > 0 ? tk(t.thinking) : null),
    calls: plain(n + (n === 1 ? ' call' : ' calls')),
    tools: plain(a.tools.length ? a.tools.map(function (e) { return e[0] + ' ' + e[1]; }).join(', ') : null),
    'lines.added': plain(lines ? String(lines.added) : null),
    'lines.removed': plain(lines ? String(lines.removed) : null),
    cost: plain(pr.cost != null ? money(pr.cost) + (pr.partial ? '+' : '') : null),
    note: plain(a.note),
  };
}

function defaultTemplate() { return L.defaultDisplay().templates.turn; }

function draw(tpl, v, sep) {
  return T.render(tpl.parts, v, { paint: function (role, text) { return text; }, sep: sep });
}

// The window size the status line last reported; a model id marked [1m] has a million tokens.
function windowFor(hist, model) {
  if (hist && count(hist.window) > 0) return hist.window;
  return /\[1m\]/i.test(String(model)) ? 1e6 : 2e5;
}

function ratesFile(p) { return path.join(p.stateDir, 'rates.json'); }

function readRates(p) {
  try { const r = readJson(ratesFile(p), {}); return r && typeof r === 'object' ? r : {}; } catch (e) { return {}; }
}

function lastFile(p, id) {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id) ? path.join(p.sessionsDir, id + '.last.json') : null;
}

// What line 1's {turn.cost} and {turn.ctx} show.
function readLast(p, id) {
  const f = lastFile(p, id);
  try { return f ? readJson(f, null) : null; } catch (e) { return null; }
}

function run(stdinText, opts) {
  opts = opts || {};
  try {
    const input = JSON.parse(stdinText || 'null');
    if (!input || typeof input.transcript_path !== 'string') return '';
    const now = opts.now != null ? opts.now : Date.now();
    const p = paths.resolve(opts.env || process.env);
    const promptId = typeof input.prompt_id === 'string' && input.prompt_id ? input.prompt_id : null;
    const a = analyze(readTail(input.transcript_path, promptId), promptId);
    if (!a || !a.replies.length) return '';
    const hist = history.read(p, input.session_id);
    const rates = readRates(p);
    const pr = price(a, hist, rates);
    if (pr.rate) {
      rates[pr.rate.model] = { rate: pr.rate.value, at: now };
      try { writeJsonAtomic(ratesFile(p), rates); } catch (e) { /* the next turn measures it again */ }
    }
    const v = values(a, pr, windowFor(hist, a.replies[a.replies.length - 1].model), now);
    const f = lastFile(p, input.session_id);
    if (f) {
      try { writeJsonAtomic(f, { cost: pr.cost, partial: pr.partial, ctx: v.ctx ? v.ctx.text : null, at: now }); } catch (e) { /* line 1 shows the one before */ }
    }
    const disp = config.load(p).display;
    const text = draw(disp.templates.turn, v, disp.separator);
    return text ? JSON.stringify({ systemMessage: text }) + '\n' : '';
  } catch (e) {
    return ''; // a Stop hook must never get in the way of the session
  }
}

module.exports = { readTail, analyze, weighted, price, values, defaultTemplate, draw, tk, duration, money, readLast, run };
