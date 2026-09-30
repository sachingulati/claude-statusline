'use strict';
// Writes <stateDir>/launch.js and <stateDir>/root (init) and reports their state
// (doctor). After that the launcher keeps both current by itself; see launch.js.

const fs = require('fs');
const path = require('path');
const { writeFileAtomic } = require('./fsutil');

const TEMPLATE = path.join(__dirname, 'launch.js');
const PLUGIN_ROOT = path.resolve(__dirname, '..');

function readOr(file, fallback) {
  try { return fs.readFileSync(file, 'utf8'); } catch (e) { return fallback; }
}

function sync(p, pluginRoot) {
  pluginRoot = pluginRoot || PLUGIN_ROOT;
  const tpl = fs.readFileSync(TEMPLATE, 'utf8');
  const launcherChanged = readOr(p.launcher, null) !== tpl;
  if (launcherChanged) writeFileAtomic(p.launcher, tpl);
  const rootChanged = readOr(p.rootFile, '').trim() !== pluginRoot;
  if (rootChanged) writeFileAtomic(p.rootFile, pluginRoot + '\n');
  return { launcherChanged: launcherChanged, rootChanged: rootChanged, pluginRoot: pluginRoot };
}

function status(p) {
  const tpl = fs.readFileSync(TEMPLATE, 'utf8');
  const current = readOr(p.launcher, null);
  const root = readOr(p.rootFile, '').trim();
  return {
    launcherExists: current != null,
    launcherCurrent: current === tpl,
    root: root,
    rootValid: !!root && fs.existsSync(path.join(root, 'src', 'render.js')),
  };
}

module.exports = { TEMPLATE, PLUGIN_ROOT, sync, status };
