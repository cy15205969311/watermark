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
  saveResource: (url, filename) => ipcRenderer.invoke('desktop:save-resource', { url, filename }),
}));
