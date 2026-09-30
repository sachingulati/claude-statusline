'use strict';
// Status line templates: text, {field}, [optional group], {sep} and \ escapes.
// parse() never throws; render() of a parsed template never throws.

function err(message, column, fix) { return { message: message, column: column, fix: fix }; }
function fail(e) { return { parts: null, error: e }; }

function parse(text) {
  if (typeof text !== 'string' || text === '') {
    return fail(err('Template must be non-empty text', 1, 'Give it at least one field, e.g. {dir}'));
  }
  const top = [];
  let group = null; // parts of the open [ … ], or null
  let groupCol = 0;
  let buf = '';
  const flush = function () {
    if (buf) { (group || top).push({ type: 'text', value: buf }); buf = ''; }
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const col = i + 1;
    if (ch === '\\') {
      if (i + 1 >= text.length) return fail(err('Lone "\\" at the end', col, 'Write \\\\ for a backslash'));
      buf += text[++i];
      continue;
    }
    if (ch === '{') {
      const close = text.indexOf('}', i + 1);
      if (close === -1) return fail(err('Unclosed "{"', col, 'Close it with "}", or write \\{ for a literal brace'));
      const name = text.slice(i + 1, close).trim();
      if (!name) return fail(err('Empty "{}"', col, 'Put a field name inside, e.g. {dir}'));
      flush();
      if (name === 'sep') {
        if (group) return fail(err('{sep} inside [ ]', col, 'Move {sep} outside the brackets'));
        top.push({ type: 'sep' });
      } else {
        (group || top).push({ type: 'field', name: name, column: col });
      }
      i = close;
      continue;
    }
    if (ch === '}') return fail(err('Stray "}"', col, 'Remove it, or write \\} for a literal brace'));
    if (ch === '[') {
      if (group) return fail(err('"[" inside another [ ]', col, 'Groups can\'t nest; close the first one with "]"'));
      flush();
      group = [];
      groupCol = col;
      continue;
    }
    if (ch === ']') {
      if (!group) return fail(err('Stray "]"', col, 'Remove it, or write \\] for a literal bracket'));
      flush();
      top.push({ type: 'group', parts: group });
      group = null;
      continue;
    }
    buf += ch;
  }
  if (group) return fail(err('Unclosed "["', groupCol, 'Close it with "]", or write \\[ for a literal bracket'));
  flush();
  return { parts: top, error: null };
}

function fields(parts) {
  const list = [];
  parts.forEach(function (p) {
    if (p.type === 'field') list.push(p);
    if (p.type === 'group') p.parts.forEach(function (q) { if (q.type === 'field') list.push(q); });
  });
  return list;
}

// allowed: the field names, or a test for one; hint: the fix shown for an unknown field.
function check(text, allowed, hint) {
  const p = parse(text);
  if (p.error) return p.error;
  const ok = typeof allowed === 'function' ? allowed : function (n) { return allowed.indexOf(n) !== -1; };
  const bad = fields(p.parts).find(function (f) { return !ok(f.name); });
  const fix = hint || (Array.isArray(allowed) ? 'Fields here: ' + allowed.join(', ') : 'Use a field name this template accepts');
  return bad ? err('Unknown field {' + bad.name + '}', bad.column, fix) : null;
}

// null = empty; a name the caller doesn't know prints as typed so a typo is visible.
function fieldText(p, values, paint) {
  if (!Object.prototype.hasOwnProperty.call(values, p.name)) return '{' + p.name + '}';
  const v = values[p.name];
  return v == null ? null : paint(v.role, v.text);
}

function render(parts, values, opts) {
  let result = '';
  let pendingSep = false;
  parts.forEach(function (p) {
    if (p.type === 'sep') { pendingSep = true; return; }
    let s = '';
    if (p.type === 'text') s = p.value;
    else if (p.type === 'field') s = fieldText(p, values, opts.paint) || '';
    else {
      const bits = [];
      for (const q of p.parts) {
        if (q.type === 'text') { bits.push(q.value); continue; }
        const f = fieldText(q, values, opts.paint);
        if (f == null) { pendingSep = false; return; } // an empty field drops the whole group
        bits.push(f);
      }
      s = bits.join('');
    }
    if (s === '') { pendingSep = false; return; }
    if (pendingSep && result !== '') result += opts.sep;
    pendingSep = false;
    result += s;
  });
  return result;
}

module.exports = { parse, fields, check, render };
