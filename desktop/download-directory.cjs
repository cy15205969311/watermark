const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function directoryError(error) {
  if (/^[\u3400-\u9fff]/.test(error.message || '')) return error.message;
  if (['EACCES', 'EPERM', 'EROFS'].includes(error.code)) return '目录无法写入，请检查访问权限或选择其他文件夹';
  if (error.code === 'ENOSPC') return '磁盘空间不足，请清理空间或选择其他文件夹';
  if (['ENOENT', 'ENOTDIR', 'EINVAL'].includes(error.code)) return '保存目录不存在或路径无效，请选择有效的本机文件夹';
  return '无法访问保存目录，请检查磁盘和目录权限';
}

// Probe with an exclusive, disposable file: existence/access() alone does not
// establish write permission under Windows ACLs. Status checks do not mkdir.
function checkDirectory(directory, { create = false, io = fs } = {}) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory) || directory.startsWith('\\\\')) throw new Error('请选择本机磁盘上的完整文件夹路径');
  let probeDirectory = directory;
  if (create) io.mkdirSync(directory, { recursive: true });
  else {
    while (!io.existsSync(probeDirectory)) {
      const parent = path.dirname(probeDirectory);
      if (parent === probeDirectory) throw new Error('保存目录所在磁盘不可用');
      probeDirectory = parent;
    }
  }
  if (!io.statSync(probeDirectory).isDirectory()) throw new Error('保存路径不是文件夹，请选择其他目录');
  const disk = io.statfsSync(probeDirectory);
  if (disk.bavail * disk.bsize < 32 * 1024 * 1024) throw new Error('磁盘空间不足，请清理空间或选择其他文件夹');
  const probe = path.join(probeDirectory, `.designextractor-download-${crypto.randomUUID()}`);
  let created = false;
  try { io.writeFileSync(probe, 'write-check', { flag: 'wx' }); created = true; }
  finally { if (created) io.unlinkSync(probe); }
  return directory;
}

function defaultDownloadDirectory(app, execPath = process.execPath, configuration) {
  return configuration?.paths?.downloadDirectory || path.join(configuration?.directory || app.getPath('userData'), 'Downloads');
}

function resolveDownloadDirectory({ app, configuration, ensure = false, ignoreCustom = false, execPath = process.execPath, io = fs }) {
  const preferred = !ignoreCustom && configuration.downloadDirectory || defaultDownloadDirectory(app, execPath, configuration);
  try {
    checkDirectory(preferred, { create: ensure, io });
    return { directory: preferred, available: true, fallback: false, warning: '' };
  } catch (error) {
    return { directory: preferred, available: false, fallback: false,
      warning: `下载目录不可用（${directoryError(error)}）。不会回退 AppData；请修复权限、恢复默认目录，或在保存对话框中主动选择其他位置。` };
  }
}

async function chooseResourceSavePath({ app, configuration, dialog, window, filename }) {
  const target = resolveDownloadDirectory({ app, configuration, ensure: true });
  if (target.warning) await dialog.showMessageBox(window, { type: 'warning', title: '下载目录不可用', message: target.warning, buttons: ['确定'] });
  const result = await dialog.showSaveDialog(window, { title: '保存设计资源', defaultPath: path.join(target.directory, path.basename(filename)), properties: ['showOverwriteConfirmation'] });
  if (result.canceled) return { canceled: true };
  try {
    if (!result.filePath || !path.isAbsolute(result.filePath)) throw new Error('保存路径无效，请选择完整的文件路径');
    if (!fs.existsSync(path.dirname(result.filePath))) throw new Error('保存目录不存在，请先创建目录或选择其他文件夹');
    checkDirectory(path.dirname(result.filePath));
    const exists = fs.existsSync(result.filePath);
    if (exists) {
      if (!fs.statSync(result.filePath).isFile()) throw new Error('目标不是普通文件，请选择其他文件名');
      const confirm = await dialog.showMessageBox(window, { type: 'warning', title: '文件已存在', message: '所选文件已存在，是否替换？', buttons: ['取消', '替换文件'], defaultId: 0, cancelId: 0, noLink: true });
      if (confirm.response !== 1) return { canceled: true };
    }
    return { filePath: result.filePath, overwrite: exists };
  } catch (error) { throw new Error(directoryError(error)); }
}

module.exports = { defaultDownloadDirectory, resolveDownloadDirectory, checkDirectory, chooseResourceSavePath, directoryError };
