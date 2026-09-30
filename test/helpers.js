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
    cleanup() { fs.rmSync(base, { recursive: true, force: true }); },
  };
}

function stripAnsi(s) { return String(s).replace(/\x1b\[[0-9;]*m/g, ''); }

function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj));
}

function addCreds(dir, extra) {
  writeJson(path.join(dir, '.credentials.json'), {
    claudeAiOauth: Object.assign({ accessToken: 'test-token', expiresAt: Date.now() + 3600e3 }, extra || {}),
  });
}

function writeCache(p, key, obj) { writeJson(path.join(p.cacheDir, key + '.json'), Object.assign({ key }, obj)); }

module.exports = { tmpEnv, stripAnsi, writeJson, addCreds, writeCache };
