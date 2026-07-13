'use strict';

const { app, BrowserWindow, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

const PORT = Number(process.env.PORT) || 8787;
const DASHBOARD_URL = `http://localhost:${PORT}`;
let mainWindow = null;
let tray = null;
let serverApi = null;
let backendRunning = false;

function getIcon() {
  const iconPath = path.join(__dirname, 'tray-icon.png');
  if (fs.existsSync(iconPath)) {
    const img = nativeImage.createFromPath(iconPath);
    if (!img.isEmpty()) return img;
  }
  return nativeImage.createEmpty();
}

async function startBackend() {
  if (backendRunning) return;
  if (!serverApi) {
    process.env.PORT = String(PORT);
    serverApi = require('./server.js');
  }
  serverApi.startBackend();
  backendRunning = true;
  refreshMenu();
}

async function stopBackend() {
  if (!backendRunning) return;
  await serverApi.stopBackend();
  backendRunning = false;
  refreshMenu();
}

async function restartBackend() {
  if (backendRunning) await stopBackend();
  await new Promise(r => setTimeout(r, 300));
  await startBackend();
  if (mainWindow) mainWindow.loadURL(DASHBOARD_URL);
}

function showWindow() {
  const win = createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function openDashboard() {
  showWindow();
}

function refreshMenu() {
  if (!tray) return;
  const status = backendRunning ? `● Running · :${PORT}` : '○ Stopped';
  const menu = Menu.buildFromTemplate([
    { label: `NPU Monitor  (${status})`, enabled: false },
    { type: 'separator' },
    { label: 'Open Window', enabled: true, click: openDashboard },
    { type: 'separator' },
    { label: 'Start Backend', enabled: !backendRunning, click: () => startBackend() },
    { label: 'Stop Backend', enabled: backendRunning, click: () => stopBackend() },
    { label: 'Restart Backend', enabled: backendRunning, click: () => restartBackend() },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
  tray.setToolTip(`NPU Monitor — ${status}`);
}

function createWindow() {
  if (mainWindow) return mainWindow;
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 500,
    backgroundColor: '#0a0c0f',
    title: 'NPU Monitor',
    icon: getIcon(),
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadURL(DASHBOARD_URL);
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; });
  return mainWindow;
}

if (process.platform === 'win32') app.setAppUserModelId('com.local.npus-monitor');

app.whenReady().then(async () => {
  if (process.platform === 'darwin' && app.dock) app.dock.hide();

  tray = new Tray(getIcon());
  tray.setToolTip('NPU Monitor');
  tray.on('click', openDashboard);
  tray.on('double-click', openDashboard);
  refreshMenu();

  await startBackend();
  createWindow();
});

app.on('before-quit', () => { app.isQuitting = true; });

app.on('window-all-closed', (e) => {
  if (e) e.preventDefault();
});

app.on('before-quit', async () => {
  if (backendRunning) {
    try { await serverApi.stopBackend(); } catch (_) {}
  }
});
