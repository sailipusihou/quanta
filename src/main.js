'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, dialog, Notification } = require('electron');

// 必须在 require('./server') 之前设置：config.js 会在加载时读取数据目录，
// 打包版要写入系统用户目录而不是只读的 app.asar。
process.env.TOKEN_DATA_DIR = path.join(app.getPath('userData'), 'data');

const { createTokenServer } = require('./server');

let mainWindow = null;
let widgetWindow = null;
let tray = null;
let server = null;
let pushTimer = null;

const ICON_PATH = path.join(__dirname, '..', 'assets', 'icon.png');
const PRELOAD = path.join(__dirname, 'preload.js');
const STARTUP_LOG = path.join(os.tmpdir(), 'token-consumer-startup.log');

function logStartup(msg) {
  try {
    fs.appendFileSync(STARTUP_LOG, `${new Date().toISOString()} ${msg}\n`, 'utf8');
  } catch {
    /* 忽略日志写入错误 */
  }
}

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
    if (Array.isArray(patch.accounts)) {
      patch.accounts = patch.accounts.map((a) => {
        const existing = server.config.accounts.find((x) => x.id === a.id);
        return { ...existing, ...a, apiKey: a.apiKey ? a.apiKey : existing ? existing.apiKey : '' };
      });
    }
    const cfg = server.updateConfig(patch);
    app.setLoginItemSettings({ openAtLogin: Boolean(cfg.autoStart), path: process.execPath });
    await server.restartProxy();
    server.rescheduleBalancePoll();
    server.alertFired = false;
    server.checkAlert(server.store.lastBalance);
    pushState();
    return server.snapshot().config;
  });
  ipcMain.handle('account:switch', async (_e, id) => {
    await server.switchAccount(id);
    pushState();
    return server.snapshot().config;
  });
  ipcMain.handle('recharge:add', (_e, amount, note) => {
    const entry = server.addRecharge(amount, note);
    pushState();
    return entry;
  });
  ipcMain.handle('data:export', async () => {
    const { toCsv } = require('./server/export');
    const rows = server.store.events.filter((e) => e.kind === 'request');
    if (!rows.length) return { saved: false, reason: '暂无请求记录' };
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '导出消耗记录',
      defaultPath: `token-usage-${new Date().toISOString().slice(0, 10)}.csv`,
      filters: [{ name: 'CSV 文件', extensions: ['csv'] }],
    });
    if (result.canceled || !result.filePath) return { saved: false, reason: '已取消' };
    fs.writeFileSync(result.filePath, toCsv(rows), 'utf8');
    return { saved: true, path: result.filePath };
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
    logStartup('whenReady entered');
    registerIpc();
    logStartup('data dir: ' + process.env.TOKEN_DATA_DIR);
    server = createTokenServer();
    logStartup('server created');
    server.on('event', schedulePush);
    server.on('started', schedulePush);
    server.on('alert', (message) => {
      if (Notification.isSupported()) {
        new Notification({ title: 'Token消费器 · 余额预警', body: message }).show();
      }
    });
    try {
      await server.start();
      logStartup('server started on port ' + server.port + ', balance: ' + JSON.stringify(server.store.lastBalance));
    } catch (err) {
      logStartup('server start FAILED: ' + err.stack);
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

process.on('uncaughtException', (err) => logStartup('uncaughtException: ' + err.stack));
process.on('unhandledRejection', (err) => logStartup('unhandledRejection: ' + (err && err.stack)));
