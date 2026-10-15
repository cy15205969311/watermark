const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createPaths, initializePaths, windowsSid } = require('../paths.cjs');
const { loadConfiguration } = require('../config.cjs');
const { migrateData, prepareStorage, inventory, recoverMigration } = require('../storage-migration.cjs');
const { createDatabase } = require('../../server/database/sqlite');
const { validateDatabase } = require('../personal-data.cjs');
const { createFeedback, feedbackText, EMAIL } = require('../feedback.cjs');
function fixture(t) {
  const root = fs.mkdtempSync(path.resolve(__dirname, '../../.desktop-build/storage-test-'));
  const saved = { TEMP: process.env.TEMP, TMP: process.env.TMP };
  const closers = [];
  t.after(async () => { for (const close of closers) await close(); Object.assign(process.env, saved); fs.rmSync(root, { recursive: true, force: true }); });
  const selected = {}, switches = {};
  const app = { isPackaged: true, setPath: (n, p) => { selected[n] = p; }, commandLine: { appendSwitch: (n, p) => { switches[n] = p; } } };
  const paths = createPaths({ app, execPath: path.join(root, '安装 中文 space', 'application.exe') });
  initializePaths(app, paths);
  return { root, app, paths, selected, switches, closers };
}
async function legacy(f) {
  const configuration = loadConfiguration(path.join(f.root, 'legacy-appdata'));
  const db = createDatabase(configuration.databasePath); f.closers.push(() => db.end());
  fs.mkdirSync(path.join(configuration.directory, 'uploads'));
  fs.writeFileSync(path.join(configuration.directory, 'uploads/原始.gif'), 'GIF89a-original');
  await db.query('INSERT INTO parse_records (original_url, client_id, image_urls_json) VALUES (?, ?, ?)', ['https://example.invalid/test', configuration.clientId, '["/uploads/原始.gif"]']);
  fs.mkdirSync(path.join(configuration.directory, 'logs')); fs.writeFileSync(path.join(configuration.directory, 'logs/old.log'), 'old log');
  fs.mkdirSync(path.join(configuration.directory, 'Downloads')); fs.writeFileSync(path.join(configuration.directory, 'Downloads/原始.gif'), 'GIF89a-original');
  return { configuration, db };
}
test('Actual EXE personal root owns all Electron paths, with no AppData fallback; dev is isolated', t => {
  const f = fixture(t);
  assert.equal(f.paths.dataDirectory, path.join(f.root, '安装 中文 space/personal'));
  for (const name of ['userData', 'sessionData', 'temp', 'logs', 'crashDumps']) assert.ok(f.selected[name].startsWith(f.paths.dataDirectory));
  assert.equal(process.env.TEMP, f.paths.temporaryDirectory);
  assert.ok(Object.values(f.switches).every(p => p.startsWith(f.paths.dataDirectory)));
  const dev = createPaths({ app: { isPackaged: false }, developmentRoot: path.join(f.root, 'dev') });
  assert.equal(dev.installDirectory, null); assert.equal(dev.dataDirectory, path.join(f.root, 'dev/personal'));
  fs.writeFileSync(path.join(f.root, 'not-folder'), 'x');
  assert.throws(() => initializePaths(f.app, { ...f.paths, dataDirectory: path.join(f.root, 'not-folder/personal') }), /不会回退 AppData/);
});
test('Scope metadata supports Unicode INI and distinct SID roots', t => {
  const f = fixture(t); fs.writeFileSync(path.join(f.paths.installDirectory, 'storage-layout.ini'), '\ufeff[storage]\r\nscope=machine\r\npreviousInstall=E:\\旧 安装\r\n', 'utf16le');
  const a = createPaths({ app: f.app, execPath: path.join(f.paths.installDirectory, 'app.exe'), sid: 'S-1-5-21-111' });
  const b = createPaths({ app: f.app, execPath: path.join(f.paths.installDirectory, 'app.exe'), sid: 'S-1-5-21-222' });
  assert.equal(a.scope, 'machine'); assert.equal(a.previousInstall, 'E:\\旧 安装'); assert.notEqual(a.databasePath, b.databasePath);
  assert.ok(a.dataDirectory.endsWith(path.join('personal/users/S-1-5-21-111')));
});
test('Real Windows SID folder ACL setup permits current user and rejects unexpected owner', { skip: process.platform !== 'win32' }, t => {
  const f = fixture(t), sid = windowsSid();
  const paths = createPaths({ app: f.app, execPath: path.join(f.root, 'machine/app.exe'), scope: 'machine', sid });
  initializePaths(f.app, paths); fs.writeFileSync(path.join(paths.dataDirectory, 'test'), 'private');
  initializePaths(f.app, paths); // idempotent on next launch
  const other = createPaths({ app: f.app, execPath: path.join(f.root, 'machine/app.exe'), scope: 'machine', sid: 'S-1-5-21-111-222-333-9999' });
  assert.throws(() => initializePaths(f.app, other), /无法写入/);
});
test('Migration snapshots a live WAL consistently; preserves identity, uploads, downloads, logs and source', async t => {
  const f = fixture(t), { configuration, db } = await legacy(f); t.after(() => db.end());
  const source = configuration.directory, before = inventory(source);
  assert.ok(fs.existsSync(configuration.databasePath + '-wal'));
  await migrateData({ source, paths: f.paths });
  assert.deepEqual(inventory(source), before);
  assert.equal(validateDatabase(f.paths.databasePath, path.join(f.paths.dataDirectory, 'uploads')).historyCount, 1);
  assert.equal(loadConfiguration(null, f.paths).clientId, configuration.clientId);
  for (const p of ['uploads/原始.gif', 'Downloads/原始.gif', 'logs/old.log']) assert.deepEqual(fs.readFileSync(path.join(source, p)), fs.readFileSync(path.join(f.paths.dataDirectory, p)));
  await prepareStorage({ paths: f.paths, legacyDirectory: source, dialog: { showMessageBox: () => { throw new Error('must not migrate twice'); } } });
});
test('Canceled migration never initializes a blank identity; existing target requires explicit choice', async t => {
  const f = fixture(t), { configuration, db } = await legacy(f); t.after(() => db.end());
  await assert.rejects(prepareStorage({ paths: f.paths, legacyDirectory: configuration.directory, dialog: { showMessageBox: async () => ({ response: 0 }) } }), /已取消迁移/);
  assert.equal(fs.existsSync(f.paths.configPath), false);
  const target = loadConfiguration(null, f.paths); const before = fs.readFileSync(f.paths.configPath);
  await assert.rejects(migrateData({ source: configuration.directory, paths: f.paths }), /禁止覆盖/);
  await assert.rejects(prepareStorage({ paths: f.paths, legacyDirectory: configuration.directory, dialog: { showMessageBox: async () => ({ response: 0 }) } }), /已取消启动/);
  assert.deepEqual(fs.readFileSync(f.paths.configPath), before); assert.notEqual(target.clientId, configuration.clientId);
});
test('Closed old database migrates through confirmed startup selection and is not selected again', async t => {
  const f = fixture(t), { configuration, db } = await legacy(f); await db.end();
  const before = inventory(configuration.directory);
  await prepareStorage({ paths: f.paths, legacyDirectory: configuration.directory, dialog: { showMessageBox: async () => ({ response: 1 }) } });
  assert.equal(validateDatabase(f.paths.databasePath, path.join(f.paths.dataDirectory, 'uploads')).historyCount, 1);
  assert.deepEqual(inventory(configuration.directory), before);
});
test('Commit failure rolls back only this migration; retry succeeds with old data unchanged', async t => {
  const f = fixture(t), { configuration, db } = await legacy(f); t.after(() => db.end());
  const source = configuration.directory, before = inventory(source);
  await assert.rejects(migrateData({ source, paths: f.paths, fault: () => { throw new Error('injected commit failure'); } }), /迁移未完成/);
  assert.equal(fs.existsSync(f.paths.databasePath), false); assert.equal(fs.existsSync(f.paths.configPath), false);
  assert.deepEqual(inventory(source), before); assert.equal(recoverMigration(f.paths.dataDirectory), false);
  await migrateData({ source, paths: f.paths });
  assert.equal(validateDatabase(f.paths.databasePath, path.join(f.paths.dataDirectory, 'uploads')).historyCount, 1);
});
test('Missing referenced uploads and junctions reject migration without modifying source or initialized target', async t => {
  const f = fixture(t), { configuration, db } = await legacy(f); t.after(() => db.end());
  fs.unlinkSync(path.join(configuration.directory, 'uploads/原始.gif'));
  await assert.rejects(migrateData({ source: configuration.directory, paths: f.paths }), /缺少历史记录引用/);
  assert.equal(fs.existsSync(f.paths.databasePath), false);
  fs.symlinkSync(f.root, path.join(configuration.directory, 'uploads/escape'), 'junction');
  await assert.rejects(migrateData({ source: configuration.directory, paths: f.paths }), /符号链接|联接/);
});
test('Managed sibling downloads migrate without sweeping custom folders; collisions are rejected', async t => {
  const f = fixture(t), { configuration, db } = await legacy(f); t.after(() => db.end());
  const sibling = path.join(f.root, 'old-managed-downloads'); fs.mkdirSync(sibling);
  fs.writeFileSync(path.join(sibling, 'extra.gif'), 'GIF89a-extra');
  require('../config.cjs').saveDownloadDirectory(configuration, sibling);
  const additional = [{ name: 'Downloads', directory: sibling }];
  fs.writeFileSync(path.join(sibling, '原始.gif'), 'different file');
  await assert.rejects(migrateData({ source: configuration.directory, paths: f.paths, additional }), /同名不同内容/);
  fs.unlinkSync(path.join(sibling, '原始.gif'));
  await migrateData({ source: configuration.directory, paths: f.paths, additional });
  assert.equal(fs.readFileSync(path.join(f.paths.downloadDirectory, 'extra.gif'), 'utf8'), 'GIF89a-extra');
  assert.ok(fs.existsSync(path.join(sibling, 'extra.gif')));
  assert.equal(loadConfiguration(null, f.paths).downloadDirectory, null);
});
test('Space shortage and source changes abort before commit; source data and target identity stay intact', async t => {
  const f = fixture(t), { configuration, db } = await legacy(f); t.after(() => db.end());
  const statfs = fs.statfsSync;
  try {
    fs.statfsSync = () => ({ bavail: 0, bsize: 4096 });
    await assert.rejects(migrateData({ source: configuration.directory, paths: f.paths }), /磁盘空间不足/);
  } finally { fs.statfsSync = statfs; }
  const copy = fs.copyFileSync;
  try {
    fs.copyFileSync = (from, to, ...args) => {
      copy(from, to, ...args);
      if (path.basename(from) === 'config.json') fs.appendFileSync(from, ' ');
    };
    await assert.rejects(migrateData({ source: configuration.directory, paths: f.paths }), /发生变化/);
  } finally { fs.copyFileSync = copy; }
  assert.equal(fs.existsSync(f.paths.configPath), false); assert.equal(fs.existsSync(f.paths.databasePath), false);
  assert.equal(validateDatabase(configuration.databasePath, path.join(configuration.directory, 'uploads')).historyCount, 1);
});
test('Feedback is allowlisted, user initiated, mailto only; failed client and explicit copy fallback work', async () => {
  const body = feedbackText({ version: '1.2.0', errors: [{ category: 'backup_failed', message: 'Cookie=secret https://site/?token=secret', stack: 'private' }] });
  assert.ok(!body.includes('secret')); assert.ok(body.includes('backup_failed'));
  let url, copied, answer = 0;
  const feedback = createFeedback({ version: '1.2.0', window: {}, dialog: { showMessageBox: async () => ({ response: answer }) }, shell: { openExternal: async value => { url = value; throw new Error('no mail client'); } }, clipboard: { writeText: value => { copied = value; } } });
  await feedback(); assert.equal(url, undefined); assert.equal(copied, undefined);
  answer = 1; await feedback(); assert.equal(new URL(url).pathname, EMAIL); assert.equal(new URL(url).searchParams.get('subject'), '[DesignExtractor Personal] Bug 反馈'); assert.ok(copied.includes(EMAIL));
  answer = 2; url = null; await feedback(); assert.equal(url, null); assert.ok(copied.includes('软件版本：1.2.0'));
});
