const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync, backup } = require('node:sqlite');
const { files, regular, hash, validateDatabase, writableDirectory } = require('./personal-data.cjs');
const { ordinaryParents } = require('./paths.cjs');
const CONTENT = ['config.json', 'history.sqlite', 'uploads', 'logs', 'Downloads', 'backups', 'rollback-backups', 'browser-status.json'];
const MARKER = '.storage-layout.json';
const JOURNAL = '.migration-journal.json';
function readObject(file) {
  regular(file);
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { throw new Error('个人数据配置或迁移日志损坏，请先备份再修复；未显示文件内容'); }
}
function initialized(directory) { return fs.existsSync(path.join(directory, 'config.json')) || fs.existsSync(path.join(directory, 'history.sqlite')); }
function writeAtomic(file, value) {
  const temporary = file + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2));
  const fd = fs.openSync(temporary, 'r+'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temporary, file);
}
function inventory(source) {
  ordinaryParents(source); regular(source, true);
  const result = [];
  for (const name of [...CONTENT, 'history.sqlite-wal']) {
    const file = path.join(source, name); if (!fs.existsSync(file)) continue;
    regular(file, fs.lstatSync(file).isDirectory());
    // Opening a checkpointed WAL-mode database read-only may create an empty
    // WAL/SHM pair. An empty WAL has no transactions and is not a data change.
    if (name === 'history.sqlite-wal' && fs.statSync(file).size === 0) continue;
    for (const relative of fs.statSync(file).isDirectory() ? files(file).map(p => `${name}/${p}`) : [name]) {
      const input = path.join(source, relative); result.push({ path: relative, size: fs.statSync(input).size, sha256: hash(input) });
    }
  }
  return result;
}
function recoverMigration(directory) {
  const journal = path.join(directory, JOURNAL); if (!fs.existsSync(journal)) return false;
  const record = readObject(journal);
  if (!/^migration-[a-f0-9-]{36}$/.test(record.id) || !Array.isArray(record.names) || record.names.some(n => !CONTENT.includes(n))) throw new Error('迁移日志无效，请保留个人数据并联系维护者');
  const stage = path.join(directory, 'temp', record.id); ordinaryParents(stage); regular(stage, true);
  if (!fs.existsSync(path.join(directory, MARKER))) {
    // No previous live entries were overwritten. Return committed entries to
    // this operation's staging folder; never delete old or unrelated data.
    for (const name of record.names) {
      const live = path.join(directory, name), staged = path.join(stage, name);
      if (fs.existsSync(live)) {
        if (fs.existsSync(staged)) throw new Error('迁移回滚存在文件冲突，请保留新旧目录并联系维护者');
        regular(live, fs.lstatSync(live).isDirectory()); fs.renameSync(live, staged);
      }
    }
  }
  fs.unlinkSync(journal); // Retain staged files for manual recovery/diagnosis.
  return true;
}
function migrationFiles(source, additional = []) {
  const entries = inventory(source).map(r => ({ ...r, input: path.join(source, r.path) }));
  for (const item of additional) {
    ordinaryParents(item.directory); regular(item.directory, true);
    for (const name of files(item.directory)) {
      const input = path.join(item.directory, name), relative = `${item.name}/${name}`;
      entries.push({ input, path: relative, size: fs.statSync(input).size, sha256: hash(input) });
    }
  }
  const seen = new Map();
  for (const entry of entries) {
    const key = entry.path.toLowerCase();
    if (seen.has(key) && seen.get(key) !== entry.sha256) throw new Error('旧下载或备份存在同名不同内容的文件，未自动合并；请先整理冲突文件');
    seen.set(key, entry.sha256);
  }
  return entries;
}
async function migrateData({ source, paths, additional = [], fault = () => {} }) {
  const target = paths.dataDirectory;
  if (initialized(target)) throw new Error('新目录已有数据库或配置，禁止覆盖；请先确认应使用哪份个人数据');
  if (path.resolve(source).toLowerCase() === path.resolve(target).toLowerCase()) throw new Error('迁移源与目标相同');
  const known = new Set([...CONTENT, 'history.sqlite-wal', 'history.sqlite-shm', 'temp', 'cache', 'browser-profiles', MARKER]);
  if (fs.readdirSync(source).some(name => !known.has(name))) throw new Error('旧目录存在未识别的数据文件或未完成的恢复日志，请先在旧版本检查并备份；未迁移或删除任何旧文件');
  const before = migrationFiles(source, additional);
  if (!before.some(f => f.path === 'config.json') || !before.some(f => f.path === 'history.sqlite')) throw new Error('旧目录缺少配置或数据库，请从完整备份恢复');
  const config = readObject(path.join(source, 'config.json'));
  if (config.version !== 1 || typeof config.clientId !== 'string' || !config.clientId) throw new Error('旧配置或历史身份无效，未修改旧数据');
  if (config.downloadDirectory != null && (typeof config.downloadDirectory !== 'string' || !path.isAbsolute(config.downloadDirectory) || config.downloadDirectory.startsWith('\\\\'))) throw new Error('旧下载目录配置无效，请先修复配置；未修改旧数据');
  writableDirectory(target, before.reduce((n, f) => n + f.size, 0) * 2 + 32 * 1024 * 1024);
  const id = `migration-${crypto.randomUUID()}`, stage = path.join(paths.temporaryDirectory, id);
  fs.mkdirSync(stage);
  let journaled = false;
  try {
    const db = new DatabaseSync(path.join(source, 'history.sqlite'), { readOnly: true });
    try { await backup(db, path.join(stage, 'history.sqlite')); } finally { db.close(); }
    for (const item of before.filter(f => !/^history\.sqlite(?:-wal)?$/.test(f.path))) {
      const to = path.join(stage, item.path); fs.mkdirSync(path.dirname(to), { recursive: true });
      if (!fs.existsSync(to)) fs.copyFileSync(item.input, to, fs.constants.COPYFILE_EXCL);
      if (hash(to) !== item.sha256) throw new Error('旧数据在迁移期间发生变化，请关闭旧版本后重试');
    }
    fs.mkdirSync(path.join(stage, 'uploads'), { recursive: true });
    const database = validateDatabase(path.join(stage, 'history.sqlite'), path.join(stage, 'uploads'));
    if (JSON.stringify(before) !== JSON.stringify(migrationFiles(source, additional))) throw new Error('旧数据在迁移期间发生变化，请关闭旧版本后重试');
    // A previously selected external download location remains intentional.
    // Only an old managed Downloads path follows the moved personal root.
    const oldManagedDownloads = [path.join(source, 'Downloads'), ...additional.filter(item => item.name === 'Downloads').map(item => item.directory)];
    if (config.downloadDirectory && oldManagedDownloads.some(p => path.resolve(config.downloadDirectory).toLowerCase() === path.resolve(p).toLowerCase())) {
      config.downloadDirectory = null;
      fs.writeFileSync(path.join(stage, 'config.json'), JSON.stringify(config, null, 2));
    }
    const names = CONTENT.filter(n => fs.existsSync(path.join(stage, n)));
    for (const name of names) {
      const live = path.join(target, name);
      if (fs.existsSync(live) && (!fs.statSync(live).isDirectory() || fs.readdirSync(live).length)) throw new Error('目标目录已有个人文件，未覆盖；请手动确认迁移冲突');
    }
    // Empty bootstrap folders are safe to replace; journal before committing.
    for (const name of names) if (fs.existsSync(path.join(target, name))) fs.rmdirSync(path.join(target, name));
    writeAtomic(path.join(target, JOURNAL), { id, names }); journaled = true;
    for (const name of names) { fs.renameSync(path.join(stage, name), path.join(target, name)); fault(name); }
    validateDatabase(paths.databasePath, path.join(target, 'uploads'));
    writeAtomic(path.join(target, MARKER), { version: 1, kind: 'migrated', at: new Date().toISOString(), source, ...database });
    fs.unlinkSync(path.join(target, JOURNAL)); journaled = false;
    fs.rmSync(stage, { recursive: true, force: true });
    return database;
  } catch (error) {
    if (journaled) recoverMigration(target);
    // Keep operation staging and the untouched source for recovery.
    throw new Error(`个人数据迁移未完成；旧目录保留，未回退 AppData。${/^[\u3400-\u9fff]/.test(error.message) ? error.message : '请关闭旧版本并检查数据库、空间及权限后重试。'}`, { cause: error });
  }
}
async function prepareStorage({ paths, legacyDirectory, dialog }) {
  const target = paths.dataDirectory;
  recoverMigration(target);
  if (fs.existsSync(path.join(target, MARKER))) {
    const marker = readObject(path.join(target, MARKER));
    if (marker.version !== 1) throw new Error('个人数据路径标记损坏，请先备份再修复');
    return;
  }
  const previous = paths.previousInstall && path.join(paths.previousInstall, 'personal', ...(paths.scope === 'machine' ? ['users', paths.sid] : []));
  const candidates = [...new Set([previous, legacyDirectory].filter(Boolean).map(p => path.resolve(p)))].filter(p => p.toLowerCase() !== path.resolve(target).toLowerCase() && initialized(p));
  if (initialized(target)) {
    if (candidates.length) {
      const answer = await dialog.showMessageBox({ type: 'warning', title: '检测到多份个人数据', message: '安装目录已有个人数据，同时发现旧目录数据。不会合并或覆盖。', detail: `当前数据：${target}\n旧数据：${candidates.join('\n')}\n继续将明确使用当前安装目录数据；旧目录保留，之后可通过备份恢复。`, buttons: ['退出并检查', '使用当前目录数据'], defaultId: 0, cancelId: 0 });
      if (answer.response !== 1) throw new Error('已取消启动，未修改新旧个人数据');
    }
    writeAtomic(path.join(target, MARKER), { version: 1, kind: 'existing', at: new Date().toISOString() }); return;
  }
  if (candidates.length) {
    const answer = await dialog.showMessageBox({ type: 'question', title: '迁移旧版个人数据', message: '发现旧版历史数据，请先关闭旧版本。迁移会验证数据库与上传文件，原目录保留作为备份。', detail: `目标：${target}\n${candidates.map((p, i) => `${i + 1}：${p}`).join('\n')}\n多份来源不会自动合并，请选择要迁移的一份。`, buttons: ['退出', ...candidates.map((_, i) => `迁移来源 ${i + 1}`)], defaultId: 0, cancelId: 0, noLink: true });
    if (answer.response < 1 || answer.response > candidates.length) throw new Error('已取消迁移，旧数据保留；未启动空白数据库');
    const source = candidates[answer.response - 1];
    // Old versions used these application-managed siblings. Never sweep the
    // Windows Downloads folder or a user-selected external directory.
    const additional = [];
    const legacySiblings = path.resolve(source).toLowerCase() === path.resolve(legacyDirectory).toLowerCase();
    const extras = [
      ...(legacySiblings ? [{ name: 'Downloads', directory: path.join(path.dirname(source), 'Downloads') }, { name: 'rollback-backups', directory: path.join(path.dirname(source), 'rollback-backups') }] : []),
      ...(paths.scope === 'user' ? [paths.previousInstall, paths.installDirectory].filter(Boolean).map(p => ({ name: 'Downloads', directory: path.join(p, 'Downloads') })) : []),
    ];
    for (const item of extras) if (fs.existsSync(item.directory) && !additional.some(x => path.resolve(x.directory).toLowerCase() === path.resolve(item.directory).toLowerCase())) additional.push(item);
    await migrateData({ source, paths, additional });
  } else writeAtomic(path.join(target, MARKER), { version: 1, kind: 'new', at: new Date().toISOString() });
}
module.exports = { prepareStorage, migrateData, recoverMigration, inventory };
