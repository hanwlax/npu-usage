'use strict';
// Launch the Electron desktop app in the background, then exit immediately
// so the terminal (or `npm run app`) doesn't hang.

const { spawn } = require('child_process');
const path = require('path');

const electronBin = require('electron');
const root = __dirname;

const child = spawn(electronBin, ['electron-app.js'], {
  cwd: root,
  detached: true,
  stdio: 'ignore',
  windowsHide: true,
});

child.unref();
child.on('error', (err) => {
  console.error('Failed to start app:', err.message);
  process.exit(1);
});

console.log(`NPU Monitor app started (pid ${child.pid}).`);
console.log('A window should appear shortly.');
console.log('Right-click the tray icon for menu. Use Quit to fully exit.');
setTimeout(() => process.exit(0), 200);
