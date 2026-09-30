'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { tmpEnv } = require('./helpers');
const usage = require('../src/usage');

const fixture = name => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');

test('parse: a real /usage stream gives both windows in epoch seconds', () => {
  assert.deepEqual(usage.parse(fixture('usage-ok.stream.jsonl')), {
    five_hour: { utilization: 5, resets_at: Date.UTC(2026, 8, 30, 21, 30) / 1000 },
    seven_day: { utilization: 45, resets_at: Date.UTC(2026, 9, 5, 18) / 1000 },
  });
});

test('parse: the cost view (no login, rate limited, not a subscriber) and garbage give null', () => {
  assert.equal(usage.parse(fixture('usage-costview.stream.jsonl')), null);
  assert.equal(usage.parse('not json\n{"type":"result"}\n'), null);
  assert.equal(usage.parse(''), null);
  assert.equal(usage.parse(undefined), null);
});

test('parse: no reset time, a report nested under message, CRLF lines', () => {
  const line = JSON.stringify({ type: 'assistant', message: { usage_report: { rate_limits: { limits: [
    { kind: 'session', percent: 0, resets_at: null }, { kind: 'weekly_all', percent: 60, resets_at: '2026-10-05T18:00:00Z' }] } } } });
  assert.deepEqual(usage.parse(line + '\r\n'), {
    five_hour: { utilization: 0, resets_at: null },
    seven_day: { utilization: 60, resets_at: Date.UTC(2026, 9, 5, 18) / 1000 },
  });
});

test('findClaude: claude.exe on PATH, the exe behind an npm shim, or nothing', () => {
  const t = tmpEnv();
  try {
    const exeDir = path.join(t.base, 'native');
    const npmDir = path.join(t.base, 'npm');
    const inner = path.join(npmDir, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
    const empty = path.join(t.base, 'empty');
    fs.mkdirSync(exeDir); fs.mkdirSync(empty); fs.mkdirSync(path.dirname(inner), { recursive: true });
    fs.writeFileSync(path.join(exeDir, 'claude.exe'), '');
    fs.writeFileSync(path.join(npmDir, 'claude.cmd'), '');
    fs.writeFileSync(inner, '');
    const P = dirs => dirs.join(path.delimiter);
    assert.equal(usage.findClaude(P([empty, exeDir]), 'win32'), path.join(exeDir, 'claude.exe'));
    assert.equal(usage.findClaude(P([empty, npmDir]), 'win32'), inner);
    assert.equal(usage.findClaude(P([empty]), 'win32'), null);
    assert.equal(usage.findClaude('', 'win32'), null);
    fs.writeFileSync(path.join(empty, 'claude'), '');
    assert.equal(usage.findClaude(P([empty]), 'linux'), path.join(empty, 'claude'));
  } finally { t.cleanup(); }
});

test('command: the test override, PATH or Path, or null', () => {
  const t = tmpEnv();
  try {
    fs.writeFileSync(path.join(t.base, 'claude'), '');
    assert.deepEqual(usage.command({ CLAUDE_SLINE_CLAUDE: '/x/fake.js' }, 'linux'),
      { file: process.execPath, args: ['/x/fake.js'].concat(usage.ARGS), path: '/x/fake.js' });
    const want = { file: path.join(t.base, 'claude'), args: usage.ARGS, path: path.join(t.base, 'claude') };
    assert.deepEqual(usage.command({ PATH: t.base }, 'linux'), want);
    assert.deepEqual(usage.command({ Path: t.base }, 'linux'), want); // Windows spelling
    assert.equal(usage.command({ PATH: t.home }, 'linux'), null);
    assert.deepEqual(usage.ARGS, ['-p', '/usage', '--no-session-persistence', '--output-format', 'stream-json', '--verbose']);
  } finally { t.cleanup(); }
});
