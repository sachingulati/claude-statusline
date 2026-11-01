'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { tmpEnv, writeJson } = require('./helpers');
const turn = require('../src/turn');
const history = require('../src/history');

const T0 = Date.UTC(2026, 10, 4, 10, 0, 0);
const iso = function (ms) { return new Date(ms).toISOString(); };

// A transcript built line by line, in Claude Code 2.1.314's shapes: one API reply spans several
// lines sharing message.id, each carrying the reply's full usage; tool results carry the promptId.
function usage(input, read, write, out, extra) {
  return Object.assign({ input_tokens: input, cache_read_input_tokens: read, cache_creation_input_tokens: write,
    output_tokens: out, cache_creation: { ephemeral_1h_input_tokens: write, ephemeral_5m_input_tokens: 0 } }, extra || {});
}
function prompt(id, at) {
  return { type: 'user', promptId: id, origin: { kind: 'human' }, timestamp: iso(at), message: { role: 'user', content: 'do it' } };
}
function reply(id, u, blocks, opts) {
  opts = opts || {};
  return (blocks || [{ type: 'text', text: 'ok' }]).map(function (b) {
    return { type: 'assistant', timestamp: iso(opts.at || T0),
      message: { id: id, model: opts.model || 'claude-opus-5-5', role: 'assistant', content: [b],
        stop_reason: opts.stop === undefined ? 'end_turn' : opts.stop, usage: u } };
  });
}
function tool(name, id) { return { type: 'tool_use', id: id, name: name, input: {} }; }
function result(promptId, toolId) {
  return { type: 'user', promptId: promptId, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolId }] } };
}
function compact() { return { type: 'system', subtype: 'compact_boundary', timestamp: iso(T0) }; }
function flat(list) { return [].concat.apply([], list); }

// Turn 1 (p1) ends with a reply of 80k context; turn 2 (p2) makes three API calls.
function twoTurns() {
  return flat([
    [prompt('p1', T0 - 60e3)],
    reply('m0', usage(10, 70000, 9000, 1000)),
    [prompt('p2', T0)],
    reply('m1', usage(2, 80000, 500, 300), [{ type: 'thinking', thinking: '' }, tool('Read', 't1'), tool('Read', 't2')]),
    [result('p2', 't1'), result('p2', 't2')],
    reply('m2', usage(3, 80500, 4000, 700, { output_tokens_details: { thinking_tokens: 200 } }),
      [tool('mcp__plugin_playwright_playwright__browser_click', 't3')]),
    [result('p2', 't3')],
    reply('m3', usage(1, 84500, 2000, 2400)),
  ]);
}

test('analyze: the turn starts at its prompt, counts each reply once, and finds the reply before it', () => {
  const a = turn.analyze(twoTurns(), 'p2');
  assert.equal(a.startAt, T0);
  assert.equal(a.replies.length, 3);
  assert.deepEqual(a.tokens, { input: 6, output: 3400, cacheRead: 245000, cacheWrite: 6500, thinking: 200 });
  assert.deepEqual(a.tools, [['Read', 2], ['browser_click', 1]]);
  assert.equal(a.ctxBefore, 10 + 70000 + 9000 + 1000);
  assert.equal(a.ctxAfter, 1 + 84500 + 2000 + 2400);
  assert.equal(a.compacted, false);
  assert.equal(a.subagents, false);
  assert.equal(a.note, null);
});

test('analyze: a first turn has no context before it; a compaction before the prompt starts afresh', () => {
  const first = turn.analyze(flat([[prompt('p1', T0)], reply('m0', usage(5, 0, 30000, 900))]), 'p1');
  assert.equal(first.ctxBefore, null);
  const after = turn.analyze(flat([[prompt('p1', T0 - 9e3)], reply('m0', usage(5, 0, 150000, 900)), [compact(), prompt('p2', T0)],
    reply('m1', usage(5, 0, 30000, 900))]), 'p2');
  assert.equal(after.ctxBefore, null);
  assert.equal(after.compacted, false);
});

test('analyze: a compaction during the turn is marked; Agent calls and a cut-off reply are noted', () => {
  const a = turn.analyze(flat([[prompt('p1', T0 - 9e3)], reply('m0', usage(5, 150000, 100, 900)), [prompt('p2', T0)],
    reply('m1', usage(5, 150000, 100, 50), [tool('Agent', 'a1')]), [result('p2', 'a1'), compact()],
    reply('m2', usage(5, 0, 30000, 70), null, { stop: null })]), 'p2');
  assert.equal(a.compacted, true);
  assert.equal(a.subagents, true);
  assert.equal(a.note, 'interrupted');
});

test('analyze: with no prompt id the last human prompt starts the turn; an unknown id finds nothing', () => {
  const lines = twoTurns();
  assert.equal(turn.analyze(lines, null).startAt, T0);
  assert.equal(turn.analyze(lines, 'nope'), null);
});

test('weighted: tokens in input-price units', () => {
  const u = { input_tokens: 100, cache_read_input_tokens: 1000, output_tokens: 10, cache_creation_input_tokens: 300,
    cache_creation: { ephemeral_1h_input_tokens: 200, ephemeral_5m_input_tokens: 100 } };
  assert.equal(turn.weighted(u), 100 + 100 + 400 + 125 + 50);
  // Without the split, a cache write counts as the 1h one Claude Code writes.
  assert.equal(turn.weighted({ input_tokens: 0, cache_creation_input_tokens: 10, output_tokens: 0, cache_read_input_tokens: 0 }), 20);
});

function hist(entries) { return { window: 200000, h: entries }; }
function entry(u, c, la, lr, t) { return { s: history.sig(u), c: c, la: la, lr: lr, t: t }; }

test('price: replies the status line recorded are priced from Claude Code\'s own cost', () => {
  const a = turn.analyze(twoTurns(), 'p2');
  const h = hist([entry(usage(10, 70000, 9000, 1000), 1.00, 10, 2, T0 - 5e3), entry(usage(1, 84500, 2000, 2400), 1.41, 58, 14, T0 + 30e3)]);
  const pr = turn.price(a, h, {});
  assert.equal(pr.cost.toFixed(2), '0.41');
  assert.equal(pr.partial, false);
  assert.deepEqual(pr.lines, { added: 48, removed: 12 });
  assert.equal(pr.rate.model, 'claude-opus-5-5');
  assert.ok(pr.rate.value > 0);
});

test('price: replies after the last redraw are priced at the measured rate, or marked partial without one', () => {
  const a = turn.analyze(twoTurns(), 'p2');
  // The status line last drew after m2; m3 is not recorded yet.
  const h = hist([entry(usage(10, 70000, 9000, 1000), 1.00, 0, 0, T0 - 5e3), entry(usage(3, 80500, 4000, 700), 1.30, 0, 0, T0 + 20e3)]);
  const w = a.replies.map(function (r) { return turn.weighted(r.usage); });
  // This turn's own rate, measured on m1 and m2, wins over a stored one.
  const rated = turn.price(a, h, { 'claude-opus-5-5': { rate: 1e-5 } });
  assert.equal(rated.partial, false);
  assert.equal(rated.cost.toFixed(4), (0.30 + w[2] * 0.30 / (w[0] + w[1])).toFixed(4));
  // Nothing recorded since the prompt: a stored rate prices it all, or nothing is known but a part.
  const early = hist([entry(usage(10, 70000, 9000, 1000), 1.00, 0, 0, T0 - 5e3)]);
  const stored = turn.price(a, early, { 'claude-opus-5-5': { rate: 1e-5 } });
  assert.equal(stored.cost.toFixed(4), ((w[0] + w[1] + w[2]) * 1e-5).toFixed(4));
  assert.equal(stored.partial, false);
  assert.equal(turn.price(a, early, {}).cost, null);
  const other = turn.price(a, early, { 'claude-haiku-4-5': { rate: 1e-6 } });
  assert.equal(other.cost, null); // another model's rate is never used
});

test('price: a turn that ran subagents does not set the rate; no history gives no cost without a rate', () => {
  const a = turn.analyze(twoTurns(), 'p2');
  a.subagents = true;
  const h = hist([entry(usage(10, 70000, 9000, 1000), 1.00, 0, 0, T0 - 5e3), entry(usage(1, 84500, 2000, 2400), 1.41, 0, 0, T0 + 30e3)]);
  assert.equal(turn.price(a, h, {}).rate, null);
  const none = turn.price(turn.analyze(twoTurns(), 'p2'), null, {});
  assert.equal(none.cost, null);
  assert.equal(none.lines, null);
});

test('values and the default line', () => {
  const a = turn.analyze(twoTurns(), 'p2');
  const pr = { cost: 0.4123, partial: false, lines: { added: 48, removed: 12 } };
  const v = turn.values(a, pr, 200000, T0 + 103e3);
  assert.equal(v.duration.text, '1m 43s');
  assert.equal(v.ctx.text, '+8.9k (4%)');
  assert.equal(v['ctx.total'].text, '88.9k');
  assert.equal(v.cost.text, '$0.41');
  assert.equal(turn.draw(turn.defaultTemplate(), v, ' · '),
    'ctx +8.9k (4%) · in 6 · out 3.4k · cache 245k read / 6.5k write (97% hit) · 3 calls · Read 2, browser_click 1 · +48 −12 lines · $0.41');
});

test('values: first turn, compaction, partial cost, no tools, no lines', () => {
  const first = turn.analyze(flat([[prompt('p1', T0)], reply('m0', usage(5, 0, 30000, 900))]), 'p1');
  const v = turn.values(first, { cost: 0.1, partial: true, lines: { added: 0, removed: 0 } }, 1000000, T0 + 8e3);
  assert.equal(v.ctx.text, '30.9k (3%)');
  assert.equal(v.cost.text, '$0.10+');
  assert.equal(v.tools, null);
  assert.equal(v['lines.added'], null);
  assert.equal(v.calls.text, '1 call');
  const c = turn.analyze(flat([[prompt('p1', T0)], reply('m1', usage(5, 0, 30000, 70), [tool('Bash', 'b')]), [compact()],
    reply('m2', usage(5, 0, 3000, 70))]), 'p1');
  assert.equal(turn.values(c, { cost: null, partial: false, lines: null }, 200000, T0).ctx.text, 'compacted');
  assert.equal(turn.values(c, { cost: null, partial: false, lines: null }, 200000, T0).cost, null);
});

test('formatting helpers', () => {
  assert.equal(turn.tk(950), '950');
  assert.equal(turn.tk(12000), '12k');
  assert.equal(turn.tk(12449), '12.4k');
  assert.equal(turn.tk(610400), '610k');
  assert.equal(turn.tk(1260000), '1.3M');
  assert.equal(turn.duration(8e3), '8s');
  assert.equal(turn.duration(3725e3), '1h 02m');
  assert.equal(turn.money(0.004), '$0.00');
  assert.equal(turn.money(12.5), '$12.50');
  assert.equal(turn.money(123.4), '$123');
});

function writeLines(file, lines) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.map(function (l) { return JSON.stringify(l); }).join('\n') + '\n');
}

test('readTail: reads back in growing chunks until the prompt is found', () => {
  const t = tmpEnv();
  try {
    const file = path.join(t.base, 't.jsonl');
    const pad = { type: 'api-request', blob: 'x'.repeat(5000) };
    writeLines(file, flat([[prompt('p1', T0 - 9e3)], reply('m0', usage(1, 1, 1, 1)), [pad, pad], [prompt('p2', T0)], [pad, pad, pad],
      reply('m1', usage(1, 2, 1, 1))]));
    const lines = turn.readTail(file, 'p2', { chunk: 4096 });
    const a = turn.analyze(lines, 'p2');
    assert.equal(a.replies.length, 1);
    assert.equal(a.ctxBefore, 4); // m0 was reached too
  } finally { t.cleanup(); }
});

test('readTail: a tool result carrying the prompt id is not the prompt; reading goes on to it', () => {
  const t = tmpEnv();
  try {
    const file = path.join(t.base, 't.jsonl');
    const pad = { type: 'api-request', blob: 'x'.repeat(5000) };
    writeLines(file, flat([[prompt('p1', T0 - 9e3)], reply('m0', usage(1, 1, 1, 1)), [prompt('p2', T0)], [pad, pad],
      reply('m1', usage(1, 2, 1, 1), [tool('Bash', 'b1')], { at: T0 + 60e3 }), [pad, pad, result('p2', 'b1')],
      reply('m2', usage(1, 3, 1, 1))]));
    const a = turn.analyze(turn.readTail(file, 'p2', { chunk: 4096 }), 'p2');
    assert.equal(a.startAt, T0);
    assert.equal(a.replies.length, 2);
  } finally { t.cleanup(); }
});

test('run: prints the line as a systemMessage, saves the turn for line 1, and learns the rate', () => {
  const t = tmpEnv();
  try {
    const file = path.join(t.base, 'proj', 's1.jsonl');
    writeLines(file, twoTurns());
    writeJson(path.join(t.p.sessionsDir, 's1.cost.json'),
      hist([entry(usage(10, 70000, 9000, 1000), 1.00, 10, 2, T0 - 5e3), entry(usage(1, 84500, 2000, 2400), 1.41, 58, 14, T0 + 30e3)]));
    const out = turn.run(JSON.stringify({ session_id: 's1', transcript_path: file, prompt_id: 'p2', hook_event_name: 'Stop' }),
      { env: t.env, now: T0 + 103e3 });
    const msg = JSON.parse(out).systemMessage;
    assert.equal(msg, 'ctx +8.9k (4%) · in 6 · out 3.4k · cache 245k read / 6.5k write (97% hit) · 3 calls · Read 2, browser_click 1 · +48 −12 lines · $0.41');
    const last = JSON.parse(fs.readFileSync(path.join(t.p.sessionsDir, 's1.last.json'), 'utf8'));
    assert.equal(last.cost.toFixed(2), '0.41');
    assert.equal(last.ctx, '+8.9k (4%)');
    assert.ok(JSON.parse(fs.readFileSync(path.join(t.p.stateDir, 'rates.json'), 'utf8'))['claude-opus-5-5'].rate > 0);
  } finally { t.cleanup(); }
});

test('run: a custom template applies; bad input, a missing transcript or no replies print nothing', () => {
  const t = tmpEnv();
  try {
    const file = path.join(t.base, 's1.jsonl');
    writeLines(file, twoTurns());
    writeJson(t.p.configFile, { display: { turn: '{duration}{sep}[{calls}]' } });
    const input = { session_id: 's1', transcript_path: file, prompt_id: 'p2' };
    assert.equal(JSON.parse(turn.run(JSON.stringify(input), { env: t.env, now: T0 + 5e3 })).systemMessage, '5s · 3 calls');
    assert.equal(turn.run('not json', { env: t.env }), '');
    assert.equal(turn.run(JSON.stringify(Object.assign({}, input, { transcript_path: path.join(t.base, 'none.jsonl') })), { env: t.env }), '');
    writeLines(file, [prompt('p9', T0)]);
    assert.equal(turn.run(JSON.stringify(Object.assign({}, input, { prompt_id: 'p9' })), { env: t.env }), '');
  } finally { t.cleanup(); }
});

test('history.record: one entry per reply, only when the reply or the cost changes, capped', () => {
  const t = tmpEnv();
  try {
    const d = function (read, cost) {
      return { session_id: 's1', cost: { total_cost_usd: cost, total_lines_added: 3, total_lines_removed: 1 },
        context_window: { context_window_size: 200000,
          current_usage: { input_tokens: 1, cache_read_input_tokens: read, cache_creation_input_tokens: 5, output_tokens: 9 } } };
    };
    history.record(t.p, d(100, 0.1), T0);
    history.record(t.p, d(100, 0.1), T0 + 1);
    history.record(t.p, d(200, 0.2), T0 + 2);
    let h = history.read(t.p, 's1');
    assert.equal(h.window, 200000);
    assert.equal(h.h.length, 2);
    assert.deepEqual(h.h[1], { s: '1,200,5', c: 0.2, la: 3, lr: 1, t: T0 + 2 });
    for (let i = 0; i < history.CAP + 5; i++) history.record(t.p, d(1000 + i, 1 + i), T0 + 10 + i);
    h = history.read(t.p, 's1');
    assert.equal(h.h.length, history.CAP);
    history.record(t.p, { session_id: 's2' }, T0); // nothing to record
    assert.equal(history.read(t.p, 's2'), null);
  } finally { t.cleanup(); }
});
