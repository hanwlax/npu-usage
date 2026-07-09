'use strict';
// Launch the Electron tray app in the background, then exit immediately so the
// terminal (or `npm run tray`) doesn't hang.

const { spawn } = require('child_process');
const path = require('path');

const electronBin = require('electron');
const root = __dirname;

const child = spawn(electronBin, ['.'], {
  cwd: root,
  detached: true,
  stdio: 'ignore',
  windowsHide: true,
});

child.unref();
child.on('error', (err) => {
  console.error('Failed to start tray:', err.message);
  process.exit(1);
});

console.log(`NPU Monitor tray started (pid ${child.pid}).`);
console.log('Look for the amber icon in the system tray.');
console.log('This terminal can be closed safely.');
console.log('Right-click the tray icon for Open Dashboard / Stop / Quit.');
setTimeout(() => process.exit(0), 200);
