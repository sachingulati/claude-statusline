'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const paths = require('../src/paths');

function tmpEnv() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-test-'));
  const home = path.join(base, 'home');
  const claudeDir = path.join(home, '.claude');
  fs.mkdirSync(claudeDir, { recursive: true });
  const env = { HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: claudeDir };
  return {
    base, home, env, p: paths.resolve(env),
    cleanup() { fs.rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); },
  };
}

function stripAnsi(s) { return String(s).replace(/\x1b\[[0-9;]*m/g, ''); }

function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj));
}

function writeCache(p, key, obj) { writeJson(path.join(p.cacheDir, key + '.json'), Object.assign({ key }, obj)); }

// The environment for a child process of a test: the caller's, minus what points at the real
// session (login folder, state folder, terminal width), and with no Claude Code to launch, so
// a background check leaking out of a test can neither touch real data nor start a real claude.
function childEnv(t, extra) {
  const env = Object.assign({}, process.env);
  ['CLAUDE_SECURESTORAGE_CONFIG_DIR', 'CLAUDE_SLINE_HOME', 'COLUMNS'].forEach(function (k) { delete env[k]; });
  env.CLAUDE_SLINE_CLAUDE = path.join(t.base, 'no-such-claude');
  return Object.assign(env, t.env, extra);
}

module.exports = { childEnv, tmpEnv, stripAnsi, writeJson, writeCache };
