'use strict';
// Small file helpers shared by the CLI and the status line.

const fs = require('fs');
const path = require('path');

// A problem the user can fix. The CLI prints message + fix and exits 1.
class UserError extends Error {
  constructor(message, fix) {
    super(message);
    this.name = 'UserError';
    this.fix = fix || '';
  }
}

function readJson(file, fallback) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { return fallback; }
  return JSON.parse(text);
}

// Temp file + rename, so a concurrent reader never sees half a file.
function writeFileAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp' + process.pid;
  try {
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, file);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch (e2) { /* nothing to clean */ }
    throw e;
  }
}

function writeJsonAtomic(file, obj) {
  writeFileAtomic(file, JSON.stringify(obj, null, 2) + '\n');
}

// Milliseconds included: two backups in the same second must not overwrite each other.
function timestamp(date) {
  return (date || new Date()).toISOString().replace(/[-:.]/g, '').replace('T', '-').slice(0, 18);
}

module.exports = { UserError, readJson, writeFileAtomic, writeJsonAtomic, timestamp };
