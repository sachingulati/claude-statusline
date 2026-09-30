'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const paths = require('../src/paths');

test('defaults to <home>/.claude/sline', () => {
  const p = paths.resolve({ HOME: '/h' });
  assert.equal(p.claudeDir, path.join('/h', '.claude'));
  assert.equal(p.stateDir, path.join('/h', '.claude', 'sline'));
  assert.equal(p.settingsFile, path.join('/h', '.claude', 'settings.json'));
  assert.equal(p.launcher, path.join(p.stateDir, 'launch.js'));
  assert.equal(p.rootFile, path.join(p.stateDir, 'root'));
  assert.equal(p.configFile, path.join(p.stateDir, 'config.json'));
  assert.equal(p.cacheDir, path.join(p.stateDir, 'cache'));
  assert.equal(p.accountsDir, path.join(p.stateDir, 'accounts'));
  assert.equal(p.sessionsDir, path.join(p.stateDir, 'sessions'));
  assert.equal(p.hiddenFlag, path.join(p.stateDir, 'hidden'));
  assert.equal(p.installFile, path.join(p.stateDir, 'install.json'));
});

test('CLAUDE_CONFIG_DIR moves settings and state', () => {
  const p = paths.resolve({ HOME: '/h', CLAUDE_CONFIG_DIR: '/cfg' });
  assert.equal(p.settingsFile, path.join('/cfg', 'settings.json'));
  assert.equal(p.stateDir, path.join('/cfg', 'sline'));
});

test('CLAUDE_SLINE_HOME overrides only the state folder', () => {
  const p = paths.resolve({ HOME: '/h', CLAUDE_SLINE_HOME: '/state' });
  assert.equal(p.stateDir, '/state');
  assert.equal(p.settingsFile, path.join('/h', '.claude', 'settings.json'));
});

test('expandHome handles ~, ~/x and absolute paths', () => {
  assert.equal(paths.expandHome('~', '/h'), '/h');
  assert.equal(paths.expandHome('~/x', '/h'), path.join('/h', 'x'));
  assert.equal(paths.expandHome('/abs', '/h'), '/abs');
  assert.equal(paths.expandHome('', '/h'), '');
});

test('normPath treats Git Bash, Windows and trailing-slash forms as equal', () => {
  assert.equal(paths.normPath('/c/Users/Me/.creds-b/', false), paths.normPath('C:\\Users\\me\\.creds-b', false));
});

test('normPath keeps case where the file system does', () => {
  assert.notEqual(paths.normPath('/home/Me/.creds-b', true), paths.normPath('/home/me/.creds-b', true));
  assert.equal(paths.normPath('/home/Me/.creds-b', false), paths.normPath('/home/me/.creds-b', false));
});

test('normPath collapses //, /./ and x/..', () => {
  const want = paths.normPath('/h/.creds-b');
  for (const s of ['/h//.creds-b', '/h/./.creds-b', '/h/x/../.creds-b', '/h/.creds-b//']) {
    assert.equal(paths.normPath(s), want, s);
  }
});

test('Git Bash style HOME is converted on Windows', { skip: process.platform !== 'win32' }, () => {
  assert.equal(paths.homeDir({ HOME: '/c/Users/Me' }), 'c:/Users/Me');
});
