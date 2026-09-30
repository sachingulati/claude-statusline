'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { tmpEnv, writeJson, stripAnsi } = require('./helpers');
const S = require('../src/subagents');
const F = require('../src/format');

const NOW = Date.UTC(2026, 8, 30, 12);
const LONG = 'Reading every file in the test folder one at a time'; // 51 characters

function task(over) {
  return Object.assign({
    id: 'a7370f0307962fcfa', type: 'local_agent', status: 'running',
    description: 'Watch probe', label: 'Reading fsutil.js', startTime: NOW - 102000,
    model: 'claude-haiku-4-5-20251001', contextWindowSize: 200000, tokenCount: 32400,
    tokenSamples: [0, 32400], cwd: '/x',
  }, over || {});
}

// A session transcript, plus the meta file Claude Code writes next to it for each subagent.
function session(t, metas) {
  const dir = path.join(t.base, 'projects', 'proj');
  const transcript = path.join(dir, 'sess.jsonl');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(transcript, '');
  Object.keys(metas || {}).forEach(function (id) {
    const f = path.join(dir, 'sess', 'subagents', 'agent-' + id + '.meta.json');
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, typeof metas[id] === 'string' ? metas[id] : JSON.stringify(metas[id]));
  });
  return transcript;
}

function runWith(t, input, env) {
  return S.run(typeof input === 'string' ? input : JSON.stringify(input), { env: Object.assign({}, t.env, env || {}), now: NOW });
}

function rows(out) { return out === '' ? [] : out.replace(/\n$/, '').split('\n').map(l => JSON.parse(l)); }

test('golden: the default row for a running general-purpose subagent', () => {
  const t = tmpEnv();
  try {
    const transcript = session(t, { a7370f0307962fcfa: { agentType: 'general-purpose', description: 'Watch probe' } });
    const out = runWith(t, { session_id: 's', transcript_path: transcript, columns: 200, tasks: [task()] });
    assert.ok(out.endsWith('\n'));
    const r = rows(out);
    assert.equal(r.length, 1);
    assert.equal(r[0].id, 'a7370f0307962fcfa');
    assert.equal(stripAnsi(r[0].content), 'general-purpose  Reading fsutil.js · model:Haiku 4.5 · ctx: 16% · tokens:32.4k · 1m42s');
    assert.ok(r[0].content.includes(F.GREEN + '16%' + F.RESET)); // ctx coloured like line 1
    assert.ok(!/\x1b/.test(rows(runWith(t, { transcript_path: transcript, tasks: [task()] }, { NO_COLOR: '1' }))[0].content));
  } finally { t.cleanup(); }
});

test('one row per task, in order, each with its own type', () => {
  const t = tmpEnv();
  try {
    const transcript = session(t, { a1: { agentType: 'Explore' }, b2: { agentType: 'general-purpose' } });
    const r = rows(runWith(t, { transcript_path: transcript, tasks: [task({ id: 'a1', label: 'one' }), task({ id: 'b2', label: 'two' })] }));
    assert.deepEqual(r.map(x => x.id), ['a1', 'b2']);
    assert.match(stripAnsi(r[0].content), /^Explore {2}one · /);
    assert.match(stripAnsi(r[1].content), /^general-purpose {2}two · /);
  } finally { t.cleanup(); }
});

test('no type when the meta file is missing, malformed, lacks agentType, or there is no transcript', () => {
  const t = tmpEnv();
  try {
    const transcript = session(t, { bad: '{ not json', none: { description: 'x' } });
    for (const id of ['missing', 'bad', 'none']) {
      const r = rows(runWith(t, { transcript_path: transcript, tasks: [task({ id })] }));
      assert.match(stripAnsi(r[0].content), /^Reading fsutil\.js · model:Haiku 4\.5/, id);
    }
    assert.match(stripAnsi(rows(runWith(t, { tasks: [task()] }))[0].content), /^Reading fsutil\.js · /);
  } finally { t.cleanup(); }
});

test('agentType refuses ids that could leave the subagents folder', () => {
  const t = tmpEnv();
  try {
    const transcript = session(t, {});
    // agent-../../x.meta.json would resolve to <session>/x.meta.json
    writeJson(path.join(t.base, 'projects', 'proj', 'sess', 'x.meta.json'), { agentType: 'evil' });
    assert.equal(S.agentType(transcript, '../../x'), null);
    assert.equal(S.agentType(transcript, 'a/b'), null);
    assert.equal(S.agentType(transcript, ''), null);
    assert.equal(S.agentType(123, 'a1'), null);
  } finally { t.cleanup(); }
});

test('bad input prints nothing, so every row keeps Claude Code\'s default', () => {
  const t = tmpEnv();
  try {
    for (const input of ['not json', '', 'null', '{}', '{"tasks":"x"}', '[]']) assert.equal(runWith(t, input), '', input);
  } finally { t.cleanup(); }
});

test('entries that are not tasks are skipped', () => {
  const t = tmpEnv();
  try {
    const r = rows(runWith(t, { tasks: [null, 5, 'x', { label: 'no id' }, { id: '', label: 'empty id' }, task({ id: 'ok1' })] }));
    assert.deepEqual(r.map(x => x.id), ['ok1']);
  } finally { t.cleanup(); }
});

test('a row that renders empty is skipped, never sent as empty content', () => {
  const t = tmpEnv();
  try {
    writeJson(t.p.configFile, { display: { subagent: '[{type}]' } });
    assert.equal(runWith(t, { tasks: [task()] }), ''); // no meta file: {type} empty
  } finally { t.cleanup(); }
});

test('a broken hand-edited template draws the default row with the error hint', () => {
  const t = tmpEnv();
  try {
    writeJson(t.p.configFile, { display: { subagent: '[{activity}' } });
    const c = stripAnsi(rows(runWith(t, { tasks: [task()] }))[0].content);
    assert.match(c, /^Reading fsutil\.js · model:Haiku 4\.5 .* {2}\(template error: \/sline:doctor\)$/);
  } finally { t.cleanup(); }
});

test('width: shortens the activity to fit, never below 10 characters', () => {
  const t = tmpEnv();
  try {
    const transcript = session(t, { a7370f0307962fcfa: { agentType: 'general-purpose' } });
    const at = columns => stripAnsi(rows(runWith(t, { transcript_path: transcript, columns, tasks: [task({ label: LONG })] }))[0].content);
    // full row: 17 + 51 + 52 = 120 columns
    assert.equal(at(200), 'general-purpose  ' + LONG + ' · model:Haiku 4.5 · ctx: 16% · tokens:32.4k · 1m42s');
    const fitted = at(100);
    assert.equal(F.visibleWidth(fitted), 100);
    assert.equal(fitted, 'general-purpose  ' + LONG.slice(0, 30) + '… · model:Haiku 4.5 · ctx: 16% · tokens:32.4k · 1m42s');
    assert.equal(at(40), 'general-purpose  Reading e… · model:Haiku 4.5 · ctx: 16% · tokens:32.4k · 1m42s'); // floor
    assert.equal(at(5).indexOf('Reading e…'), 17); // tiny panel: still the floor, no crash
    // no columns: nothing shortened
    assert.ok(stripAnsi(rows(runWith(t, { transcript_path: transcript, tasks: [task({ label: LONG })] }))[0].content).includes(LONG));
    // a short activity is never padded or cut
    assert.match(stripAnsi(rows(runWith(t, { transcript_path: transcript, columns: 20, tasks: [task({ label: 'Hi' })] }))[0].content), /^general-purpose {2}Hi · /);
  } finally { t.cleanup(); }
});

test('width: shortening never cuts an emoji in half', () => {
  const t = tmpEnv();
  try {
    // 30 emoji (60 columns) + 52 columns of stats, in 80 columns: 13 emoji and the … fit
    const c = stripAnsi(rows(runWith(t, { columns: 80, tasks: [task({ label: '\u{1F600}'.repeat(30) })] }))[0].content);
    assert.ok(!/[\ud800-\udbff](?![\udc00-\udfff])|(?:^|[^\ud800-\udbff])[\udc00-\udfff]/.test(c), JSON.stringify(c));
    assert.equal(c, '\u{1F600}'.repeat(13) + '… · model:Haiku 4.5 · ctx: 16% · tokens:32.4k · 1m42s');
  } finally { t.cleanup(); }
});

test('width: Chinese, Japanese and Korean text is shortened by the columns it takes', () => {
  const t = tmpEnv();
  try {
    const at = (label, columns) => stripAnsi(rows(runWith(t, { columns, tasks: [task({ label })] }))[0].content);
    const stats = ' · model:Haiku 4.5 · ctx: 16% · tokens:32.4k · 1m42s'; // 52 columns
    // 40 kanji (80 columns) in 80: 27 columns left, so 13 kanji and the … fit
    const c = at('読'.repeat(40), 80);
    assert.equal(c, '読'.repeat(13) + '…' + stats);
    assert.equal(F.visibleWidth(c), 79);
    // mixed Japanese and Latin: cut where the next character would not fit
    // (43 columns; 27 left: 11 wide characters = 22, then " test" = 27)
    assert.equal(at('ファイルを読んでいます test.js を確認中です', 80), 'ファイルを読んでいます test…' + stats);
    // hangul, at the 10-character floor
    assert.equal(at('한'.repeat(20), 60), '한'.repeat(9) + '…' + stats);
    // already fits: untouched
    assert.equal(at('読み込み中', 80), '読み込み中' + stats);
  } finally { t.cleanup(); }
});
