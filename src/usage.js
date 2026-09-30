'use strict';
// Claude Code's own /usage, run headless for another account: where Claude Code is,
// how to start it, and how to read its answer. Claude Code does the login and the
// network call; sline reads no credential and contacts no server.

const fs = require('fs');
const path = require('path');
const F = require('./format');

// 0 model turns, no quota. The assistant event carries usage_report.rate_limits.
const ARGS = ['-p', '/usage', '--no-session-persistence', '--output-format', 'stream-json', '--verbose'];

function exists(f) { try { return fs.existsSync(f); } catch (e) { return false; } }

// npm installs claude.cmd, a wrapper around the real claude.exe beside it, which can be
// started without a shell. The native installer puts claude.exe on PATH directly.
function findClaude(envPath, platform) {
  const dirs = String(envPath || '').split(path.delimiter).filter(Boolean);
  for (const d of dirs) {
    if (platform === 'win32') {
      if (exists(path.join(d, 'claude.exe'))) return path.join(d, 'claude.exe');
      const inner = path.join(d, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
      if (exists(path.join(d, 'claude.cmd')) && exists(inner)) return inner;
    } else if (exists(path.join(d, 'claude'))) {
      return path.join(d, 'claude');
    }
  }
  return null;
}

// What to start; CLAUDE_SLINE_CLAUDE (tests) names a Node script to run instead.
function command(env, platform) {
  if (env.CLAUDE_SLINE_CLAUDE) {
    return { file: process.execPath, args: [env.CLAUDE_SLINE_CLAUDE].concat(ARGS), path: env.CLAUDE_SLINE_CLAUDE };
  }
  const exe = findClaude(env.PATH || env.Path, platform || process.platform);
  return exe ? { file: exe, args: ARGS.slice(), path: exe } : null;
}

function epoch(iso) {
  const ms = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

function slot(l) {
  const v = l ? F.cleanPct(l.percent, 100) : null;
  return v != null ? { utilization: v, resets_at: epoch(l.resets_at) } : null;
}

// session → 5h, weekly_all → 7d, weekly_scoped → per-model weekly rows (Fable on Max).
// No usage_report (no login, rate limited, not a
// subscriber: all print the cost view instead) → null.
function parse(stdout) {
  let limits = null;
  String(stdout || '').split('\n').forEach(function (line) {
    let j;
    try { j = JSON.parse(line); } catch (e) { return; }
    const ur = j && (j.usage_report || (j.message && j.message.usage_report));
    if (ur && ur.rate_limits && Array.isArray(ur.rate_limits.limits)) limits = ur.rate_limits.limits;
  });
  if (!limits) return null;
  const by = function (kind) { return limits.find(function (l) { return l && l.kind === kind; }); };
  const five = slot(by('session'));
  const seven = slot(by('weekly_all'));
  // Claude Code: "Classify a row on this [kind], never on a label." The name is its own label.
  const scoped = limits.filter(function (l) { return l && l.kind === 'weekly_scoped'; }).map(function (l) {
    const name = l.scope && l.scope.model && typeof l.scope.model.display_name === 'string'
      ? l.scope.model.display_name.trim() : '';
    const s = slot(l);
    return name && s ? { name: name.slice(0, 40), utilization: s.utilization, resets_at: s.resets_at } : null;
  }).filter(Boolean);
  return five || seven || scoped.length ? { five_hour: five, seven_day: seven, scoped: scoped } : null;
}

module.exports = { ARGS, findClaude, command, parse };
