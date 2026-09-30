'use strict';
// Fitting status lines to the terminal width: shorter folder paths, fewer [ … ] groups,
// and, last, a cut with an ellipsis. Pure functions over strings and parsed templates.

const F = require('./format');

// ~/projects/ai/app → ~/…/ai/app → ~/…/app → …/app. The head (~, a drive, or the root)
// stays while folders remain; the last folder name is never cut.
function dirVariants(s) {
  const parts = String(s).split('/');
  // A head of '' is the root: it goes with the first cut (/srv/app → …/app).
  let head = null;
  if (parts.length > 1 && (parts[0] === '~' || parts[0] === '' || /^[A-Za-z]:$/.test(parts[0]))) head = parts.shift();
  const out = [String(s)];
  for (let k = 1; k < parts.length; k++) out.push((head ? head + '/…/' : '…/') + parts.slice(k).join('/'));
  if (head && parts[parts.length - 1]) out.push('…/' + parts[parts.length - 1]);
  return out.filter(function (v, i) { return out.indexOf(v) === i; });
}

function groupCount(parts) {
  return parts.filter(function (p) { return p.type === 'group'; }).length;
}

// The template without its last k top-level [ … ] groups.
function dropGroups(parts, k) {
  if (!(k > 0)) return parts;
  const idx = [];
  parts.forEach(function (p, i) { if (p.type === 'group') idx.push(i); });
  const gone = new Set(idx.slice(Math.max(0, idx.length - k)));
  return parts.filter(function (p, i) { return !gone.has(i); });
}

// At most `width` columns, ending in … when cut. Colour codes pass through; one still open
// at the cut is closed before the ….
function truncate(s, width) {
  s = String(s);
  if (F.visibleWidth(s) <= width) return s;
  if (width < 1) return '';
  let out = '';
  let w = 0;
  let open = false;
  let i = 0;
  while (i < s.length) {
    if (s[i] === '\x1b') {
      const m = /^\x1b\[[0-9;]*m/.exec(s.slice(i));
      if (m) { out += m[0]; open = m[0] !== F.RESET && m[0] !== '\x1b[m'; i += m[0].length; continue; }
    }
    const ch = String.fromCodePoint(s.codePointAt(i));
    const cw = F.charWidth(ch, s[i + ch.length]);
    if (w + cw > width - 1) break;
    out += ch;
    w += cw;
    i += ch.length;
  }
  return out + (open ? F.RESET : '') + '…';
}

module.exports = { dirVariants, groupCount, dropGroups, truncate };
