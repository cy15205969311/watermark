const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { checkDirectory } = require('./download-directory.cjs');

function windowsSid() {
  const output = execFileSync(path.join(process.env.SystemRoot, 'System32/whoami.exe'), ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
  const sid = output.match(/S-1-\d+(?:-\d+)+/)?.[0];
  if (!sid) throw new Error('无法识别 Windows 用户 SID，未初始化个人数据');
  return sid;
}
function ordinaryParents(directory) {
  let current = path.resolve(directory);
  while (true) {
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error('个人数据路径不支持符号链接或目录联接');
    const parent = path.dirname(current); if (parent === current) break; current = parent;
  }
}
function createPaths({ app, execPath = process.execPath, developmentRoot, sid, scope }) {
  const installDirectory = app.isPackaged ? path.dirname(execPath) : null;
  let previousInstall = null;
  if (installDirectory && fs.existsSync(path.join(installDirectory, 'storage-layout.ini'))) {
    const bytes = fs.readFileSync(path.join(installDirectory, 'storage-layout.ini'));
    const ini = bytes.toString(bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf16le' : 'utf8').replace(/^\uFEFF/, '');
    scope ||= /^scope=(user|machine)\s*$/m.exec(ini)?.[1];
    previousInstall = /^previousInstall=(.+)$/m.exec(ini)?.[1]?.trim();
  }
  if (!scope && installDirectory && [process.env.ProgramFiles, process.env.ProgramW6432].filter(Boolean).some(p => path.resolve(installDirectory).toLowerCase().startsWith(path.resolve(p).toLowerCase() + path.sep))) throw new Error('受保护安装目录缺少存储范围登记，请使用新版安装器修复安装，不会回退 AppData');
  scope ||= 'user';
  const personalRoot = app.isPackaged ? path.join(installDirectory, 'personal') : path.join(developmentRoot || path.resolve(__dirname, '../.desktop-build/development'), 'personal');
  if (scope === 'machine') { sid ||= windowsSid(); if (!/^S-1-\d+(?:-\d+)+$/.test(sid)) throw new Error('Windows 用户 SID 无效'); }
  const dataDirectory = scope === 'machine' ? path.join(personalRoot, 'users', sid) : personalRoot;
  return Object.freeze({ installDirectory, personalRoot, dataDirectory, scope, sid: sid || null, previousInstall,
    downloadDirectory: path.join(dataDirectory, 'Downloads'), databaseDirectory: dataDirectory, databasePath: path.join(dataDirectory, 'history.sqlite'),
    configDirectory: dataDirectory, configPath: path.join(dataDirectory, 'config.json'), logsDirectory: path.join(dataDirectory, 'logs'),
    browserProfileDirectory: path.join(dataDirectory, 'browser-profiles'), cacheDirectory: path.join(dataDirectory, 'cache'),
    sessionDirectory: path.join(dataDirectory, 'cache/session'), temporaryDirectory: path.join(dataDirectory, 'temp'),
    browserDownloadDirectory: path.join(dataDirectory, 'temp/browser-downloads'), backupDirectory: path.join(dataDirectory, 'backups') });
}
function secureUserDirectory(paths, existed) {
  // Only a SID-specific child is mutable here. The installer provisions the
  // shared container with create-subdirectory permission, never program writes.
  if (paths.scope !== 'machine') return;
  const script = "$ErrorActionPreference='Stop'; $d=$env:DESIGN_STORAGE_TARGET; $s=$env:DESIGN_STORAGE_SID; $a=[System.IO.Directory]::GetAccessControl($d); $o=$a.GetOwner([System.Security.Principal.SecurityIdentifier]).Value; if ($o -ne $s -and $o -ne 'S-1-5-32-544') { throw 'Unexpected storage owner' }; if ($env:DESIGN_STORAGE_EXISTED -eq 'true') { foreach($r in $a.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier])) { if ($r.AccessControlType -eq 'Allow' -and $r.IdentityReference.Value -notin @($s,'S-1-5-18','S-1-5-32-544')) { throw 'Existing storage is not private' } } }; $n=[System.Security.AccessControl.DirectorySecurity]::new(); $n.SetAccessRuleProtection($true,$false); foreach($p in @(@($s,'Modify'),@('S-1-5-18','FullControl'),@('S-1-5-32-544','FullControl'))) { $id=[System.Security.Principal.SecurityIdentifier]::new($p[0]); $r=[System.Security.AccessControl.FileSystemAccessRule]::new($id,$p[1],'ContainerInherit,ObjectInherit','None','Allow'); $n.AddAccessRule($r) }; [System.IO.Directory]::SetAccessControl($d,$n)";
  try { execFileSync(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, stdio: 'pipe', timeout: 15000, env: { ...process.env, DESIGN_STORAGE_TARGET: paths.dataDirectory, DESIGN_STORAGE_SID: paths.sid, DESIGN_STORAGE_EXISTED: String(existed) } }); }
  catch { throw new Error('无法隔离当前 Windows 用户的数据目录，请修复安装目录权限；不会使用共享数据库或回退 AppData'); }
}
function initializePaths(app, paths) {
  ordinaryParents(paths.dataDirectory);
  try {
    const existed = fs.existsSync(paths.dataDirectory);
    fs.mkdirSync(paths.dataDirectory, { recursive: true }); secureUserDirectory(paths, existed);
    checkDirectory(paths.dataDirectory);
    for (const directory of [paths.cacheDirectory, paths.sessionDirectory, paths.temporaryDirectory, paths.logsDirectory, paths.browserProfileDirectory, paths.backupDirectory]) { ordinaryParents(directory); fs.mkdirSync(directory, { recursive: true }); }
  } catch (error) { throw new Error(`个人数据目录无法写入，请修复安装目录中 personal 的权限，或将软件安装到可写位置。不会回退 AppData。${/^[\u3400-\u9fff]/.test(error.message) ? error.message : ''}`); }
  app.setPath('userData', paths.dataDirectory);
  app.setPath('sessionData', paths.sessionDirectory);
  app.setPath('temp', paths.temporaryDirectory);
  app.setPath('logs', paths.logsDirectory);
  app.setPath('crashDumps', path.join(paths.cacheDirectory, 'crash-dumps'));
  process.env.TEMP = paths.temporaryDirectory; process.env.TMP = paths.temporaryDirectory;
  app.commandLine.appendSwitch('disk-cache-dir', path.join(paths.cacheDirectory, 'http'));
  app.commandLine.appendSwitch('crash-dumps-dir', path.join(paths.cacheDirectory, 'crash-dumps'));
}
module.exports = { createPaths, initializePaths, windowsSid, ordinaryParents };
