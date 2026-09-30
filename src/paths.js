'use strict';
// Every path the plugin uses, resolved from the environment in one place.

const os = require('os');
const path = require('path');

function homeDir(env) {
  let h = env.HOME || env.USERPROFILE || os.homedir();
  // Git Bash can hand a POSIX-style /c/Users/... HOME to a Windows node.
  if (process.platform === 'win32' && /^\/[a-zA-Z]\//.test(h)) h = h[1] + ':' + h.slice(2);
  return h;
}

function expandHome(p, home) {
  if (p == null || p === '') return p;
  p = String(p);
  if (p === '~') return home;
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(home, p.slice(2));
  return p;
}

function toForward(p) { return String(p).replace(/\\/g, '/'); }

// Windows and macOS file names ignore case by default; Linux and the other Unixes don't.
const CASE_SENSITIVE = process.platform !== 'win32' && process.platform !== 'darwin';

// Comparable form: forward slashes, /c/ drive form as c:/, no //, /./ or x/..,
// no trailing slash, lower case where the file system ignores case.
function normPath(p, caseSensitive) {
  const s = toForward(p || '').replace(/^\/([a-zA-Z])\//, '$1:/');
  if (!s) return '';
  const n = path.posix.normalize(s).replace(/(.)\/+$/, '$1');
  return (caseSensitive === undefined ? CASE_SENSITIVE : caseSensitive) ? n : n.toLowerCase();
}

function resolve(env) {
  env = env || process.env;
  const home = homeDir(env);
  const claudeDir = env.CLAUDE_CONFIG_DIR
    ? expandHome(env.CLAUDE_CONFIG_DIR, home) : path.join(home, '.claude');
  const stateDir = env.CLAUDE_SLINE_HOME
    ? expandHome(env.CLAUDE_SLINE_HOME, home) : path.join(claudeDir, 'sline');
  return {
    home: home,
    claudeDir: claudeDir,
    stateDir: stateDir,
    settingsFile: path.join(claudeDir, 'settings.json'),
    launcher: path.join(stateDir, 'launch.js'),
    rootFile: path.join(stateDir, 'root'),
    configFile: path.join(stateDir, 'config.json'),
    cacheDir: path.join(stateDir, 'cache'),
    hiddenFlag: path.join(stateDir, 'hidden'),
    installFile: path.join(stateDir, 'install.json'),
  };
}

// The session's login folder: Claude Code reads CLAUDE_SECURESTORAGE_CONFIG_DIR, else
// the config folder. The status line inherits the session's environment.
function loginDir(p, env) {
  return expandHome(env.CLAUDE_SECURESTORAGE_CONFIG_DIR, p.home) || p.claudeDir;
}

module.exports = { resolve, expandHome, toForward, normPath, homeDir, loginDir };
