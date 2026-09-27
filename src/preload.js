'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getState: () => ipcRenderer.invoke('state:get'),
  refreshBalance: () => ipcRenderer.invoke('balance:refresh'),
  saveSettings: (patch) => ipcRenderer.invoke('settings:save', patch),
  switchAccount: (id) => ipcRenderer.invoke('account:switch', id),
  switchModel: (accountId, model) => ipcRenderer.invoke('model:switch', accountId, model),
  fetchModels: () => ipcRenderer.invoke('models:fetch'),
  priceCompare: (promptTokens, completionTokens, force) => ipcRenderer.invoke('price:compare', promptTokens, completionTokens, force),
  fetchOfficialUsage: () => ipcRenderer.invoke('usage:fetch'),
  saveCalibration: (cost, tokens) => ipcRenderer.invoke('calibration:save', cost, tokens),
  licenseStatus: () => ipcRenderer.invoke('license:status'),
  activateLicense: (code) => ipcRenderer.invoke('license:activate', code),
  listProfiles: () => ipcRenderer.invoke('profile:list'),
  createProfile: (data) => ipcRenderer.invoke('profile:create', data),
  updateProfile: (id, patch) => ipcRenderer.invoke('profile:update', id, patch),
  deleteProfile: (id) => ipcRenderer.invoke('profile:delete', id),
  switchProfile: (id) => ipcRenderer.invoke('profile:switch', id),
  pickAvatar: (profileId) => ipcRenderer.invoke('profile:pickAvatar', profileId),
  addRecharge: (amount, note) => ipcRenderer.invoke('recharge:add', amount, note),
  exportCsv: () => ipcRenderer.invoke('data:export'),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  openExternal: (url) => ipcRenderer.invoke('shell:open', url),
  clearData: () => ipcRenderer.invoke('data:clear'),
  openDashboard: () => ipcRenderer.invoke('window:openDashboard'),
  showWidget: () => ipcRenderer.invoke('window:showWidget'),
  setWidgetAlwaysOnTop: (enabled) => ipcRenderer.invoke('widget:setAlwaysOnTop', enabled),
  hideWidget: () => ipcRenderer.invoke('window:hide'),
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximizeToggle: () => ipcRenderer.invoke('window:maximizeToggle'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  quit: () => ipcRenderer.invoke('app:quit'),
  notifyWidgetMove: (x, y) => ipcRenderer.send('widget:move', x, y),
  onState: (cb) => {
    ipcRenderer.on('state:update', (_e, s) => cb(s));
  },
});
