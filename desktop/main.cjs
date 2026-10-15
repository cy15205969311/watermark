const { app, BrowserWindow, ipcMain, session, dialog, shell, Menu, clipboard } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { loadConfiguration } = require('./config.cjs');
const { installLogging, sanitize } = require('./logging.cjs');
const { startBackend } = require('./backend.cjs');
const { installMenus } = require('./menus.cjs');
const { installSettings } = require('./settings.cjs');
const { chooseResourceSavePath, directoryError } = require('./download-directory.cjs');
const { recoverInterruptedRestore } = require('./personal-data.cjs');
const { recordError, recordBrowserFailure, recentErrors } = require('./diagnostics.cjs');
const { createPaths, initializePaths } = require('./paths.cjs');
const { prepareStorage } = require('./storage-migration.cjs');
const { createFeedback } = require('./feedback.cjs');
const productVersion = require('../package.json').version;

app.setName('DesignExtractorPersonal');
// Capture legacy location read-only, then redirect Chromium/Electron BEFORE
// ready, the single-instance lock, session creation, or backend initialization.
const legacyDirectory = path.join(app.getPath('appData'), 'DesignExtractorPersonal', 'personal');
let paths, pathFailure;
try {
  paths = createPaths({ app, developmentRoot: !app.isPackaged ? process.env.DESIGN_EXTRACTOR_DEV_DATA_DIR : undefined });
  initializePaths(app, paths);
} catch (error) { pathFailure = error; }
app.setAppUserModelId('com.designextractor.personal');
const ownsLock = !pathFailure && app.requestSingleInstanceLock();
let window;
let backend;
let configuration;
let quitting = false;
let finishing = false;
let settingsManager;
if (pathFailure) {
  dialog.showErrorBox('个人数据目录无法初始化', pathFailure.message); app.exit(1);
} else if (!ownsLock) app.quit();
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', event => {
    if (finishing) return;
    event.preventDefault();
    if (settingsManager?.isActive()) {
      dialog.showMessageBoxSync(window, { type: 'info', title: '个人数据操作正在进行', message: '请完成或取消当前设置、备份、恢复或诊断操作后再退出。', buttons: ['确定'] });
      return;
    }
    if (quitting) return;
    quitting = true;
    if (window && !window.isDestroyed()) window.hide();
    const forced = setTimeout(() => { console.error('退出清理超时'); app.exit(1); }, 30000);
    Promise.resolve(backend?.stop()).catch(error => console.error('退出清理失败', error.message)).finally(() => {
      clearTimeout(forced); finishing = true; app.quit();
    });
  });
  app.whenReady().then(async () => {
    await prepareStorage({ paths, legacyDirectory, dialog });
    recoverInterruptedRestore(paths.dataDirectory);
    configuration = loadConfiguration(app.getPath('userData'), paths);
    installLogging(paths.logsDirectory);
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
      event.returnValue = trusted(event) ? { apiBaseUrl: `${backend.origin}/api`, clientId: configuration.clientId, version: productVersion } : {};
    });
    ipcMain.handle('desktop:logs', event => { if (trusted(event)) return shell.openPath(path.join(configuration.directory, 'logs')); });
    let rendererBusy = false;
    let resourceSaves = 0;
    let browserDownloads = 0;
    ipcMain.on('desktop:busy', (event, active) => { if (trusted(event)) rendererBusy = active === true; });
    let downloadQueue = Promise.resolve();
    ipcMain.handle('desktop:save-resource', (event, resource) => {
      if (!trusted(event)) throw new Error('不允许的保存请求');
      if (settingsManager?.isActive()) throw new Error('正在管理个人数据，请完成后再下载');
      const task = async () => {
        const url = String(resource?.url || '');
        const parsed = new URL(url);
        if (!['https:', 'http:'].includes(parsed.protocol) && !/^data:image\/[a-z0-9.+-]+;base64,/i.test(url) && !url.startsWith(`blob:${backend.origin}/`)) throw new Error('不支持的资源类型');
        if (url.length > 16 * 1024 * 1024) throw new Error('资源地址过大');
        const filename = path.basename(String(resource?.filename || 'design.png')).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
        const choice = await chooseResourceSavePath({ app, configuration, dialog, window, filename });
        if (choice.canceled) return { canceled: true };
        if (/^data:image\//i.test(url)) {
          try { await fs.promises.writeFile(choice.filePath, Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'), { flag: choice.overwrite ? 'w' : 'wx' }); }
          catch (error) { throw new Error(error.code === 'EEXIST' ? '目标文件已存在，请重新选择文件名或确认替换' : directoryError(error)); }
          return { saved: true };
        }
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => { pendingDownloads.delete(url); expiredDownloads.add(url); reject(new Error('下载启动超时')); }, 30000);
          pendingDownloads.set(url, { path: choice.filePath, resolve, reject, timer });
          try { window.webContents.downloadURL(url); }
          catch (error) { clearTimeout(timer); pendingDownloads.delete(url); reject(error); }
        });
      };
      resourceSaves++;
      const result = downloadQueue.then(task).finally(() => { resourceSaves--; });
      downloadQueue = result.catch(() => {});
      return result;
    });
    const pendingDownloads = new Map();
    const expiredDownloads = new Set();
    desktopSession.on('will-download', async (_event, item) => {
      browserDownloads++;
      item.once('done', () => { browserDownloads--; });
      const expired = [item.getURL(), ...item.getURLChain()].find(url => expiredDownloads.has(url));
      if (expired) { expiredDownloads.delete(expired); item.cancel(); return; }
      const key = [item.getURL(), ...item.getURLChain()].find(url => pendingDownloads.has(url));
      const pending = pendingDownloads.get(key);
      if (pending) {
        pendingDownloads.delete(key); clearTimeout(pending.timer); item.setSavePath(pending.path);
        item.once('done', (_doneEvent, state) => { if (state === 'completed') pending.resolve({ saved: true }); else pending.reject(new Error(state === 'cancelled' ? '下载已取消' : '下载中断，请检查网络、磁盘空间和保存目录权限后重试')); });
        return;
      }
      item.pause();
      try {
        const result = await chooseResourceSavePath({ app, configuration, dialog, window, filename: item.getFilename() });
        if (result.canceled) item.cancel();
        else { item.setSavePath(result.filePath); item.resume(); }
      } catch (error) { item.cancel(); await dialog.showMessageBox(window, { type: 'error', title: '保存文件失败', message: directoryError(error), buttons: ['确定'] }); }
    });
    window = new BrowserWindow({ width: 1280, height: 860, minWidth: 900, minHeight: 650, show: false,
      title: '去水印下载助手 · 个人版', icon: path.join(__dirname, 'assets', 'DesignExtractor-Personal-icon.ico'),
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, session: desktopSession },
    });
    window.on('query-session-end', () => app.quit());
    window.on('close', event => {
      if (settingsManager?.isActive()) {
        event.preventDefault();
        dialog.showMessageBoxSync(window, { type: 'info', title: '请等待数据操作完成', message: '请先完成或取消当前设置、备份、恢复或诊断操作，再关闭应用。', buttons: ['确定'] });
      }
    });
    const external = url => { try { const u = new URL(url); if (['https:', 'http:'].includes(u.protocol) && u.origin !== backend.origin) shell.openExternal(u.href); } catch {} };
    window.webContents.setWindowOpenHandler(({ url }) => { external(url); return { action: 'deny' }; });
    window.webContents.on('will-navigate', (event, url) => { const target = new URL(url); if (target.origin !== backend.origin || target.pathname !== '/') { event.preventDefault(); external(url); } });
    window.webContents.on('will-attach-webview', event => event.preventDefault());
    window.webContents.on('render-process-gone', (_event, details) => { console.error('界面进程退出', details.reason); app.quit(); });
    settingsManager = installSettings({ app, version: productVersion, ipcMain, dialog, shell, window, configuration, backend, trusted,
      isBusy: () => rendererBusy || resourceSaves > 0 || browserDownloads > 0 || quitting });
    installMenus({ app, version: productVersion, Menu, dialog, shell, window, directory: configuration.directory,
      isBusy: () => rendererBusy || resourceSaves > 0 || browserDownloads > 0,
      isMaintenance: () => settingsManager.isActive(), exportDiagnostics: settingsManager.exportDiagnostics, isQuitting: () => quitting,
      reportBug: createFeedback({ version: productVersion, dialog, shell, clipboard, window, errors: recentErrors }) });
    await window.loadURL(backend.origin);
    window.show();
  }).catch(async error => {
    recordError(error, 'browser_start_failed');
    if (configuration) recordBrowserFailure(configuration.directory, error);
    console.error('桌面启动失败', error.message);
    await dialog.showMessageBox({ type: 'error', title: '无法启动去水印下载助手', message: sanitize(error.message), detail: '新旧个人数据均不会自动删除，不会回退 AppData。请检查 personal 目录权限、磁盘空间、资源文件和日志后重试。' });
    app.quit();
  });
  process.on('uncaughtException', error => { console.error('未处理异常', error.message); app.quit(); });
  process.on('unhandledRejection', error => { console.error('未处理异步异常', error?.message || error); app.quit(); });
}
