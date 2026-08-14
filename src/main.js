'use strict';

const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, dialog } = require('electron');
const { createTokenServer } = require('./server');
const { loadConfig, saveConfig } = require('./server/config');

let mainWindow = null;
let widgetWindow = null;
let tray = null;
let server = null;
let pushTimer = null;

const ICON_PATH = path.join(__dirname, '..', 'assets', 'icon.png');
const PRELOAD = path.join(__dirname, 'preload.js');

function pushState() {
  if (!server) return;
  const snapshot = server.snapshot();
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('state:update', snapshot);
  }
}

function schedulePush() {
  if (pushTimer) return;
  pushTimer = setTimeout(() => {
    pushTimer = null;
    pushState();
  }, 150);
}

function showWidget() {
  if (!widgetWindow || widgetWindow.isDestroyed()) {
    createWidget();
    return;
  }
  widgetWindow.show();
  widgetWindow.setAlwaysOnTop(true, 'screen-saver');
}

function createWidget() {
  const cfg = server.config;
  const { width, height, x, y } = cfg.widget;
  widgetWindow = new BrowserWindow({
    width,
    height,
    x: x || undefined,
    y: y || undefined,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    fullscreenable: false,
    hasShadow: false,
    alwaysOnTop: true,
    show: false,
    webPreferences: { preload: PRELOAD, contextIsolation: true, nodeIntegration: false },
    icon: ICON_PATH,
  });
  widgetWindow.setAlwaysOnTop(true, 'screen-saver');
  widgetWindow.loadFile(path.join(__dirname, 'renderer', 'widget.html'));
  widgetWindow.once('ready-to-show', () => widgetWindow.show());
  widgetWindow.on('closed', () => {
    widgetWindow = null;
  });
  let moveTimer = null;
  widgetWindow.on('moved', () => {
    if (!widgetWindow) return;
    clearTimeout(moveTimer);
    moveTimer = setTimeout(() => {
      const [wx, wy] = widgetWindow.getPosition();
      server.updateConfig({ widget: { ...server.config.widget, x: wx, y: wy } });
    }, 400);
  });
}

function createDashboard() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 940,
    minHeight: 640,
    title: 'Token消费器',
    icon: ICON_PATH,
    autoHideMenuBar: true,
    backgroundColor: '#0f1117',
    webPreferences: { preload: PRELOAD, contextIsolation: true, nodeIntegration: false },
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'dashboard.html'));
  const capturePath = process.env.TOKEN_CAPTURE;
  if (capturePath) {
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          const image = await mainWindow.webContents.capturePage();
          fs.writeFileSync(capturePath, image.toPNG());
          app.quit();
        } catch (err) {
          console.error('capture failed:', err);
          app.exit(1);
        }
      }, 2000);
    });
  }
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(ICON_PATH));
  tray.setToolTip('Token消费器');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '打开仪表盘', click: () => createDashboard() },
      { label: '显示悬浮窗', click: () => showWidget() },
      { label: '刷新余额', click: () => server?.pollBalance() },
      { type: 'separator' },
      { label: '退出', click: () => app.quit() },
    ])
  );
  tray.on('click', () => createDashboard());
}

function registerIpc() {
  ipcMain.handle('state:get', () => server.snapshot());
  ipcMain.handle('balance:refresh', async () => {
    await server.pollBalance();
    pushState();
    return server.snapshot();
  });
  ipcMain.handle('settings:save', async (_e, patch) => {
    const cfg = server.updateConfig(patch);
    app.setLoginItemSettings({ openAtLogin: Boolean(cfg.autoStart), path: process.execPath });
    await server.restartProxy();
    server.rescheduleBalancePoll();
    pushState();
    return server.snapshot().config;
  });
  ipcMain.handle('data:clear', () => {
    server.store.clear();
    pushState();
    return true;
  });
  ipcMain.handle('window:openDashboard', () => createDashboard());
  ipcMain.handle('window:hide', () => {
    const w = BrowserWindow.getFocusedWindow();
    if (w && w !== mainWindow) w.hide();
  });
  ipcMain.handle('window:minimize', () => BrowserWindow.getFocusedWindow()?.minimize());
  ipcMain.handle('app:quit', () => app.quit());
  ipcMain.on('widget:move', (_e, x, y) => {
    if (server) server.updateConfig({ widget: { ...server.config.widget, x, y } });
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => createDashboard());

  app.whenReady().then(async () => {
    registerIpc();
    server = createTokenServer();
    server.on('event', schedulePush);
    server.on('started', schedulePush);
    try {
      await server.start();
    } catch (err) {
      dialog.showErrorBox('Token消费器启动失败', err.message);
      app.quit();
      return;
    }
    app.setLoginItemSettings({ openAtLogin: Boolean(server.config.autoStart), path: process.execPath });
    createTray();
    createWidget();
    createDashboard();
  });

  app.on('activate', () => createDashboard());
  app.on('window-all-closed', () => {
    // 驻留托盘，不退出
  });
  app.on('before-quit', () => {
    server?.stop();
  });
}
