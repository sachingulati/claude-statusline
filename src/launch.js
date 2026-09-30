#!/usr/bin/env node
'use strict';
// sline launcher. Copied to <stateDir>/launch.js by the sline plugin;
// Claude Code's settings.json runs this file. It reads the current plugin folder
// from the "root" file next to it, so plugin updates never break settings.json.
//
// An update installs into a new folder. Each render asks Claude Code's install
// record which folder is current, follows it, and refreshes this file from that
// folder's template. That is why the plugin needs no SessionStart hook.
//
// "launch.js subagents" (settings.json subagentStatusLine) draws the agent panel's rows
// through src/subagents.js instead. Its output must be JSON rows, so it never prints a message.

const fs = require('fs');
const path = require('path');

const DIM = '\x1b[2m';
const RESET = '\x1b[0m';
const ROOT_FILE = path.join(__dirname, 'root');

function say(msg) { process.stdout.write(DIM + 'sline: ' + msg + RESET + '\n'); }

function samePath(a, b) {
  const n = function (x) { const r = path.resolve(x); return process.platform === 'win32' ? r.toLowerCase() : r; };
  return n(a) === n(b);
}

// Marketplace installs live at <plugins>/cache/<marketplace>/<plugin>/<version>, and
// <plugins>/installed_plugins.json names the current folder. That file is Claude
// Code's own, undocumented: anything unexpected means "stay where you are".
function installedRoot(root) {
  try {
    const version = path.resolve(root);
    const plugin = path.dirname(version);
    const mkt = path.dirname(plugin);
    const cache = path.dirname(mkt);
    if (path.basename(cache) !== 'cache') return null;
    const record = JSON.parse(fs.readFileSync(path.join(path.dirname(cache), 'installed_plugins.json'), 'utf8'));
    const list = record && record.plugins && record.plugins[path.basename(plugin) + '@' + path.basename(mkt)];
    if (!Array.isArray(list) || !list.length) return null;
    const pick = list.find(function (e) { return e && e.scope === 'user'; }) ||
      list.slice().sort(function (a, b) { return String(b && b.lastUpdated).localeCompare(String(a && a.lastUpdated)); })[0];
    return pick && typeof pick.installPath === 'string' ? pick.installPath : null;
  } catch (e) { return null; }
}

function writeAtomic(file, text) {
  const tmp = file + '.' + process.pid + '.tmp';
  try {
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, file);
  } catch (e) {
    // Another session may hold the file; the next render tries again.
    try { fs.unlinkSync(tmp); } catch (e2) { /* nothing to clean */ }
  }
}

// A template saved mid-edit or half-copied would replace this file and then never run
// again to fix itself. Only accept one that compiles and ends with our exports.
function runnable(text) {
  if (!/module\.exports = \{ installedRoot \};\s*$/.test(text)) return false;
  try {
    new (require('vm').Script)('(function (exports, require, module, __filename, __dirname) {' +
      text.replace(/^#!.*/, '') + '\n})');
    return true;
  } catch (e) { return false; }
}

function follow(root) {
  const next = installedRoot(root);
  if (next && !samePath(next, root) && fs.existsSync(path.join(next, 'src', 'render.js'))) {
    writeAtomic(ROOT_FILE, next + '\n');
    root = next;
  }
  try {
    const tpl = fs.readFileSync(path.join(root, 'src', 'launch.js'), 'utf8');
    if (tpl !== fs.readFileSync(__filename, 'utf8') && runnable(tpl)) writeAtomic(__filename, tpl);
  } catch (e) { /* keep this copy */ }
  return root;
}

function main(input, mode) {
  const rows = mode === 'subagents';
  let root = '';
  try { root = fs.readFileSync(ROOT_FILE, 'utf8').trim(); } catch (e) { root = ''; }
  if (root) root = follow(root);
  const entry = root ? path.join(root, 'src', rows ? 'subagents.js' : 'render.js') : '';
  if (!entry || !fs.existsSync(entry)) {
    if (!rows) say('plugin files not found; run /sline:init or /sline:doctor');
    return;
  }
  try {
    process.stdout.write(require(entry).run(input));
  } catch (e) {
    if (!rows) say('error: ' + String((e && e.message) || e).split('\n')[0]);
  }
}

if (require.main === module) {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', function (c) { input += c; });
  process.stdin.on('end', function () { main(input, process.argv[2]); });
}

module.exports = { installedRoot };
