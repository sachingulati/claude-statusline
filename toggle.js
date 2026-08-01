#!/usr/bin/env node
'use strict';
// Toggle the hidden-usage flag. When present, the status line hides all
// usage numbers (see statusline-render.js).
//
//   node toggle.js            toggle on/off
//   node toggle.js on|hide    hide usage
//   node toggle.js off|show   show usage
//   node toggle.js status     print current state
//
// Takes effect on the next status-line render (a keystroke or any activity in an
// open session), across every running session at once.

const fs = require('fs');
const C = require('./src/config.js');

const arg = (process.argv[2] || 'toggle').toLowerCase();
const flag = C.HIDE_FLAG;
const exists = C.isHidden();

function hide() { try { fs.writeFileSync(flag, ''); } catch (e) {} }
function show() { try { fs.unlinkSync(flag); } catch (e) {} }

let hidden;
switch (arg) {
  case 'on': case 'hide': hide(); hidden = true; break;
  case 'off': case 'show': show(); hidden = false; break;
  case 'status': hidden = exists; break;
  case 'toggle': default:
    if (exists) { show(); hidden = false; } else { hide(); hidden = true; }
}

console.log('usage stats: ' + (hidden ? 'HIDDEN' : 'visible'));
