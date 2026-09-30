'use strict';
// Rows for Claude Code's agent panel (settings.json subagentStatusLine): each subagent's
// type and live activity, then its stats, drawn through display.subagent.
//
// Claude Code runs this once per refresh with every visible row of this session. For each
// task we print {"id","content"}; a task we print nothing for keeps Claude Code's own row,
// and an empty content would hide it, so an empty row is never printed.

const fs = require('fs');
const path = require('path');
const paths = require('./paths');
const config = require('./config');
const F = require('./format');
const L = require('./lines');

const MIN_ACTIVITY = 10;

// The input has no agent type; Claude Code keeps it in a meta file next to the session
// transcript. That file is undocumented, so anything unexpected means "no type".
function agentType(transcriptPath, id) {
  if (typeof transcriptPath !== 'string' || !transcriptPath) return null;
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(id)) return null; // stays inside subagents/
  const file = path.join(transcriptPath.replace(/\.jsonl$/, ''), 'subagents', 'agent-' + id + '.meta.json');
  try {
    const meta = JSON.parse(fs.readFileSync(file, 'utf8'));
    return meta && typeof meta.agentType === 'string' && meta.agentType ? meta.agentType : null;
  } catch (e) { return null; }
}

// Too wide for the panel: shorten the activity so the stats at the end stay visible.
function fit(tpl, values, style, sep, columns) {
  const line = L.drawLine(tpl, values, style, sep);
  const act = values.activity;
  if (!columns || !act || F.visibleWidth(line) <= columns) return line;
  const chars = Array.from(act.text); // by code point, so an emoji is never cut in half
  if (chars.length <= MIN_ACTIVITY) return line;
  const room = F.visibleWidth(act.text) - (F.visibleWidth(line) - columns) - 1; // columns before the …
  let text = '';
  let used = 0;
  let n = 0;
  for (; n < chars.length; n++) {
    const w = F.charWidth(chars[n], chars[n + 1]);
    if (n >= MIN_ACTIVITY - 1 && used + w > room) break;
    text += chars[n];
    used += w;
  }
  if (n === chars.length) return line;
  const shorter = Object.assign({}, values, { activity: { text: text + '…', role: act.role } });
  return L.drawLine(tpl, shorter, style, sep);
}

function run(stdinText, opts) {
  opts = opts || {};
  let d = null;
  try { d = JSON.parse(stdinText); } catch (e) { return ''; }
  if (!d || typeof d !== 'object' || !Array.isArray(d.tasks)) return '';
  const env = opts.env || process.env;
  const now = opts.now != null ? opts.now : Date.now();
  const disp = config.load(paths.resolve(env)).display;
  const style = F.makeStyle(disp, env);
  const columns = Number.isInteger(d.columns) && d.columns > 0 ? d.columns : 0;
  const out = [];
  d.tasks.forEach(function (t) {
    if (!t || typeof t !== 'object' || typeof t.id !== 'string' || !t.id) return;
    try {
      const values = L.subagent(t, agentType(d.transcript_path, t.id), now, style);
      const content = fit(disp.templates.subagent, values, style, disp.separator, columns);
      if (content !== '') out.push(JSON.stringify({ id: t.id, content: content }));
    } catch (e) { /* this row keeps Claude Code's default */ }
  });
  return out.length ? out.join('\n') + '\n' : '';
}

module.exports = { run, agentType, fit };
