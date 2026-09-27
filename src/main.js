'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, dialog, Notification, shell, screen } = require('electron');

// 品牌更名为 Quanta 后显式固定用户数据目录（不随 productName 漂移），
// 并在首次启动时把旧品牌（Token消费器）的数据一次性迁移过来。
const APP_NAME = 'Quanta';
const userDataDir = path.join(app.getPath('appData'), APP_NAME);
const legacyDataDir = path.join(app.getPath('appData'), 'Token消费器', 'data');
app.setPath('userData', userDataDir);

// 必须在 require('./server') 之前设置：config.js 会在加载时读取数据目录，
// 打包版要写入系统用户目录而不是只读的 app.asar。
// 允许外部显式指定（测试/多环境隔离），例如 $env:TOKEN_DATA_DIR='D:\tmp\q'
if (!process.env.TOKEN_DATA_DIR) {
  process.env.TOKEN_DATA_DIR = path.join(userDataDir, 'data');
}

// 一次性迁移旧版数据（仅当新目录不存在且旧目录存在时）
try {
  if (!fs.existsSync(process.env.TOKEN_DATA_DIR) && fs.existsSync(legacyDataDir)) {
    fs.cpSync(legacyDataDir, process.env.TOKEN_DATA_DIR, { recursive: true });
  }
} catch (err) {
  console.error('数据迁移失败:', err.message);
}

const { createTokenServer } = require('./server');
const { checkForUpdate } = require('./server/update');

let mainWindow = null;
let widgetWindow = null;
let tray = null;
let server = null;
let pushTimer = null;
let notifQueue = [];
let notifTimer = null;

const UI_TEXT = {
  zh: {
    notifyRequest: '请求完成',
    notifyRequests: '次请求完成',
    notifyTokens: 'Token',
    notifyCost: '费用',
    notifyError: '请求失败',
    alertTitle: 'Quanta · 余额预警',
    alertBody: '账户「{name}」余额 {balance} 元，已低于预警线 {threshold} 元',
    updateTitle: '发现新版本',
    updateBody: 'Quanta {version} 已发布：{url}',
  },
  en: {
    notifyRequest: 'Request done',
    notifyRequests: 'requests done',
    notifyTokens: 'Tokens',
    notifyCost: 'Cost',
    notifyError: 'Request failed',
    alertTitle: 'Quanta · Balance Alert',
    alertBody: 'Account "{name}" balance {balance} CNY is below threshold {threshold} CNY',
    updateTitle: 'New version available',
    updateBody: 'Quanta {version} released: {url}',
  },
};

function langText(key) {
  const lang = server && server.config ? server.config.language || 'zh' : 'zh';
  const table = UI_TEXT[lang] || UI_TEXT.zh;
  return table[key] || key;
}

function formatText(template, vars) {
  return template.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m));
}

const ICON_PATH = path.join(__dirname, '..', 'assets', 'icon.png');
const PRELOAD = path.join(__dirname, 'preload.js');
// React 渲染层构建产物（renderer/dist，由 `npm run build:renderer` 生成）
const RENDERER_DIR = path.join(__dirname, '..', 'renderer', 'dist');
const STARTUP_LOG = path.join(os.tmpdir(), 'quanta-startup.log');

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

function maybeNotifyRequest(e) {
  const mode = server.config.requestNotify || 'all';
  if (mode === 'off' || !Notification.isSupported()) return;
  const isError = e.status >= 400;
  if (mode === 'error' && !isError) return;
  notifQueue.push(e);
  if (notifTimer) return;
  notifTimer = setTimeout(() => {
    notifTimer = null;
    const batch = notifQueue;
    notifQueue = [];
    let tokens = 0;
    let cost = 0;
    let errors = 0;
    for (const r of batch) {
      tokens += r.usage.totalTokens;
      cost += r.cost;
      if (r.status >= 400) errors += 1;
    }
    const title =
      batch.length === 1
        ? `${langText('notifyRequest')} · ${batch[0].model || '?'}${batch[0].status >= 400 ? ' ✗' : ''}`
        : `${batch.length} ${langText('notifyRequests')}${errors ? `（${errors} ✗）` : ''}`;
    const body = `${langText('notifyTokens')}: ${tokens.toLocaleString()} · ${langText('notifyCost')}: ¥${cost.toFixed(4)}`;
    new Notification({ title, body }).show();
  }, 2000);
}

function showWidget() {
  if (!widgetWindow || widgetWindow.isDestroyed()) {
    createWidget();
    return;
  }
  ensureWidgetVisible(widgetWindow);
  widgetWindow.show();
  widgetWindow.setAlwaysOnTop(true, 'screen-saver');
}

// 小窗显示前校准：若窗口中心不在「鼠标所在屏幕」内，则拉回该屏幕中央。
// 解决显示器布局变化（拔副屏/分辨率变化）后小窗跑到屏幕外/其他屏的问题。
function ensureWidgetVisible(w) {
  if (!w || w.isDestroyed()) return;
  try {
    const b = w.getBounds();
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;
    const target = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const a = target.workArea;
    const inside =
      cx >= a.x && cx < a.x + a.width && cy >= a.y && cy < a.y + a.height;
    if (inside) return;
    const { width, height } = server ? server.config.widget : { width: 360, height: 148 };
    const nx = a.x + Math.round((a.width - (width || 360)) / 2);
    const ny = a.y + Math.round((a.height - (height || 148)) / 2);
    w.setPosition(nx, ny);
    server?.updateConfig({ widget: { ...server.config.widget, x: nx, y: ny } });
  } catch {
    /* 忽略校准错误 */
  }
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
  widgetWindow.setAlwaysOnTop(cfg.widget.alwaysOnTop !== false, 'screen-saver');
  ensureWidgetVisible(widgetWindow);
  widgetWindow.loadFile(path.join(RENDERER_DIR, 'widget.html'));
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
    title: 'Quanta',
    icon: ICON_PATH,
    // 无边框：自绘玻璃标题栏（消除系统白色条，融入毛玻璃设计）
    frame: false,
    backgroundColor: '#0a0d14',
    webPreferences: { preload: PRELOAD, contextIsolation: true, nodeIntegration: false },
  });
  mainWindow.loadFile(path.join(RENDERER_DIR, 'dashboard.html'));
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
  tray.setToolTip('Quanta');
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
        const merged = { ...existing, ...a, apiKey: a.apiKey && !String(a.apiKey).includes('****') ? a.apiKey : existing ? existing.apiKey : '' };
        // 平台登录 Token：掩码（****）表示未修改
        if (a.platformToken !== undefined) {
          merged.platformToken = a.platformToken && !String(a.platformToken).includes('****') ? a.platformToken : existing ? existing.platformToken || '' : '';
        }
        // 多 Key 合并：掩码值（****）表示未修改，保留原 Key
        if (Array.isArray(a.apiKeys)) {
          merged.apiKeys = a.apiKeys
            .map((k) => {
              const old = existing && Array.isArray(existing.apiKeys) ? existing.apiKeys.find((x) => x.id === k.id) : null;
              const isMasked = String(k.key || '').includes('****');
              return { id: k.id, label: k.label || '', key: isMasked ? (old ? old.key : '') : k.key || '' };
            })
            .filter((k) => k.key || k.label);
        }
        return merged;
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
  ipcMain.handle('model:switch', async (_e, accountId, model) => {
    await server.switchModel(accountId, model);
    pushState();
    return server.snapshot().config;
  });
  ipcMain.handle('models:fetch', async () => {
    const r = await server.refreshAccountModels();
    pushState();
    return r;
  });
  ipcMain.handle('price:compare', async (_e, promptTokens, completionTokens, force) => {
    return server.priceCompare(promptTokens, completionTokens, Boolean(force));
  });
  ipcMain.handle('usage:fetch', async () => {
    server.officialMonth = null; // 清缓存强制刷新
    server.officialToday = null; // 今日实时数据一并刷新
    server.officialTrend = null; // 趋势数据一并刷新
    const r = await Promise.all([server.fetchOfficialMonthUsage(), server.fetchOfficialToday(), server.fetchOfficialTrend()]);
    pushState();
    return r[0];
  });
  ipcMain.handle('calibration:save', (_e, cost, tokens) => {
    const r = server.saveTodayCalibration(cost, tokens);
    pushState();
    return r;
  });
  // ---- 本地核销码授权 ----
  ipcMain.handle('license:status', () => server.licenseStatus());
  ipcMain.handle('license:activate', (_e, code) => {
    const r = server.activateLicense(code);
    pushState();
    return r;
  });
  // ---- 用户档案 ----
  ipcMain.handle('profile:list', () => server.snapshot().profiles);
  ipcMain.handle('profile:create', (_e, data) => {
    const p = server.createProfile(data);
    pushState();
    return p;
  });
  ipcMain.handle('profile:update', (_e, id, patch) => {
    const p = server.updateProfile(id, patch);
    pushState();
    return p;
  });
  ipcMain.handle('profile:delete', async (_e, id) => {
    await server.deleteProfile(id);
    pushState();
    return true;
  });
  ipcMain.handle('profile:switch', async (_e, id) => {
    await server.switchProfile(id);
    pushState();
    return server.snapshot().profiles;
  });
  ipcMain.handle('profile:pickAvatar', async (_e, profileId) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择头像图片',
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }],
      properties: ['openFile'],
    });
    if (result.canceled || !result.filePaths.length) return { saved: false, reason: '已取消' };
    try {
      const src = result.filePaths[0];
      const ext = (path.extname(src) || '.png').toLowerCase();
      const fileName = `${profileId}-${Date.now()}${ext}`;
      fs.copyFileSync(src, path.join(server.profiles.avatarsDir, fileName));
      const p = server.updateProfile(profileId, { avatar: fileName });
      pushState();
      return { saved: true, avatar: p.avatar };
    } catch (err) {
      return { saved: false, reason: err.message };
    }
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
  ipcMain.handle('update:check', async () => {
    const r = await checkForUpdate({
      feedUrl: server.config.updateFeedUrl,
      currentVersion: app.getVersion(),
      apiKey: '',
    });
    return r;
  });
  ipcMain.handle('shell:open', (_e, url) => {
    if (url) shell.openExternal(String(url));
  });
  ipcMain.handle('data:clear', () => {
    server.store.clear();
    pushState();
    return true;
  });
  ipcMain.handle('window:openDashboard', () => createDashboard());
  ipcMain.handle('window:showWidget', () => showWidget());
  ipcMain.handle('widget:setAlwaysOnTop', (_e, enabled) => {
    if (!server) return false;
    server.updateConfig({ widget: { ...server.config.widget, alwaysOnTop: Boolean(enabled) } });
    if (widgetWindow && !widgetWindow.isDestroyed()) {
      widgetWindow.setAlwaysOnTop(Boolean(enabled), 'screen-saver');
    }
    return Boolean(enabled);
  });
  ipcMain.handle('window:hide', () => {
    const w = BrowserWindow.getFocusedWindow();
    if (w && w !== mainWindow) w.hide();
  });
  ipcMain.handle('window:minimize', () => BrowserWindow.getFocusedWindow()?.minimize());
  ipcMain.handle('window:maximizeToggle', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMaximized()) mainWindow.unmaximize();
      else mainWindow.maximize();
      return mainWindow.isMaximized();
    }
    return false;
  });
  ipcMain.handle('window:close', () => {
    // 关闭主窗口 -> 驻留托盘（托盘菜单可重新打开）
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
  });
  ipcMain.handle('app:quit', () => app.quit());
  ipcMain.on('widget:move', (_e, x, y) => {
    if (server) server.updateConfig({ widget: { ...server.config.widget, x, y } });
  });
}

// QUANTA_ALLOW_MULTI=1 时跳过单实例锁（便于开发调试与隔离测试同时运行）
const gotLock = process.env.QUANTA_ALLOW_MULTI === '1' ? true : app.requestSingleInstanceLock();
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
    server.on('event', (e) => {
      if (e.kind === 'request') maybeNotifyRequest(e);
    });
    server.on('started', schedulePush);
    server.on('prices_synced', schedulePush);
    server.on('models_updated', schedulePush);
    server.on('usage_updated', schedulePush);
    server.on('alert', (message) => {
      if (Notification.isSupported()) {
        const t = formatText(langText('alertBody'), {
          name: message.accountName,
          balance: message.balance,
          threshold: message.threshold,
        });
        new Notification({ title: langText('alertTitle'), body: t }).show();
      }
    });
    try {
      await server.start();
      logStartup('server started on port ' + server.port + ', balance: ' + JSON.stringify(server.store.lastBalance));
    } catch (err) {
      logStartup('server start FAILED: ' + err.stack);
      dialog.showErrorBox('Quanta启动失败', err.message);
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
