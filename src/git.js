'use strict';
// Current branch read straight from .git, so the status line needs no git binary
// and spawns no process on every render.

const fs = require('fs');
const path = require('path');

function findGitDir(start) {
  let dir = path.resolve(start);
  for (;;) {
    const g = path.join(dir, '.git');
    let st = null;
    try { st = fs.statSync(g); } catch (e) { st = null; }
    if (st && st.isDirectory()) return g;
    if (st && st.isFile()) {
      // Worktrees and submodules: ".git" is a file saying where the git dir is.
      const m = /^gitdir:\s*(.+?)\s*$/m.exec(fs.readFileSync(g, 'utf8'));
      return m ? path.resolve(dir, m[1]) : null;
    }
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

function branch(start) {
  try {
    const gd = findGitDir(start);
    if (!gd) return '';
    const head = fs.readFileSync(path.join(gd, 'HEAD'), 'utf8').trim();
    const m = /^ref:\s*refs\/heads\/(.+)$/.exec(head);
    if (m) return m[1];
    if (/^[0-9a-f]{7,}$/i.test(head)) return head.slice(0, 7);
    return '';
  } catch (e) {
    return '';
  }
}

module.exports = { branch };
