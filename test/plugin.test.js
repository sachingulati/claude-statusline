'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const USER_SKILLS = ['init', 'config', 'usage', 'doctor', 'uninstall'];

function frontmatter(file) {
  const text = fs.readFileSync(file, 'utf8');
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  assert.ok(m, file + ' has frontmatter');
  const fm = {};
  m[1].split('\n').forEach(function (line) {
    const i = line.indexOf(':');
    if (i > 0) fm[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  });
  return { fm, body: text.slice(m[0].length) };
}

test('user-run skills are manual-only, pre-approve only the sline CLI, and call the CLI', () => {
  for (const name of USER_SKILLS) {
    const { fm, body } = frontmatter(path.join(ROOT, 'skills', name, 'SKILL.md'));
    assert.ok(fm.description, name + ' description');
    assert.equal(fm['disable-model-invocation'], 'true', name);
    assert.equal(fm['allowed-tools'], 'Bash(node "${CLAUDE_PLUGIN_ROOT}/cli/sl.js" *)', name);
    assert.ok(body.includes('node "${CLAUDE_PLUGIN_ROOT}/cli/sl.js"'), name + ' runs the CLI');
    assert.ok(!/!`/.test(body), name + ' uses no ! context injection');
  }
});

test('quota skill is model-invocable', () => {
  const { fm, body } = frontmatter(path.join(ROOT, 'skills', 'quota', 'SKILL.md'));
  assert.equal(fm['disable-model-invocation'], undefined);
  assert.ok(body.includes('cli/sl.js" quota --json'));
});

test('no commands/, bin/ or hooks/, no marketplace.json', () => {
  assert.equal(fs.existsSync(path.join(ROOT, 'commands')), false);
  assert.equal(fs.existsSync(path.join(ROOT, 'hooks')), false);
  assert.equal(fs.existsSync(path.join(ROOT, 'bin')), false);
  assert.equal(fs.existsSync(path.join(ROOT, '.claude-plugin', 'marketplace.json')), false);
});
