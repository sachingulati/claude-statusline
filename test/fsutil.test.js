'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { tmpEnv } = require('./helpers');
const fsutil = require('../src/fsutil');

test('writeJsonAtomic creates folders and round-trips', () => {
  const t = tmpEnv();
  try {
    const f = path.join(t.base, 'a', 'b', 'x.json');
    fsutil.writeJsonAtomic(f, { k: 1 });
    assert.deepEqual(fsutil.readJson(f, null), { k: 1 });
    assert.ok(fs.readFileSync(f, 'utf8').endsWith('\n'));
    assert.deepEqual(fs.readdirSync(path.dirname(f)), ['x.json']);
  } finally { t.cleanup(); }
});

test('readJson returns the fallback for a missing file and throws on bad JSON', () => {
  const t = tmpEnv();
  try {
    assert.equal(fsutil.readJson(path.join(t.base, 'none.json'), 'fb'), 'fb');
    const bad = path.join(t.base, 'bad.json');
    fs.writeFileSync(bad, '{ nope');
    assert.throws(() => fsutil.readJson(bad, {}), SyntaxError);
  } finally { t.cleanup(); }
});

test('timestamp has millisecond precision', () => {
  assert.match(fsutil.timestamp(new Date('2026-09-29T15:10:12.345Z')), /^20260929-151012345$/);
});

test('UserError carries a fix', () => {
  const e = new fsutil.UserError('bad', 'do this');
  assert.ok(e instanceof Error);
  assert.equal(e.fix, 'do this');
});
