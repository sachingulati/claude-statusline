#!/usr/bin/env node
'use strict';
// Installer for the multi-account status line. Run-in-place model: the code
// stays in this repo and settings.json points straight at it, so `git pull` is
// the whole update. This script only:
//
//   * points ~/.claude/settings.json's statusLine at src/statusline-command.sh
//   * sets up ~/.claude/statusline-accounts.json (interactive on first run in a
//     terminal; otherwise seeded from the example)
//   * adds `ut` (toggle usage) + `usage-config` aliases to your shell rc
//   * remembers the previous statusLine so --uninstall can restore it
//
//   node install.js              install / re-link (idempotent)
//   node install.js --relink     alias for install (use after moving the repo)
//   node install.js --configure  (re)run the interactive config questionnaire
//   node install.js --no-alias   install but don't touch any shell rc
//   node install.js --uninstall  restore statusLine, remove the rc alias block
//
// Credentials, config, and cache are never touched by --uninstall.

const fs = require('fs');
const path = require('path');
const C = require('./src/config.js');
const configurator = require('./configure.js');

const REPO_DIR = __dirname;
const COMMAND_SH = path.join(REPO_DIR, 'src', 'statusline-command.sh');
const CONFIGURE_JS = path.join(REPO_DIR, 'configure.js');
const EXAMPLE = path.join(REPO_DIR, 'statusline-accounts.example.json');

const SETTINGS = path.join(C.DATA_DIR, 'settings.json');
const STATE = path.join(C.DATA_DIR, '.statusline-install.json');

// Aliases kept in a marked block so they can be updated or removed cleanly.
// Detection matches on BEGIN_PREFIX (not the exact line) so blocks written by
// older versions, whose begin marker had a suffix, are still found and replaced.
const BEGIN_PREFIX = '# >>> claude-statusline';
const MANAGED_BEGIN = BEGIN_PREFIX + ' >>>';
const MANAGED_END = '# <<< claude-statusline <<<';

const mode = process.argv.includes('--uninstall') ? 'uninstall'
  : process.argv.includes('--help') || process.argv.includes('-h') ? 'help'
    : 'install';
const noAlias = process.argv.includes('--no-alias');
const forceConfigure = process.argv.includes('--configure');

function ts() {
  return new Date().toISOString().replace(/[:.]/g, '').replace('T', '').slice(0, 14);
}

function tilde(p) {
  return C.HOME && p.indexOf(C.HOME) === 0 ? '~' + p.slice(C.HOME.length).replace(/\\/g, '/') : p;
}

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return fallback; }
}

function writeJson(p, obj) {
  if (fs.existsSync(p)) {
    try { fs.copyFileSync(p, p + '.bak.' + ts()); } catch (e) {}
  }
  const tmp = p + '.tmp' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n');
  fs.renameSync(tmp, p);
}

// bash (even Git Bash on Windows) accepts a forward-slash path; backslashes would
// be read as escapes. Node gives backslashes on Windows, so normalise.
function bashPath(p) { return p.replace(/\\/g, '/'); }

function aliasBlock() {
  const toggle =
    "alias ut='[ -e ~/.claude/statusline-hidden ] && rm -f ~/.claude/statusline-hidden && echo \"usage: visible\" || { touch ~/.claude/statusline-hidden && echo \"usage: HIDDEN\"; }'";
  const config = "alias usage-config='node \"" + bashPath(CONFIGURE_JS) + "\"'";
  return MANAGED_BEGIN + '\n' +
    '# ut          -> hide/show usage in the status line\n' + toggle + '\n' +
    '# usage-config -> re-run the config questionnaire\n' + config + '\n' +
    MANAGED_END;
}

// --- shell rc alias management ----------------------------------------------

function rcTargets(mustExist) {
  const cands = [path.join(C.HOME, '.zshrc'), path.join(C.HOME, '.bashrc')];
  const found = cands.filter(function (p) { return fs.existsSync(p); });
  if (mustExist) return found;
  return found.length ? found : [path.join(C.HOME, '.bashrc')];
}

function stripBlock(text) {
  const start = text.indexOf(BEGIN_PREFIX);
  if (start === -1) return text;
  const end = text.indexOf(MANAGED_END, start);
  if (end === -1) return text;
  const before = text.slice(0, start).replace(/\n+$/, '');
  const after = text.slice(end + MANAGED_END.length).replace(/^\n+/, '');
  return before + (before && after ? '\n' : '') + after;
}

function installAlias() {
  const block = aliasBlock();
  const written = [];
  rcTargets(false).forEach(function (rc) {
    let content = '';
    let existed = false;
    try { content = fs.readFileSync(rc, 'utf8'); existed = true; } catch (e) {}
    if (existed && content.indexOf(BEGIN_PREFIX) === -1) {
      try { fs.copyFileSync(rc, rc + '.bak.' + ts()); } catch (e) {}
    }
    let next = stripBlock(content);
    if (next && !next.endsWith('\n')) next += '\n';
    next += (next ? '\n' : '') + block + '\n';
    try { fs.writeFileSync(rc, next); written.push(rc); } catch (e) {
      console.error('Warning: could not update ' + rc + ': ' + e.message);
    }
  });
  return written;
}

function removeAlias() {
  const removed = [];
  rcTargets(true).forEach(function (rc) {
    let content;
    try { content = fs.readFileSync(rc, 'utf8'); } catch (e) { return; }
    if (content.indexOf(BEGIN_PREFIX) === -1) return;
    let next = stripBlock(content).replace(/\n{3,}/g, '\n\n');
    if (!next.endsWith('\n')) next += '\n';
    try { fs.writeFileSync(rc, next); removed.push(rc); } catch (e) {}
  });
  return removed;
}

function printSecondAccountHelp() {
  console.log('');
  console.log('To add another account later: log it into its own creds dir, then re-run config:');
  console.log('   CLAUDE_SECURESTORAGE_CONFIG_DIR="$HOME/.creds-b" claude   # then /login');
  console.log('   alias claudeb=\'CLAUDE_SECURESTORAGE_CONFIG_DIR="$HOME/.creds-b" command claude\'');
  console.log('   usage-config   (or: node "' + bashPath(CONFIGURE_JS) + '")');
}

// --- modes ------------------------------------------------------------------

async function main() {
  if (mode === 'help') {
    console.log('Usage: node install.js [--relink | --uninstall] [--configure] [--no-alias]');
    return 0;
  }

  if (!C.HOME) {
    console.error('Cannot resolve HOME/USERPROFILE; aborting.');
    return 1;
  }
  fs.mkdirSync(C.DATA_DIR, { recursive: true });

  if (mode === 'uninstall') {
    const state = readJson(STATE, null);
    const settings = readJson(SETTINGS, {});
    if (state && Object.prototype.hasOwnProperty.call(state, 'previousStatusLine')) {
      if (state.previousStatusLine == null) delete settings.statusLine;
      else settings.statusLine = state.previousStatusLine;
    } else {
      delete settings.statusLine; // no record -- best effort
    }
    writeJson(SETTINGS, settings);
    try { fs.unlinkSync(STATE); } catch (e) {}
    const removedRc = removeAlias();

    console.log('Uninstalled: statusLine restored to its previous value.');
    if (removedRc.length) console.log('Removed aliases from: ' + removedRc.map(tilde).join(', '));
    console.log('Left untouched: statusline-accounts.json, usage-cache/, credentials, the repo.');
    return 0;
  }

  // --- install / relink ---
  const settings = readJson(SETTINGS, {});
  const command = 'bash "' + bashPath(COMMAND_SH) + '"';

  // Record the pre-existing statusLine ONCE, so re-installs never overwrite the
  // genuine original with our own command.
  if (!fs.existsSync(STATE)) {
    writeJson(STATE, {
      previousStatusLine: settings.statusLine !== undefined ? settings.statusLine : null,
      installedAt: new Date().toISOString(),
      repoDir: REPO_DIR,
    });
  }

  settings.statusLine = { type: 'command', command: command };
  writeJson(SETTINGS, settings);

  // Config: interactive on first-time setup in a terminal, or when --configure is
  // passed. Non-interactive with no config -> seed from the example. Existing
  // config is kept untouched unless --configure.
  let configNote;
  const haveConfig = fs.existsSync(C.CONFIG_PATH);
  if (forceConfigure || (!haveConfig && process.stdin.isTTY)) {
    await configurator.configure();
    configNote = null; // configurator already printed the result
  } else if (!haveConfig) {
    try {
      fs.copyFileSync(EXAMPLE, C.CONFIG_PATH);
      configNote = 'Seeded ' + C.CONFIG_PATH + ' from the example (run `usage-config` to customise).';
    } catch (e) {
      configNote = 'Warning: could not create ' + C.CONFIG_PATH + ': ' + e.message;
    }
  } else {
    configNote = 'Kept existing ' + C.CONFIG_PATH + ' (run `usage-config` to change it).';
  }

  let aliasFiles = [];
  if (!noAlias) aliasFiles = installAlias();

  console.log('');
  console.log('Installed. settings.json statusLine ->');
  console.log('  ' + command);
  if (configNote) console.log(configNote);
  if (noAlias) {
    console.log('Skipped shell aliases (--no-alias).');
  } else if (aliasFiles.length) {
    console.log('Added `ut` + `usage-config` aliases to: ' + aliasFiles.map(tilde).join(', '));
    console.log('  run  `source ' + tilde(aliasFiles[aliasFiles.length - 1]) + '`  (or open a new shell) to use them.');
  }
  printSecondAccountHelp();
  console.log('');
  console.log('Start a new Claude Code session (or press a key in one) to see the status line.');
  return 0;
}

main().then(function (code) { process.exit(code || 0); }).catch(function (e) {
  console.error(e && e.stack ? e.stack : e);
  process.exit(1);
});
