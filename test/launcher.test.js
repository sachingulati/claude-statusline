'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const { tmpEnv, writeJson, stripAnsi } = require('./helpers');
const launcher = require('../src/launcher');
const { installedRoot } = require('../src/launch');

function runLauncher(t, stdin, args) {
  const env = Object.assign({}, process.env, t.env);
  return cp.execFileSync(process.execPath, [t.p.launcher].concat(args || []), { env, input: stdin, encoding: 'utf8' });
}

// A fake marketplace install: <base>/plugins/cache/mkt/sline/<version>, each version
// carrying the real launcher template and a render that prints its version.
function fakeInstall(t, versions, record) {
  const plugins = path.join(t.base, 'plugins');
  const dirs = {};
  versions.forEach(function (v) {
    const dir = path.join(plugins, 'cache', 'mkt', 'sline', v);
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.copyFileSync(launcher.TEMPLATE, path.join(dir, 'src', 'launch.js'));
    fs.writeFileSync(path.join(dir, 'src', 'render.js'), "exports.run = () => '" + v + "\\n';");
    dirs[v] = dir;
  });
  if (record !== undefined) {
    const file = path.join(plugins, 'installed_plugins.json');
    if (typeof record === 'string') fs.writeFileSync(file, record);
    else writeJson(file, record);
  }
  return dirs;
}

function entry(scope, installPath, lastUpdated) {
  return { scope: scope, installPath: installPath, version: path.basename(installPath), lastUpdated: lastUpdated || '2026-09-29T00:00:00.000Z' };
}

test('sync writes launcher and root once, then reports no change', () => {
  const t = tmpEnv();
  try {
    assert.deepEqual(launcher.sync(t.p), { launcherChanged: true, rootChanged: true, pluginRoot: launcher.PLUGIN_ROOT });
    assert.equal(fs.readFileSync(t.p.rootFile, 'utf8').trim(), launcher.PLUGIN_ROOT);
    assert.deepEqual(launcher.sync(t.p), { launcherChanged: false, rootChanged: false, pluginRoot: launcher.PLUGIN_ROOT });
    assert.deepEqual(launcher.status(t.p), { launcherExists: true, launcherCurrent: true, root: launcher.PLUGIN_ROOT, rootValid: true });
  } finally { t.cleanup(); }
});

test('sync repoints when the plugin moves and refreshes an outdated launcher', () => {
  const t = tmpEnv();
  try {
    launcher.sync(t.p, '/old/version');
    fs.writeFileSync(t.p.launcher, '// old launcher');
    const r = launcher.sync(t.p);
    assert.equal(r.rootChanged, true);
    assert.equal(r.launcherChanged, true);
  } finally { t.cleanup(); }
});

test('the launcher renders through the pointed-to plugin', () => {
  const t = tmpEnv();
  try {
    launcher.sync(t.p);
    const out = stripAnsi(runLauncher(t, JSON.stringify({ workspace: { current_dir: t.home }, model: { id: 'm' } })));
    assert.match(out, /^dir:~ · model:m/);
  } finally { t.cleanup(); }
});

test('a missing plugin folder prints one dim line and exits 0', () => {
  const t = tmpEnv();
  try {
    launcher.sync(t.p, path.join(t.base, 'gone'));
    const out = stripAnsi(runLauncher(t, '{}'));
    assert.equal(out, 'sline: plugin files not found; run /sline:init or /sline:doctor\n');
    assert.equal(launcher.status(t.p).rootValid, false);
  } finally { t.cleanup(); }
});

test('a render that throws prints one dim error line and exits 0', () => {
  const t = tmpEnv();
  try {
    const fake = path.join(t.base, 'fake-plugin');
    fs.mkdirSync(path.join(fake, 'src'), { recursive: true });
    fs.writeFileSync(path.join(fake, 'src', 'render.js'), "exports.run = () => { throw new Error('boom\\nstack'); };");
    launcher.sync(t.p, fake);
    assert.equal(stripAnsi(runLauncher(t, '{}')), 'sline: error: boom\n');
  } finally { t.cleanup(); }
});

test('works from a state folder whose path has spaces', () => {
  const t = tmpEnv();
  try {
    const spaced = Object.assign({}, t, { env: Object.assign({}, t.env, { CLAUDE_SLINE_HOME: path.join(t.base, 'John Smith', 'state') }) });
    spaced.p = require('../src/paths').resolve(spaced.env);
    launcher.sync(spaced.p);
    assert.match(stripAnsi(runLauncher(spaced, '{}')), /^dir:/);
  } finally { t.cleanup(); }
});

test('follows a plugin update to the installed version on the next render', () => {
  const t = tmpEnv();
  try {
    const d = fakeInstall(t, ['1.0.0', '1.1.0']);
    fakeInstall(t, [], { version: 2, plugins: { 'sline@mkt': [entry('user', d['1.1.0'])] } });
    launcher.sync(t.p, d['1.0.0']);
    assert.equal(runLauncher(t, '{}'), '1.1.0\n');
    assert.equal(fs.readFileSync(t.p.rootFile, 'utf8').trim(), d['1.1.0']);
  } finally { t.cleanup(); }
});

test('prefers the user-scope install, else the most recently updated one', () => {
  const t = tmpEnv();
  try {
    const d = fakeInstall(t, ['1', '2', '3']);
    const write = list => writeJson(path.join(t.base, 'plugins', 'installed_plugins.json'), { version: 2, plugins: { 'sline@mkt': list } });
    write([entry('project', d['3'], '2026-09-30T00:00:00Z'), entry('user', d['2'], '2026-09-01T00:00:00Z')]);
    assert.equal(installedRoot(d['1']), d['2']);
    write([entry('project', d['2'], '2026-09-01T00:00:00Z'), entry('local', d['3'], '2026-09-30T00:00:00Z')]);
    assert.equal(installedRoot(d['1']), d['3']);
  } finally { t.cleanup(); }
});

test('stays put: --plugin-dir checkout, no record, garbage record, incomplete new folder', () => {
  const t = tmpEnv();
  try {
    const d = fakeInstall(t, ['1.0.0']);
    assert.equal(installedRoot(path.join(t.base, 'checkout')), null); // not under cache/
    assert.equal(installedRoot(d['1.0.0']), null); // no installed_plugins.json
    fakeInstall(t, [], '{ not json');
    assert.equal(installedRoot(d['1.0.0']), null);

    const half = path.join(t.base, 'plugins', 'cache', 'mkt', 'sline', '2.0.0');
    fs.mkdirSync(half, { recursive: true }); // being copied: no src/render.js yet
    fakeInstall(t, [], { version: 2, plugins: { 'sline@mkt': [entry('user', half)] } });
    launcher.sync(t.p, d['1.0.0']);
    assert.equal(runLauncher(t, '{}'), '1.0.0\n');
    assert.equal(fs.readFileSync(t.p.rootFile, 'utf8').trim(), d['1.0.0']);
  } finally { t.cleanup(); }
});

test('a broken or truncated template is not copied over a working launcher', () => {
  for (const bad of ["#!/usr/bin/env node\n'use strict';\nfunction (", '', "'use strict';\n// half a file\n"]) {
    const t = tmpEnv();
    try {
      const fake = path.join(t.base, 'fake-plugin');
      fs.mkdirSync(path.join(fake, 'src'), { recursive: true });
      fs.writeFileSync(path.join(fake, 'src', 'render.js'), "exports.run = () => 'ok\\n';");
      fs.writeFileSync(path.join(fake, 'src', 'launch.js'), bad);
      launcher.sync(t.p, fake);
      const good = fs.readFileSync(t.p.launcher, 'utf8');
      assert.equal(runLauncher(t, '{}'), 'ok\n');
      assert.equal(fs.readFileSync(t.p.launcher, 'utf8'), good, JSON.stringify(bad));
      assert.equal(runLauncher(t, '{}'), 'ok\n'); // still runs next time
    } finally { t.cleanup(); }
  }
});

test('an outdated launcher replaces itself with the current template', () => {
  const t = tmpEnv();
  try {
    launcher.sync(t.p);
    const tpl = fs.readFileSync(launcher.TEMPLATE, 'utf8');
    fs.writeFileSync(t.p.launcher, tpl + '\n// from an older version\n');
    assert.match(stripAnsi(runLauncher(t, '{}')), /^dir:/); // the old copy still renders
    assert.equal(fs.readFileSync(t.p.launcher, 'utf8'), tpl);
    assert.equal(launcher.status(t.p).launcherCurrent, true);
  } finally { t.cleanup(); }
});

test('the subagents argument draws rows through the pointed-to plugin', () => {
  const t = tmpEnv();
  try {
    launcher.sync(t.p);
    const out = runLauncher(t, JSON.stringify({ tasks: [{ id: 'a1', status: 'running', label: 'Reading x' }] }), ['subagents']);
    assert.deepEqual(JSON.parse(out.trim()), { id: 'a1', content: 'Reading x' });
  } finally { t.cleanup(); }
});

test('subagents mode prints nothing when the plugin is missing, too old, or throws', () => {
  const t = tmpEnv();
  try {
    launcher.sync(t.p, path.join(t.base, 'gone'));
    assert.equal(runLauncher(t, '{"tasks":[]}', ['subagents']), '');

    const fake = path.join(t.base, 'fake-plugin');
    fs.mkdirSync(path.join(fake, 'src'), { recursive: true });
    fs.writeFileSync(path.join(fake, 'src', 'render.js'), "exports.run = () => 'line\\n';");
    launcher.sync(t.p, fake);
    assert.equal(runLauncher(t, '{"tasks":[]}', ['subagents']), ''); // no subagents.js yet
    fs.writeFileSync(path.join(fake, 'src', 'subagents.js'), "exports.run = () => { throw new Error('boom'); };");
    assert.equal(runLauncher(t, '{"tasks":[]}', ['subagents']), '');
    assert.equal(runLauncher(t, '{}'), 'line\n'); // the status line itself is unaffected
  } finally { t.cleanup(); }
});
