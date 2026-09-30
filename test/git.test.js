'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { tmpEnv } = require('./helpers');
const git = require('../src/git');

function repo(dir, head) {
  fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.git', 'HEAD'), head);
}

test('branch from a normal repo, found from a subfolder', () => {
  const t = tmpEnv();
  try {
    const r = path.join(t.base, 'r');
    repo(r, 'ref: refs/heads/feature/x\n');
    fs.mkdirSync(path.join(r, 'a', 'b'), { recursive: true });
    assert.equal(git.branch(path.join(r, 'a', 'b')), 'feature/x');
  } finally { t.cleanup(); }
});

test('detached HEAD gives a short SHA', () => {
  const t = tmpEnv();
  try {
    const r = path.join(t.base, 'r');
    repo(r, '573b5b9e4fa40f48f92e19166bd37e1d20502586\n');
    assert.equal(git.branch(r), '573b5b9');
  } finally { t.cleanup(); }
});

test('worktree: .git file points at the real git dir', () => {
  const t = tmpEnv();
  try {
    const gd = path.join(t.base, 'main', '.git', 'worktrees', 'wt');
    fs.mkdirSync(gd, { recursive: true });
    fs.writeFileSync(path.join(gd, 'HEAD'), 'ref: refs/heads/worktree-plugin\n');
    const wt = path.join(t.base, 'wt');
    fs.mkdirSync(wt, { recursive: true });
    fs.writeFileSync(path.join(wt, '.git'), 'gitdir: ' + gd + '\n');
    assert.equal(git.branch(wt), 'worktree-plugin');
  } finally { t.cleanup(); }
});

test('relative gitdir in a .git file', () => {
  const t = tmpEnv();
  try {
    const gd = path.join(t.base, 'real');
    fs.mkdirSync(gd, { recursive: true });
    fs.writeFileSync(path.join(gd, 'HEAD'), 'ref: refs/heads/main\n');
    const wt = path.join(t.base, 'wt');
    fs.mkdirSync(wt, { recursive: true });
    fs.writeFileSync(path.join(wt, '.git'), 'gitdir: ../real\n');
    assert.equal(git.branch(wt), 'main');
  } finally { t.cleanup(); }
});

test('missing folder or garbage HEAD gives empty string', () => {
  const t = tmpEnv();
  try {
    assert.equal(git.branch(path.join(t.base, 'does-not-exist')), '');
    const r = path.join(t.base, 'r');
    repo(r, 'garbage\n');
    assert.equal(git.branch(r), '');
  } finally { t.cleanup(); }
});
