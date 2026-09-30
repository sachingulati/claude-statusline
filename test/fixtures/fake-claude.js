'use strict';
// Stands in for Claude Code in the runner tests (CLAUDE_SLINE_CLAUDE). FAKE_CLAUDE_MODE:
// ok | cost | hang | race. Writes what it was started with to FAKE_CLAUDE_LOG.
// node --test also loads every file under test/: without a mode, do nothing.
const fs = require('fs');
const path = require('path');

const mode = process.env.FAKE_CLAUDE_MODE;
if (mode) {
  if (process.env.FAKE_CLAUDE_LOG) {
    fs.writeFileSync(process.env.FAKE_CLAUDE_LOG, JSON.stringify({
      args: process.argv.slice(2),
      configDir: process.env.CLAUDE_CONFIG_DIR,
      loginDir: process.env.CLAUDE_SECURESTORAGE_CONFIG_DIR,
      claudecode: process.env.CLAUDECODE !== undefined,
      configDirExists: fs.existsSync(process.env.CLAUDE_CONFIG_DIR || ''),
      cwd: process.cwd(),
      loginOverrides: ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN',
        'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX'].filter(function (k) { return process.env[k] !== undefined; }),
    }));
  }
  if (mode === 'hang') {
    setTimeout(function () {}, 600000);
  } else {
    // A session of this account records live numbers while the check runs.
    if (mode === 'race') {
      fs.writeFileSync(process.env.FAKE_CLAUDE_RACE_FILE, JSON.stringify({
        key: 'B', status: 'ok', fetched_at: 9999999999, five_hour: { utilization: 77, resets_at: null }, seven_day: null,
      }));
    }
    const name = mode === 'cost' ? 'usage-costview.stream.jsonl' : 'usage-ok.stream.jsonl';
    process.stdout.write(fs.readFileSync(path.join(__dirname, name), 'utf8'));
  }
}
