const fs = require('node:fs');
const path = require('node:path');
const { loadConfiguration, saveDownloadDirectory } = require('./config.cjs');
const { createBackup, validateBackup, restoreBackup, writableDirectory } = require('./personal-data.cjs');
const { diagnostics, recordError, recentErrors, exportDiagnostics, lastBrowserFailure } = require('./diagnostics.cjs');
const { resolveDownloadDirectory, directoryError } = require('./download-directory.cjs');
function installSettings({ app, version = app.getVersion(), ipcMain, dialog, shell, window, configuration, backend, trusted, isBusy }) {
  let active = false; const operations = [];
  const status = () => ({ ...backend.status(), resourceSaves: isBusy() ? 1 : 0, maintenance: active });
  const settings = () => {
    const download = resolveDownloadDirectory({ app, configuration });
    return { version, mode: '桌面个人版 · SQLite', dataDirectory: configuration.directory,
      installDirectory: configuration.paths?.installDirectory, storageScope: configuration.paths?.scope,
      databasePath: configuration.databasePath, browserProfileDirectory: configuration.browserProfileDirectory,
      cacheDirectory: configuration.paths?.cacheDirectory, backupDirectory: configuration.backupDirectory,
      downloadDirectory: download.directory, downloadWarning: download.warning, downloadAvailable: download.available,
      logsDirectory: path.join(configuration.directory, 'logs'), ...status(), recentBrowserFailure: lastBrowserFailure(configuration.directory) };
  };
  const run = async (type, action) => {
    if (active || isBusy()) throw new Error('任务正在进行，请完成提取和下载后再操作');
    active = true; const started = Date.now(); let result = 'failed';
    try { const value = await action(); result = value?.canceled ? 'canceled' : 'success'; return value; }
    catch (error) { recordError(error, `${type}_failed`); throw error; }
    finally { operations.push({ type, result, at: new Date().toISOString(), durationMs: Date.now() - started }); if (operations.length > 20) operations.shift(); active = false; }
  };
  const freeze = async action => {
    if (isBusy()) throw new Error('任务正在进行，请稍后再管理数据');
    backend.pause();
    try { return await action(); } finally { backend.resume(); }
  };
  const chooseDownload = reset => run('settings', async () => {
    if (reset) {
      const target = resolveDownloadDirectory({ app, configuration, ensure: true, ignoreCustom: true });
      if (!target.available) throw new Error(target.warning);
      saveDownloadDirectory(configuration, null); return settings();
    }
    const result = await dialog.showOpenDialog(window, { title: '选择下载保存文件夹', defaultPath: resolveDownloadDirectory({ app, configuration }).directory, properties: ['openDirectory', 'createDirectory'] });
    if (result.canceled) return { canceled: true };
    const directory = result.filePaths[0];
    try { writableDirectory(directory); } catch (error) { throw new Error(directoryError(error)); }
    saveDownloadDirectory(configuration, directory); return settings();
  });
  const openDownload = () => run('settings', async () => {
    const target = resolveDownloadDirectory({ app, configuration, ensure: true });
    if (!target.available) throw new Error(target.warning);
    const error = await shell.openPath(target.directory);
    if (error) throw new Error('无法打开下载文件夹，请检查目录是否可访问');
    return { opened: true };
  });
  const backup = () => run('backup', async () => {
    fs.mkdirSync(configuration.backupDirectory, { recursive: true });
    const choice = await dialog.showOpenDialog(window, { title: '选择备份存放文件夹（将创建独立备份目录）', defaultPath: configuration.backupDirectory, properties: ['openDirectory', 'createDirectory'] });
    if (choice.canceled) return { canceled: true };
    return freeze(() => ({ saved: true, directory: createBackup({ configuration, database: backend.database, destination: choice.filePaths[0], version }) }));
  });
  const restore = () => run('restore', async () => {
    const choice = await dialog.showOpenDialog(window, { title: '选择 .dexp-backup 备份文件夹', properties: ['openDirectory'] });
    if (choice.canceled) return { canceled: true };
    const backup = choice.filePaths[0]; const preview = validateBackup(backup, version);
    const confirm = await dialog.showMessageBox(window, { type: 'warning', title: '确认恢复个人数据',
      message: `备份时间：${new Date(preview.createdAt).toLocaleString('zh-CN')}\n历史记录：${preview.historyCount} 条；上传文件：${preview.uploadCount} 个`,
      detail: '恢复将替换当前历史数据库、上传文件和个人配置（包括历史身份及下载目录）。会先自动创建当前状态的回滚备份。日志与已有备份保留。完成后界面将重新加载。',
      buttons: ['取消', '创建回滚备份并恢复'], defaultId: 0, cancelId: 0, noLink: true });
    if (confirm.response !== 1) return { canceled: true };
    const result = await freeze(() => restoreBackup({ configuration, database: backend.database, backup, version }));
    // Configuration object identity is shared by connection IPC and download flow.
    Object.assign(configuration, loadConfiguration(app.getPath('userData'), configuration.paths));
    setTimeout(() => window.webContents.reload(), 150);
    return result;
  });
  const diagnostic = () => run('diagnostics', async () => {
    const preview = await dialog.showMessageBox(window, { type: 'info', title: '导出诊断信息', message: '将导出版本、系统与架构、随包浏览器状态、SQLite 状态、任务耗时和近期操作结果。',
      detail: '不包含图片、历史资源 URL、Token、Cookie、密码、原始日志和个人文件夹完整路径。仅保存到本机，不上传。', buttons: ['取消', '选择保存位置'], defaultId: 0, cancelId: 0 });
    if (preview.response !== 1) return { canceled: true };
    const choice = await dialog.showSaveDialog(window, { title: '保存诊断信息', defaultPath: path.join(resolveDownloadDirectory({ app, configuration, ensure: true }).directory, `DesignExtractor-diagnostics-${Date.now()}.json`), filters: [{ name: '诊断 JSON', extensions: ['json'] }] });
    if (choice.canceled) return { canceled: true };
    writableDirectory(path.dirname(choice.filePath));
    if (fs.existsSync(choice.filePath)) throw new Error('该诊断文件已存在，请使用新文件名');
    exportDiagnostics(choice.filePath, diagnostics({ version, status: status(), operations, errors: recentErrors })); return { saved: true };
  });
  for (const [name, action] of Object.entries({ status: settings, 'choose-download': () => chooseDownload(false), 'reset-download': () => chooseDownload(true), 'open-download': openDownload, backup, restore, diagnostics: diagnostic })) {
    ipcMain.handle(`desktop:${name}`, async event => {
      if (!trusted(event)) throw new Error('不允许的桌面设置请求');
      try { return await action(); }
      catch (error) { return { error: safeError(error) }; }
    });
  }
  function safeError(error) {
    const message = String(error.message || '');
    // Only own Chinese validation messages reach the UI; native errors can
    // contain personal paths, URLs or tokens.
    return /^[\u3400-\u9fff]/.test(message) ? message.replace(/[A-Z]:\\[^\s]+|https?:\/\/[^\s]+/gi, '[已隐藏路径]') : '操作失败，请检查备份完整性、磁盘空间和目录权限；可导出诊断信息排查';
  }
  return { isActive: () => active, exportDiagnostics: async () => { try { await diagnostic(); } catch (error) { await dialog.showMessageBox(window, { type: 'error', title: '诊断导出失败', message: safeError(error) }); } } };
}
module.exports = { installSettings };
