#!/usr/bin/env node
'use strict';
// Interactive configuration for ~/.claude/statusline-accounts.json.
//
//   node configure.js          re-run any time to change accounts / pace / refresh
//   node install.js --configure runs this as part of install
//
// install.js also calls configure() automatically on first-time setup when run
// in a terminal, so the personal config never has to be hand-edited (though it's
// plain JSON you can always edit directly).

const fs = require('fs');
const readline = require('readline');
const C = require('./src/config.js');

function ts() {
  return new Date().toISOString().replace(/[:.]/g, '').replace('T', '').slice(0, 14);
}

// Drive input off the 'line' event with a queue rather than rl.question(): under
// a pipe, sequential rl.question() calls only deliver the first line on some
// platforms (Windows/MSYS). At EOF, pending asks resolve to the default so the
// questionnaire never hangs and a non-interactive run yields a sensible config.
function makeAsker() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const queue = [];
  const waiters = [];
  let closed = false;
  rl.on('line', function (line) {
    if (waiters.length) waiters.shift()(line);
    else queue.push(line);
  });
  rl.on('close', function () {
    closed = true;
    while (waiters.length) waiters.shift()(null);
  });
  function nextLine() {
    if (queue.length) return Promise.resolve(queue.shift());
    if (closed) return Promise.resolve(null);
    return new Promise(function (res) { waiters.push(res); });
  }
  function ask(q, def) {
    process.stdout.write(q + (def ? ' [' + def + ']' : '') + ' ');
    return nextLine().then(function (a) {
      a = (a == null ? '' : String(a)).trim();
      return a === '' ? (def || '') : a;
    });
  }
  return { rl: rl, ask: ask };
}

async function configure() {
  const prev = C.load(); // sensible defaults when reconfiguring
  const asker = makeAsker();
  const rl = asker.rl;
  const ask = asker.ask;
  try {
    console.log('Configuring the Claude status line -> ' + C.CONFIG_PATH);
    console.log('Press Enter to accept each [default].\n');

    // --- accounts ---
    console.log('Accounts (leave the label blank when done; at least one required):');
    const accounts = [];
    for (let i = 0; ; i++) {
      // Only the first label has a default; pressing Enter on a later one finishes
      // the list (otherwise a single-account user could never stop).
      const defLabel = i === 0 ? 'A' : '';
      const label = await ask('  account ' + (i + 1) + ' label (Enter to finish):', defLabel);
      if (!label) { if (accounts.length) break; else continue; }
      const defDir = i === 0 ? '~/.claude' : '~/.creds-' + label.toLowerCase();
      const dir = await ask('    credentials dir for "' + label + '":', defDir);
      accounts.push({ label: label, credsDir: dir || '~/.claude' });
    }

    // --- 7d pace ---
    console.log('\n7-day pace -- spread the weekly quota over which days?');
    console.log('  1) all 7 days (even)      2) Mon-Fri work week      3) custom');
    const choice = await ask('  choose 1/2/3:', '1');
    let workingDays = null;
    if (choice === '2') {
      workingDays = [1, 2, 3, 4, 5];
    } else if (choice === '3') {
      const raw = await ask('  working days as numbers, 0=Sun..6=Sat (e.g. 0 1 2 3 4):', '1 2 3 4 5');
      workingDays = Array.from(new Set(
        raw.split(/[\s,]+/).map(Number).filter(function (n) { return n >= 0 && n <= 6; })
      ));
    }

    // --- refresh ---
    const defMin = Math.round((prev.refresh.okSeconds || 1800) / 60);
    const minsRaw = await ask('\nBackground refresh interval for inactive accounts (minutes):', String(defMin));
    const okSeconds = Math.max(60, Math.round((parseFloat(minsRaw) || defMin) * 60));

    // --- assemble ---
    const config = { accounts: accounts };
    if (workingDays && workingDays.length && workingDays.length < 7) {
      config.pace = { workingDays: workingDays };
    }
    config.refresh = {
      okSeconds: okSeconds,
      idleSeconds: Math.max(okSeconds, 3600),
      errorSeconds: 240,
      rateLimitedSeconds: Math.max(okSeconds, 1800),
    };
    config.hidden = { marker: prev.hiddenMarker || 'hidden' };

    fs.mkdirSync(C.DATA_DIR, { recursive: true });
    if (fs.existsSync(C.CONFIG_PATH)) {
      try { fs.copyFileSync(C.CONFIG_PATH, C.CONFIG_PATH + '.bak.' + ts()); } catch (e) {}
    }
    const tmp = C.CONFIG_PATH + '.tmp' + process.pid;
    fs.writeFileSync(tmp, JSON.stringify(config, null, 2) + '\n');
    fs.renameSync(tmp, C.CONFIG_PATH);

    console.log('\nWrote ' + C.CONFIG_PATH + ':\n');
    console.log(JSON.stringify(config, null, 2));
    return config;
  } finally {
    rl.close();
  }
}

module.exports = { configure: configure };

if (require.main === module) {
  configure().then(function () { process.exit(0); }).catch(function (e) {
    console.error(e && e.message ? e.message : e);
    process.exit(1);
  });
}
