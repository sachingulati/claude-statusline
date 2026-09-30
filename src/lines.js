'use strict';
// What the templates draw: the default display settings, the fields each line (and each
// subagent row) offers, their values ({text, role}, or null when empty), and the drawn lines.

const T = require('./template');
const F = require('./format');
const PT = require('./passthrough');
const FIT = require('./fit');
const { toForward } = require('./paths');

const oneLine = F.oneLine;

const HOUR = 3600e3;

const FIELDS = {
  line1: ['dir', 'dir.full', 'dir.name', 'branch', 'model', 'model.name', 'effort', 'ctx', 'session'],
  label: ['label'],
  account: ['5h', '5h.reset', '5h.pace', '7d', '7d.pace', '7d.reset', '7d.model', '7d.model.reset', 'spend', 'spend.reset', 'age', 'status'],
  subagent: ['type', 'activity', 'model', 'model.name', 'effort', 'ctx', 'tokens', 'elapsed'],
};

// Today's status line, character for character.
const DEFAULT_TEMPLATES = {
  line1: 'dir:{dir}[ ({branch})]{sep}[model:{model.name}]{sep}[effort:{effort}]{sep}[ctx: {ctx}]{sep}[session:{session}]',
  label: '\\[{label}\\] ',
  account: '[5h: {5h}, {5h.reset}]{sep}[7d: {7d} / {7d.pace}, {7d.reset}]{sep}[spend: {spend}, {spend.reset}][{status}][  {age}]',
  subagent: '[{type}  ]{activity}{sep}[model:{model.name}]{sep}[effort:{effort}]{sep}[ctx: {ctx}]{sep}[tokens:{tokens}]{sep}[{elapsed}]',
};

const DEFAULT_DISPLAY = {
  separator: ' · ',
  thresholds: {
    ctx: [30, 65], '5h': [30, 75], '7d': [30, 75], spend: [30, 75],
    '7dPace': true, '5hPace': false, '5hResetSoon': 60, '7dResetSoon': 48,
  },
  colors: { ok: 'green', warn: 'yellow', high: 'orange', dim: 'dim' },
  clock: '24h',
};

function defaultTemplate(which) { return { parts: T.parse(DEFAULT_TEMPLATES[which]).parts, broken: false }; }

function defaultDisplay() {
  return {
    otherAccounts: true,
    templates: {
      line1: defaultTemplate('line1'), label: defaultTemplate('label'),
      account: defaultTemplate('account'), subagent: defaultTemplate('subagent'),
    },
    separator: DEFAULT_DISPLAY.separator,
    thresholds: Object.assign({}, DEFAULT_DISPLAY.thresholds),
    colors: Object.assign({}, DEFAULT_DISPLAY.colors),
    clock: DEFAULT_DISPLAY.clock,
    width: 'auto',
    problems: [],
  };
}

function plain(text) { return text == null || text === '' ? null : { text: String(text), role: null }; }

function pctValue(val, pair) {
  const v = Math.round(val);
  return { text: F.pct(v), role: F.level(v, pair) };
}

// Unknown resets keep a dim stand-in so the columns stay put.
function resetValue(resetsAt, withDay, now, style, soonMs, soonRole) {
  const t = resetsAt != null ? F.formatResetTime(resetsAt, withDay, now, style.clock) : null;
  if (t == null) return { text: withDay ? '--- --:--' : '--:--', role: 'dim' };
  return { text: t, role: soonMs > 0 && resetsAt * 1000 - now < soonMs ? soonRole : null };
}

function line1(d, cwd, home, branch, style) {
  const model = d.model || {};
  const cw = d.context_window || {};
  const full = toForward(cwd).replace(/^\/([a-zA-Z])\//, '$1:/').replace(/(.)\/+$/, '$1');
  return {
    dir: plain(F.displayPath(cwd, home)),
    'dir.full': plain(full || '/'),
    'dir.name': plain(full.split('/').filter(Boolean).pop() || full || '/'),
    branch: plain(branch),
    model: plain(model.id),
    'model.name': plain(model.display_name || (typeof model.id === 'string' && model.id ? modelName(model.id) : null)),
    effort: plain(d.effort && d.effort.level),
    ctx: F.cleanPct(cw.used_percentage, 100) != null ? pctValue(F.cleanPct(cw.used_percentage, 100), style.thresholds.ctx) : null,
    session: cw.total_input_tokens != null && cw.total_output_tokens != null
      ? plain(F.formatTokens(cw.total_input_tokens + cw.total_output_tokens) + 'tk') : null,
  };
}

function account(u, now, workingDays, style) {
  const th = style.thresholds;
  const v = {};
  FIELDS.account.forEach(function (k) { v[k] = null; });
  if (u.status === 'nodata') { v.status = { text: 'usage:--', role: 'dim' }; return v; }

  // Guard d: right after a reset almost no time has passed, so any use at all looks
  // "over pace"; judge pace only after a first stretch of the window.
  const early = function (resetsAt, windowMs, graceMs) {
    return resetsAt != null && now < resetsAt * 1000 - windowMs + graceMs;
  };

  const f = u.five;
  if (f && f.utilization != null) {
    const p5 = F.pace5hPct(f.resets_at, now);
    const val = pctValue(f.utilization, th['5h']);
    if (th['5hPace'] && p5 != null && Math.round(f.utilization) > p5 && !early(f.resets_at, 5 * HOUR, 30 * 60e3)) val.role = 'high';
    v['5h'] = val;
    v['5h.pace'] = p5 != null ? plain(F.pct(Math.round(p5))) : { text: '--%', role: 'dim' };
    // Green: the wait is nearly over.
    v['5h.reset'] = resetValue(f.resets_at, false, now, style, th['5hResetSoon'] * 60e3, 'ok');
  }
  const s = u.seven;
  if (s && s.utilization != null) {
    const pace = F.pacePct(s.resets_at, now, workingDays);
    const val = pctValue(s.utilization, th['7d']);
    // 7d is judged against pace: 60% is fine on day 6, alarming on day 1.
    if (th['7dPace'] && pace != null && Math.round(s.utilization) > pace && !early(s.resets_at, 7 * 24 * HOUR, 24 * HOUR)) val.role = 'high';
    v['7d'] = val;
    v['7d.pace'] = pace != null ? plain(F.pct(Math.round(pace))) : { text: '--%', role: 'dim' };
    v['7d.reset'] = resetValue(s.resets_at, true, now, style, th['7dResetSoon'] * HOUR, 'high');
  }
  // Per-model weekly windows (Fable on Max): only a background check sees them. Each row
  // carries its own name, so a new model needs no release.
  const rows = Array.isArray(u.scoped) ? u.scoped.filter(function (r) {
    return r && F.oneLine(r.name) && F.cleanPct(r.utilization, 100) != null;
  }) : [];
  if (rows.length) {
    v['7d.model'] = {
      text: rows.map(function (r) {
        const pv = pctValue(F.cleanPct(r.utilization, 100), th['7d']);
        return F.oneLine(r.name) + ' ' + F.paint(style, pv.role, pv.text);
      }).join(', '),
      role: null, // each row is painted above
    };
    const resets = rows.map(function (r) { return r.resets_at; }).filter(function (x) { return x != null; });
    v['7d.model.reset'] = resetValue(resets.length ? Math.min.apply(null, resets) : null, true, now, style, 0, null);
  }
  const sp = u.spend;
  if (sp && sp.used_percentage != null) {
    v.spend = pctValue(sp.used_percentage, th.spend);
    v['spend.reset'] = resetValue(sp.resets_at, true, now, style, 0, null);
  }
  if (u.age) v.age = { text: '(' + F.formatAge(u.age.seconds) + ' ago)', role: 'dim' };
  return v;
}

function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }

// claude-haiku-4-5-20251001 → Haiku 4.5; claude-opus-5-5[1m] → Opus 5.5 (1M). An ID of any
// other shape is shown as it is.
function modelName(id) {
  const m = /^claude-([a-z]+)-(\d{1,2})(?:-(\d{1,2}))?(?:-\d{8})?(?:\[([a-z0-9]+)\])?$/.exec(id);
  if (!m) return id;
  return m[1][0].toUpperCase() + m[1].slice(1) + ' ' + m[2] + (m[3] != null ? '.' + m[3] : '')
    + (m[4] != null ? ' (' + m[4].toUpperCase() + ')' : '');
}

// task: one entry of subagentStatusLine's "tasks"; type: from its meta file, or null.
function subagent(task, type, now, style) {
  const id = oneLine(task.model);
  const tokens = num(task.tokenCount);
  const size = num(task.contextWindowSize);
  const start = num(task.startTime);
  return {
    type: plain(oneLine(type)),
    activity: plain(oneLine(task.label) || oneLine(task.description)),
    model: plain(id),
    'model.name': plain(id && modelName(id)),
    effort: plain(num(task.effort) != null ? String(task.effort) : oneLine(task.effort)),
    ctx: tokens != null && tokens >= 0 && size > 0 ? pctValue(tokens / size * 100, style.thresholds.ctx) : null,
    tokens: tokens != null && tokens >= 0 ? plain(F.formatTokens(tokens)) : null,
    elapsed: task.status === 'running' && start != null && now >= start ? plain(F.formatElapsed(now - start)) : null,
  };
}

function painter(style) { return function (role, text) { return F.paint(style, role, text); }; }

function hint(broken, style) {
  return broken ? '  ' + F.paint(style, 'dim', '(template error: /sline:doctor)') : '';
}

function drawLine(tpl, values, style, sep, drop) {
  return T.render(FIT.dropGroups(tpl.parts, drop || 0), values, { paint: painter(style), sep: sep }) + hint(tpl.broken, style);
}

// The label is its own template so it never counts as "something before" a {sep}.
function drawAccount(display, label, values, style, drop) {
  const t = display.templates;
  const opts = { paint: painter(style), sep: display.separator };
  const body = T.render(FIT.dropGroups(t.account.parts, drop || 0), values, opts);
  if (body === '') return ''; // nothing to show: no bare label, no hint
  const head = label ? T.render(t.label.parts, { label: plain(label) }, opts) : '';
  return head + body + hint(t.label.broken || t.account.broken, style);
}

// Columns the status line may use: Claude Code passes the terminal's width as COLUMNS; its
// own indent takes a little. 0 = don't fit (no width known, or fitting is off).
function lineWidth(display, env) {
  if (display.width === 'off') return 0;
  if (typeof display.width === 'number') return display.width;
  const c = Number(env && env.COLUMNS);
  return Number.isInteger(c) && c > 2 ? c - 2 : 0;
}

// Line 1: a shorter folder first (long paths are what overflow), then groups from the
// right, then a cut.
function fitLine1(width, tpl, values, style, sep) {
  let line = drawLine(tpl, values, style, sep, 0);
  if (!width || F.visibleWidth(line) <= width) return line;
  const dv = values.dir ? FIT.dirVariants(values.dir.text) : [];
  const fv = values['dir.full'] ? FIT.dirVariants(values['dir.full'].text) : [];
  let vals = values;
  for (let i = 1; i < Math.max(dv.length, fv.length); i++) {
    vals = Object.assign({}, values);
    if (dv.length) vals.dir = { text: dv[Math.min(i, dv.length - 1)], role: values.dir.role };
    if (fv.length) vals['dir.full'] = { text: fv[Math.min(i, fv.length - 1)], role: values['dir.full'].role };
    line = drawLine(tpl, vals, style, sep, 0);
    if (F.visibleWidth(line) <= width) return line;
  }
  const n = FIT.groupCount(tpl.parts);
  for (let k = 1; k <= n; k++) {
    const l = drawLine(tpl, vals, style, sep, k);
    if (l === '') break;
    line = l;
    if (F.visibleWidth(line) <= width) return line;
  }
  return FIT.truncate(line, width);
}

// Account lines drop the same groups so their columns stay aligned; the first group always
// stays. A usage:-- line (status set) is never dropped from, only cut.
function fitAccounts(width, display, rows, style) {
  const n = FIT.groupCount(display.templates.account.parts);
  let k = 0;
  if (width) {
    rows.forEach(function (r) {
      if (r.values.status) return;
      let kk = 0;
      while (kk < n - 1 && F.visibleWidth(drawAccount(display, r.label, r.values, style, kk)) > width) kk++;
      k = Math.max(k, kk);
    });
  }
  return rows.map(function (r) {
    // A line whose only groups are among the dropped ones keeps the most it can instead of vanishing.
    let drop = r.values.status ? 0 : k;
    let l = drawAccount(display, r.label, r.values, style, drop);
    while (l === '' && drop > 0) l = drawAccount(display, r.label, r.values, style, --drop);
    return width ? FIT.truncate(l, width) : l;
  });
}

// Line 1 names that aren't sline fields are read from Claude Code's JSON (sline wins a clash).
function withPassThrough(values, d, parts, now, clock) {
  const names = T.fields(parts).map(function (f) { return f.name; }).filter(function (n) {
    return !Object.prototype.hasOwnProperty.call(values, n) && PT.NAME.test(n);
  });
  return Object.assign(PT.values(d || {}, names, now, clock), values);
}

// A fixed example, so /sline:config can show what a change looks like.
function sampleLines(display) {
  const style = { colors: { ok: '', warn: '', high: '', dim: '' }, thresholds: display.thresholds, clock: display.clock };
  const now = new Date(2026, 9, 1, 20, 0, 0).getTime(); // Thu 1 Oct 2026 20:00 local
  const at = function (day, h, m) { return Math.floor(new Date(2026, 9, day, h, m).getTime() / 1000); };
  const week = at(5, 17, 29); // Mon 17:29
  const days = [0, 1, 2, 3, 4, 5, 6];
  const sample = {
    model: { id: 'claude-opus-5-5', display_name: 'Opus 5.5' },
    effort: { level: 'high' },
    context_window: { used_percentage: 12, total_input_tokens: 300000, total_output_tokens: 40000 },
    session_name: 'fix login bug', cost: { total_cost_usd: 1.23, total_duration_ms: 754000 },
    prompt_cache: { expires_at: Math.floor(now / 1000) + 240 },
  };
  const l1 = withPassThrough(line1(sample, '/home/me/projects/app', '/home/me', 'main', style), sample, display.templates.line1.parts, now, display.clock);
  const active = account({ five: { utilization: 52, resets_at: at(1, 23, 49) }, seven: { utilization: 38, resets_at: week } }, now, days, style);
  const other = account({
    five: { utilization: 29, resets_at: at(2, 1, 0) }, seven: { utilization: 28, resets_at: week },
    age: { seconds: 180 },
  }, now, days, style);
  const sub = subagent({
    status: 'running', description: 'Review the diff', label: 'Reading fsutil.js', startTime: now - 102000,
    model: 'claude-haiku-4-5-20251001', contextWindowSize: 200000, tokenCount: 32400,
  }, 'general-purpose', now, style);
  // Like the status line: labels only when more than one account line shows.
  const accounts = display.otherAccounts
    ? [drawAccount(display, 'A', active, style), drawAccount(display, 'B', other, style)]
    : [drawAccount(display, null, active, style)];
  return [
    drawLine(display.templates.line1, l1, style, display.separator),
  ].concat(accounts, [
    // Claude Code draws the ○; it's here so the sample reads like the agent panel.
    '○ ' + drawLine(display.templates.subagent, sub, style, display.separator),
  ]);
}

// Only an account template that shows per-model rows needs the active account checked.
function usesModel(tpl) {
  return T.fields(tpl.parts).some(function (f) { return f.name === '7d.model' || f.name === '7d.model.reset'; });
}

module.exports = {
  usesModel, FIELDS, DEFAULT_TEMPLATES, DEFAULT_DISPLAY, defaultDisplay,
  line1, account, subagent, modelName, withPassThrough, drawLine, drawAccount, sampleLines,
  lineWidth, fitLine1, fitAccounts,
};
