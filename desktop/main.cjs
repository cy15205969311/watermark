const { app, BrowserWindow, ipcMain, session, dialog, shell, Menu } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { loadConfiguration } = require('./config.cjs');
const { installLogging, sanitize } = require('./logging.cjs');
const { startBackend } = require('./backend.cjs');

app.setName('DesignExtractorPersonal');
// Stable across product display name/version changes.
app.setPath('userData', path.join(app.getPath('appData'), 'DesignExtractorPersonal'));
app.setAppUserModelId('com.designextractor.personal');
const ownsLock = app.requestSingleInstanceLock();
let window;
let backend;
let configuration;
let quitting = false;
let finishing = false;
if (!ownsLock) app.quit();
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', event => {
    if (finishing) return;
    event.preventDefault();
    if (quitting) return;
    quitting = true;
    if (window && !window.isDestroyed()) window.hide();
    const forced = setTimeout(() => { console.error('退出清理超时'); app.exit(1); }, 30000);
    Promise.resolve(backend?.stop()).catch(error => console.error('退出清理失败', error.message)).finally(() => {
      clearTimeout(forced); finishing = true; app.quit();
    });
  });
  app.whenReady().then(async () => {
    configuration = loadConfiguration(app.getPath('userData'));
    installLogging(path.join(configuration.directory, 'logs'));
    const staged = app.isPackaged ? app.getAppPath() : path.join(__dirname, '..', '.desktop-build', 'app');
    const browserRoot = app.isPackaged ? process.resourcesPath : path.join(__dirname, '..', '.desktop-build');
    const manifest = JSON.parse(fs.readFileSync(path.join(browserRoot, 'chromium', 'manifest.json'), 'utf8'));
    backend = await startBackend({ serverDirectory: path.join(staged, 'server'), frontendDirectory: path.join(staged, 'client'), chromiumPath: path.join(browserRoot, 'chromium', manifest.executable), configuration });
    if (quitting) { await backend.stop(); return; }
    const desktopSession = session.fromPartition('persist:personal');
    desktopSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    desktopSession.setPermissionCheckHandler(() => false);
    desktopSession.webRequest.onBeforeSendHeaders((details, callback) => {
      const url = new URL(details.url);
      const headers = { ...details.requestHeaders };
      // Never forward the credential to a remote host, redirect or resource.
      for (const key of Object.keys(headers)) if (key.toLowerCase() === 'x-desktop-session') delete headers[key];
      if (url.origin === backend.origin && (/^\/(api|uploads)\//.test(url.pathname))) headers['X-Desktop-Session'] = backend.token;
      callback({ requestHeaders: headers });
    });
    function trusted(event) {
      try { const url = new URL(event.senderFrame.url); return event.sender === window?.webContents && event.senderFrame === window.webContents.mainFrame && url.origin === backend.origin && url.pathname === '/'; }
      catch { return false; }
    }
    ipcMain.on('desktop:connection', event => {
      event.returnValue = trusted(event) ? { apiBaseUrl: `${backend.origin}/api`, clientId: configuration.clientId, version: app.getVersion() } : {};
    });
    ipcMain.handle('desktop:logs', event => { if (trusted(event)) return shell.openPath(path.join(configuration.directory, 'logs')); });
    let downloadQueue = Promise.resolve();
    ipcMain.handle('desktop:save-resource', (event, resource) => {
      if (!trusted(event)) throw new Error('不允许的保存请求');
      const task = async () => {
        const url = String(resource?.url || '');
        const parsed = new URL(url);
        if (!['https:', 'http:'].includes(parsed.protocol) && !/^data:image\/[a-z0-9.+-]+;base64,/i.test(url) && !url.startsWith(`blob:${backend.origin}/`)) throw new Error('不支持的资源类型');
        if (url.length > 16 * 1024 * 1024) throw new Error('资源地址过大');
        const filename = path.basename(String(resource?.filename || 'design.png')).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
        const choice = await dialog.showSaveDialog(window, { title: '保存设计资源', defaultPath: path.join(app.getPath('downloads'), filename) });
        if (choice.canceled) return { canceled: true };
        if (/^data:image\//i.test(url)) {
          await fs.promises.writeFile(choice.filePath, Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'));
          return { saved: true };
        }
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => { pendingDownloads.delete(url); expiredDownloads.add(url); reject(new Error('下载启动超时')); }, 30000);
          pendingDownloads.set(url, { path: choice.filePath, resolve, reject, timer });
          try { window.webContents.downloadURL(url); }
          catch (error) { clearTimeout(timer); pendingDownloads.delete(url); reject(error); }
        });
      };
      const result = downloadQueue.then(task);
      downloadQueue = result.catch(() => {});
      return result;
    });
    const pendingDownloads = new Map();
    const expiredDownloads = new Set();
    desktopSession.on('will-download', async (_event, item) => {
      const expired = [item.getURL(), ...item.getURLChain()].find(url => expiredDownloads.has(url));
      if (expired) { expiredDownloads.delete(expired); item.cancel(); return; }
      const key = [item.getURL(), ...item.getURLChain()].find(url => pendingDownloads.has(url));
      const pending = pendingDownloads.get(key);
      if (pending) {
        pendingDownloads.delete(key); clearTimeout(pending.timer); item.setSavePath(pending.path);
        item.once('done', (_doneEvent, state) => { if (state === 'completed') pending.resolve({ saved: true }); else pending.reject(new Error(state === 'cancelled' ? '下载已取消' : '下载中断，请检查网络并重试')); });
        return;
      }
      item.pause();
      try {
        const result = await dialog.showSaveDialog(window, { title: '保存设计资源', defaultPath: path.join(app.getPath('downloads'), path.basename(item.getFilename())) });
        if (result.canceled) item.cancel();
        else { item.setSavePath(result.filePath); item.resume(); }
      } catch (error) { item.cancel(); console.error('保存文件失败', error.message); }
    });
    window = new BrowserWindow({ width: 1280, height: 860, minWidth: 900, minHeight: 650, show: false,
      title: '去水印下载助手 · 个人版', icon: path.join(__dirname, 'assets', 'icon.ico'),
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, session: desktopSession },
    });
    window.on('query-session-end', () => app.quit());
    const external = url => { try { const u = new URL(url); if (['https:', 'http:'].includes(u.protocol) && u.origin !== backend.origin) shell.openExternal(u.href); } catch {} };
    window.webContents.setWindowOpenHandler(({ url }) => { external(url); return { action: 'deny' }; });
    window.webContents.on('will-navigate', (event, url) => { const target = new URL(url); if (target.origin !== backend.origin || target.pathname !== '/') { event.preventDefault(); external(url); } });
    window.webContents.on('will-attach-webview', event => event.preventDefault());
    window.webContents.on('render-process-gone', (_event, details) => { console.error('界面进程退出', details.reason); app.quit(); });
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: '应用', submenu: [{ label: '打开日志目录', click: () => shell.openPath(path.join(configuration.directory, 'logs')) }, { label: '打开用户数据目录', click: () => shell.openPath(configuration.directory) }, { type: 'separator' }, { role: 'quit', label: '退出' }] },
      { label: '编辑', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
      { label: '查看', submenu: [{ role: 'reload' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }] },
    ]));
    await window.loadURL(backend.origin);
    window.show();
  }).catch(async error => {
    console.error('桌面启动失败', error.message);
    await dialog.showMessageBox({ type: 'error', title: '无法启动去水印下载助手', message: sanitize(error.message), detail: '历史记录保留在用户数据目录。请检查磁盘空间、资源文件和日志后重试。' });
    app.quit();
  });
  process.on('uncaughtException', error => { console.error('未处理异常', error.message); app.quit(); });
  process.on('unhandledRejection', error => { console.error('未处理异步异常', error?.message || error); app.quit(); });
}
