'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getState: () => ipcRenderer.invoke('state:get'),
  refreshBalance: () => ipcRenderer.invoke('balance:refresh'),
  saveSettings: (patch) => ipcRenderer.invoke('settings:save', patch),
  switchAccount: (id) => ipcRenderer.invoke('account:switch', id),
  addRecharge: (amount, note) => ipcRenderer.invoke('recharge:add', amount, note),
  exportCsv: () => ipcRenderer.invoke('data:export'),
  clearData: () => ipcRenderer.invoke('data:clear'),
  openDashboard: () => ipcRenderer.invoke('window:openDashboard'),
  hideWidget: () => ipcRenderer.invoke('window:hide'),
  minimize: () => ipcRenderer.invoke('window:minimize'),
  quit: () => ipcRenderer.invoke('app:quit'),
  notifyWidgetMove: (x, y) => ipcRenderer.send('widget:move', x, y),
  onState: (cb) => {
    ipcRenderer.on('state:update', (_e, s) => cb(s));
  },
});
