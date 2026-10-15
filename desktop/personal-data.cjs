const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { loadConfiguration } = require('./config.cjs');
const DATA = ['config.json', 'history.sqlite', 'uploads'];
const FORMAT = 'DesignExtractorPersonalBackup';
const reserve = 32 * 1024 * 1024;
function inside(parent, file) { const relative = path.relative(parent, file); return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative); }
function regular(file, directory = false) {
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile())) throw new Error('备份不允许符号链接、目录联接或特殊文件');
  return stat;
}
function hash(file) {
  const digest = crypto.createHash('sha256'); const fd = fs.openSync(file, 'r'); const chunk = Buffer.alloc(1024 * 1024);
  try { let n; while ((n = fs.readSync(fd, chunk, 0, chunk.length, null))) digest.update(chunk.subarray(0, n)); }
  finally { fs.closeSync(fd); }
  return digest.digest('hex');
}
function files(directory, prefix = '') {
  regular(directory, true);
  const result = [];
  for (const name of fs.readdirSync(directory)) {
    const relative = prefix ? `${prefix}/${name}` : name; const file = path.join(directory, name);
    if (fs.lstatSync(file).isDirectory()) result.push(...files(file, relative));
    else { regular(file); result.push(relative); }
    if (result.length > 100000) throw new Error('备份文件数量超过安全限制');
  }
  return result;
}
function writableDirectory(directory, bytes = reserve) {
  if (!path.isAbsolute(directory) || directory.startsWith('\\\\')) throw new Error('请选择本机磁盘上的完整文件夹路径');
  regular(directory, true);
  const disk = fs.statfsSync(directory);
  if (disk.bavail * disk.bsize < bytes) throw new Error('磁盘空间不足，请选择其他目录或清理空间');
  const probe = path.join(directory, `.designextractor-probe-${crypto.randomUUID()}`);
  try { fs.writeFileSync(probe, '', { flag: 'wx' }); }
  catch { throw new Error('目录无法写入，请检查访问权限'); }
  finally { fs.rmSync(probe, { force: true }); }
}
function validateDatabase(file, uploads) {
  regular(file); const db = new DatabaseSync(file, { readOnly: true });
  try {
    if (db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw new Error('备份数据库损坏');
    const version = db.prepare('PRAGMA user_version').get().user_version;
    if (version !== 1) throw new Error('备份数据库版本不兼容，请使用对应版本的应用');
    const columns = db.prepare('PRAGMA table_info(parse_records)').all().map(c => c.name);
    for (const name of ['id', 'original_url', 'client_id', 'pages_json', 'image_urls_json', 'thumbnail_url', 'extraction_metadata_json']) if (!columns.includes(name)) throw new Error('备份数据库结构不完整');
    let count = 0;
    for (const row of db.prepare('SELECT original_url, thumbnail_url, image_urls_json, pages_json, extraction_metadata_json FROM parse_records').iterate()) {
      count++;
      for (const text of Object.values(row)) {
        for (const match of String(text || '').matchAll(/(?:https?:\/\/[^\s"'<>]+)?\/uploads\/([^\s"'<>?#]+)/g)) {
          const name = decodeURIComponent(match[1]).replace(/\\/g, '/'); const upload = path.resolve(uploads, name);
          if (!inside(uploads, upload) || !fs.existsSync(upload)) throw new Error('备份缺少历史记录引用的上传文件');
          regular(upload);
        }
      }
    }
    return { schemaVersion: version, historyCount: count };
  } finally { db.close(); }
}
function validateBackup(directory, applicationVersion) {
  regular(directory, true);
  const manifestFile = path.join(directory, 'manifest.json'); regular(manifestFile);
  if (fs.statSync(manifestFile).size > 32 * 1024 * 1024) throw new Error('备份清单过大');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  if (manifest.format !== FORMAT || manifest.formatVersion !== 1 || !Array.isArray(manifest.files) || !manifest.files.length || manifest.files.length > 100000) throw new Error('不是受支持的个人数据备份');
  const version = v => /^\d+\.\d+\.\d+$/.test(v) ? v.split('.').map(Number) : null;
  const saved = version(manifest.appVersion); const current = version(applicationVersion);
  if (!saved || !current || saved.some((n, i) => n !== current[i] && saved.slice(0, i).every((x, j) => x === current[j]) && n > current[i])) throw new Error('备份来自更高版本，当前应用无法恢复');
  if (!Number.isFinite(Date.parse(manifest.createdAt))) throw new Error('备份时间无效');
  const seen = new Set(); let sizeBytes = 0;
  for (const record of manifest.files) {
    const name = record.path;
    if (typeof name !== 'string' || !/^(config\.json|history\.sqlite|uploads\/.+)$/.test(name) || name.split('/').some(part => !part || part === '.' || part === '..' || /[:\\\x00-\x1f]/.test(part)) || seen.has(name.toLowerCase())) throw new Error('备份包含非法或重复的文件路径');
    seen.add(name.toLowerCase()); const file = path.join(directory, name);
    if (!inside(directory, file)) throw new Error('备份路径超出允许范围');
    // Check every parent too, to reject nested junctions before reading.
    let parent = path.dirname(file); while (parent !== directory) { regular(parent, true); parent = path.dirname(parent); }
    const stat = regular(file);
    if (record.sizeBytes !== stat.size || record.sha256 !== hash(file)) throw new Error('备份文件校验失败，文件可能损坏或被修改');
    sizeBytes += stat.size;
  }
  if (!seen.has('config.json') || !seen.has('history.sqlite')) throw new Error('备份缺少配置或历史数据库');
  const actual = files(directory).filter(name => name !== 'manifest.json').map(name => name.toLowerCase());
  if (actual.length !== seen.size || actual.some(name => !seen.has(name))) throw new Error('备份中存在未校验文件');
  const config = JSON.parse(fs.readFileSync(path.join(directory, 'config.json'), 'utf8'));
  if (config.version !== 1 || typeof config.clientId !== 'string' || !config.clientId) throw new Error('备份历史身份或配置版本无效');
  if (config.downloadDirectory != null && (typeof config.downloadDirectory !== 'string' || !path.isAbsolute(config.downloadDirectory) || config.downloadDirectory.startsWith('\\\\'))) throw new Error('备份中的下载目录配置无效');
  const database = validateDatabase(path.join(directory, 'history.sqlite'), path.join(directory, 'uploads'));
  if (manifest.schemaVersion !== database.schemaVersion || manifest.historyCount !== database.historyCount) throw new Error('备份数据库与清单不一致');
  return { ...manifest, sizeBytes, uploadCount: manifest.files.filter(f => f.path.startsWith('uploads/')).length };
}
function createBackup({ configuration, database, destination, version }) {
  const source = configuration.directory;
  const managedBackups = configuration.backupDirectory || path.join(source, 'backups');
  if (path.resolve(destination) === path.resolve(source) || (inside(source, destination) && path.resolve(destination) !== path.resolve(managedBackups) && !inside(managedBackups, destination))) throw new Error('备份位置只能位于专用 backups 目录或个人数据目录外');
  const uploadRoot = path.join(source, 'uploads');
  const uploadFiles = fs.existsSync(uploadRoot) ? files(uploadRoot) : [];
  const sourceBytes = uploadFiles.reduce((n, f) => n + fs.statSync(path.join(uploadRoot, f)).size, 0) + fs.statSync(configuration.databasePath).size
    + (fs.existsSync(configuration.databasePath + '-wal') ? regular(configuration.databasePath + '-wal').size : 0);
  writableDirectory(destination, sourceBytes * 2 + reserve);
  const id = new Date().toISOString().replace(/[:.]/g, '-') + '-' + crypto.randomBytes(4).toString('hex');
  const staging = path.join(destination, `.designextractor-${id}.tmp`);
  const final = path.join(destination, `DesignExtractor-${id}.dexp-backup`);
  fs.mkdirSync(staging);
  try {
    fs.mkdirSync(path.join(staging, 'uploads'));
    database.snapshot(path.join(staging, 'history.sqlite'));
    regular(path.join(source, 'config.json')); fs.copyFileSync(path.join(source, 'config.json'), path.join(staging, 'config.json'));
    for (const name of uploadFiles) { const output = path.join(staging, 'uploads', name); fs.mkdirSync(path.dirname(output), { recursive: true }); fs.copyFileSync(path.join(uploadRoot, name), output); }
    const contents = files(staging).map(name => ({ path: name, sizeBytes: fs.statSync(path.join(staging, name)).size, sha256: hash(path.join(staging, name)) }));
    const databaseInfo = validateDatabase(path.join(staging, 'history.sqlite'), path.join(staging, 'uploads'));
    fs.writeFileSync(path.join(staging, 'manifest.json'), JSON.stringify({ format: FORMAT, formatVersion: 1, appVersion: version, createdAt: new Date().toISOString(), ...databaseInfo, files: contents }, null, 2), { flag: 'wx' });
    validateBackup(staging, version);
    fs.renameSync(staging, final); return final;
  } catch (error) { fs.rmSync(staging, { recursive: true, force: true }); throw error; }
}
function journalWrite(directory, record) {
  const target = path.join(directory, '.restore-journal.json'); const temp = target + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(record)); const fd = fs.openSync(temp, 'r+'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temp, target);
}
function recoverInterruptedRestore(directory) {
  const file = path.join(directory, '.restore-journal.json'); if (!fs.existsSync(file)) return false;
  regular(file); const record = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!/^restore-[a-f0-9-]{36}$/.test(record.id) || !Array.isArray(record.original) || record.original.some(n => !DATA.includes(n))) throw new Error('恢复日志无效，请保留数据并联系维护者');
  regular(directory, true); regular(path.join(directory, 'temp'), true);
  const operation = path.join(directory, 'temp', record.id); regular(operation, true); regular(path.join(operation, 'previous'), true);
  // No connection is open here (startup recovery or explicit database.end).
  // Never let a newer database's WAL be replayed into the rolled-back file.
  for (const suffix of ['-wal', '-shm']) {
    const sidecar = path.join(directory, 'history.sqlite' + suffix);
    if (fs.existsSync(sidecar)) { regular(sidecar); fs.unlinkSync(sidecar); }
  }
  for (const name of DATA) {
    const previous = path.join(operation, 'previous', name); const live = path.join(directory, name);
    if (fs.existsSync(previous)) {
      regular(previous, name === 'uploads');
      if (fs.existsSync(live)) { regular(live, name === 'uploads'); fs.rmSync(live, { recursive: name === 'uploads', force: true }); }
      fs.renameSync(previous, live);
    } else if (!record.original.includes(name) && fs.existsSync(live)) { regular(live, name === 'uploads'); fs.rmSync(live, { recursive: name === 'uploads', force: true }); }
  }
  fs.unlinkSync(file); return true; // Preserve operation directory for diagnosis.
}
async function restoreBackup({ configuration, database, backup, version, fault = () => {} }) {
  const manifest = validateBackup(backup, version);
  const directory = configuration.directory;
  regular(directory, true); regular(configuration.temporaryDirectory, true);
  const rollbackDirectory = path.join(configuration.backupDirectory || path.join(directory, 'backups'), 'rollback'); fs.mkdirSync(rollbackDirectory, { recursive: true });
  writableDirectory(directory, manifest.sizeBytes * 2 + reserve);
  const rollback = createBackup({ configuration, database, destination: rollbackDirectory, version });
  const id = `restore-${crypto.randomUUID()}`; const operation = path.join(configuration.temporaryDirectory, id);
  fs.mkdirSync(operation); fs.mkdirSync(path.join(operation, 'previous'));
  const incoming = path.join(operation, 'incoming'); fs.mkdirSync(incoming); fs.mkdirSync(path.join(incoming, 'uploads'));
  for (const record of manifest.files) { const target = path.join(incoming, record.path); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(path.join(backup, record.path), target); }
  fs.copyFileSync(path.join(backup, 'manifest.json'), path.join(incoming, 'manifest.json')); validateBackup(incoming, version);
  await database.end();
  try {
    const record = { id, original: DATA.filter(name => fs.existsSync(path.join(directory, name))) }; journalWrite(directory, record);
    for (const name of DATA) {
      const live = path.join(directory, name); if (fs.existsSync(live)) { regular(live, name === 'uploads'); fs.renameSync(live, path.join(operation, 'previous', name)); }
      fs.renameSync(path.join(incoming, name), live); fault(name);
    }
    database.reopen();
    const restored = loadConfiguration(path.dirname(directory), configuration.paths); Object.assign(configuration, restored);
    fs.unlinkSync(path.join(directory, '.restore-journal.json'));
  } catch (error) {
    await database.end().catch(() => {});
    recoverInterruptedRestore(directory); database.reopen();
    Object.assign(configuration, loadConfiguration(path.dirname(directory), configuration.paths));
    throw new Error(`恢复未完成，已回滚原数据：${error.message}`, { cause: error });
  }
  // Cleanup failure after commit must never be reported as a rolled-back
  // restore. The durable rollback backup remains outside the operation folder.
  try { fs.rmSync(operation, { recursive: true, force: true }); }
  catch { console.warn('恢复已完成，暂存目录暂时无法清理；可在退出后重试'); }
  return { restored: true, rollback, historyCount: manifest.historyCount };
}
module.exports = { createBackup, validateBackup, restoreBackup, recoverInterruptedRestore, writableDirectory, hash, validateDatabase, files, regular };
