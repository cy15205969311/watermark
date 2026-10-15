const { contextBridge, ipcRenderer } = require('electron');
// No filesystem, token or arbitrary IPC capability is exposed.
const connection = ipcRenderer.sendSync('desktop:connection');
contextBridge.exposeInMainWorld('desktop', Object.freeze({
  apiBaseUrl: connection.apiBaseUrl,
  clientId: connection.clientId,
  version: connection.version,
  setBusy: active => ipcRenderer.send('desktop:busy', active === true),
  onShowTutorial: callback => {
    if (typeof callback !== 'function') return () => {};
    const listener = () => callback();
    ipcRenderer.on('desktop:show-tutorial', listener);
    return () => ipcRenderer.removeListener('desktop:show-tutorial', listener);
  },
  openLogs: () => ipcRenderer.invoke('desktop:logs'),
  onShowSettings: callback => {
    if (typeof callback !== 'function') return () => {};
    const listener = () => callback();
    ipcRenderer.on('desktop:show-settings', listener);
    return () => ipcRenderer.removeListener('desktop:show-settings', listener);
  },
  getSettings: () => ipcRenderer.invoke('desktop:status'),
  chooseDownloadDirectory: () => ipcRenderer.invoke('desktop:choose-download'),
  resetDownloadDirectory: () => ipcRenderer.invoke('desktop:reset-download'),
  openDownloadDirectory: () => ipcRenderer.invoke('desktop:open-download'),
  backup: () => ipcRenderer.invoke('desktop:backup'),
  restore: () => ipcRenderer.invoke('desktop:restore'),
  exportDiagnostics: () => ipcRenderer.invoke('desktop:diagnostics'),
  saveResource: (url, filename) => ipcRenderer.invoke('desktop:save-resource', { url, filename }),
}));
