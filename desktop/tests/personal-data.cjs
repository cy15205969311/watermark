const { app } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createDatabase } = require('../../server/database/sqlite');
const { loadConfiguration, saveDownloadDirectory } = require('../config.cjs');
const { createBackup, validateBackup, restoreBackup, recoverInterruptedRestore, writableDirectory, hash } = require('../personal-data.cjs');
const { diagnostics, recordError, recentErrors, exportDiagnostics, recordBrowserFailure, lastBrowserFailure } = require('../diagnostics.cjs');
const { installSettings } = require('../settings.cjs');
const results = [];
app.whenReady().then(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'DesignExtractor 120 数据测试 '));
  const configuration = loadConfiguration(path.join(root, 'account-one'));
  const db = createDatabase(configuration.databasePath);
  const upload = path.join(configuration.directory, 'uploads'); fs.mkdirSync(upload);
  const gif = Buffer.from('GIF89a-fixture-byte-preservation'); fs.writeFileSync(path.join(upload, 'original.gif'), gif);
  const local = 'http://127.0.0.1:12345/uploads/original.gif';
  await db.query('INSERT INTO parse_records (original_url, client_id, image_urls_json, pages_json, extraction_metadata_json, page_count) VALUES (?, ?, ?, ?, ?, ?)', [local, configuration.clientId, JSON.stringify([local, local, local]), JSON.stringify([1, 2, 3].map(n => ({ page: n, pageId: String(n), imageUrl: local }))), JSON.stringify({ isAnimated: true, completenessStatus: 'partial', missingPages: [4] }), 3]);
  const destination = path.join(root, 'backups'); fs.mkdirSync(destination);
  const version = '1.2.0'; let backup;
  const check = async (name, action) => { try { await action(); results.push({ name, passed: true }); } catch (e) { results.push({ name, passed: false, error: e.message }); console.error(name, e.stack); } };
  await check('WAL snapshot, stable identity, uploads and hashes; exclude logs/temp', () => {
    fs.mkdirSync(path.join(configuration.directory, 'logs')); fs.writeFileSync(path.join(configuration.directory, 'logs/secret.log'), 'secret');
    fs.writeFileSync(path.join(configuration.temporaryDirectory, 'cache'), 'secret');
    backup = createBackup({ configuration, database: db, destination, version });
    const m = validateBackup(backup, version); assert.equal(m.historyCount, 1); assert.equal(m.uploadCount, 1);
    assert.equal(m.files.length, 3); assert.deepEqual(fs.readFileSync(path.join(backup, 'uploads/original.gif')), gif);
    assert.equal(fs.existsSync(path.join(backup, 'history.sqlite-wal')), false);
    assert.equal(JSON.parse(fs.readFileSync(path.join(backup, 'config.json'))).clientId, configuration.clientId);
  });
  await check('Corrupt bytes and missing uploads rejected, original live database unchanged', async () => {
    const bad = path.join(root, 'bad'); fs.cpSync(backup, bad, { recursive: true });
    fs.appendFileSync(path.join(bad, 'history.sqlite'), 'corruption'); assert.throws(() => validateBackup(bad, version), /校验失败/);
    fs.cpSync(backup, bad, { recursive: true }); fs.unlinkSync(path.join(bad, 'uploads/original.gif'));
    assert.throws(() => validateBackup(bad, version));
    assert.equal((await db.query('SELECT * FROM parse_records'))[0].length, 1);
  });
  await check('Backup copy failure cleans only its temporary directory and preserves live data/existing backups', async () => {
    const before = fs.readdirSync(destination).sort(); const original = fs.copyFileSync;
    try {
      fs.copyFileSync = (source, target, ...args) => {
        if (source === path.join(upload, 'original.gif')) throw new Error('injected disk write failure');
        return original(source, target, ...args);
      };
      assert.throws(() => createBackup({ configuration, database: db, destination, version }), /injected disk write failure/);
    } finally { fs.copyFileSync = original; }
    assert.deepEqual(fs.readdirSync(destination).sort(), before);
    assert.deepEqual(fs.readFileSync(path.join(upload, 'original.gif')), gif);
    assert.equal((await db.query('SELECT * FROM parse_records'))[0].length, 1);
  });
  await check('Missing history-linked upload rejected even with recalculated manifest', () => {
    const bad = path.join(root, 'missing'); fs.cpSync(backup, bad, { recursive: true });
    fs.unlinkSync(path.join(bad, 'uploads/original.gif')); const m = JSON.parse(fs.readFileSync(path.join(bad, 'manifest.json'))); m.files = m.files.filter(f => !f.path.startsWith('uploads/')); fs.writeFileSync(path.join(bad, 'manifest.json'), JSON.stringify(m));
    assert.throws(() => validateBackup(bad, version), /缺少历史记录引用/);
  });
  await check('Path traversal, extra files, future versions, corrupt DB with valid hash rejected', () => {
    for (const kind of ['traversal', 'extra', 'future', 'database']) {
      const bad = path.join(root, kind); fs.cpSync(backup, bad, { recursive: true }); const m = JSON.parse(fs.readFileSync(path.join(bad, 'manifest.json')));
      if (kind === 'traversal') m.files[0].path = 'uploads/../../escape';
      if (kind === 'extra') fs.writeFileSync(path.join(bad, 'unexpected'), 'not listed');
      if (kind === 'future') m.appVersion = '9.0.0';
      if (kind === 'database') { fs.writeFileSync(path.join(bad, 'history.sqlite'), 'bad'); const f = m.files.find(f => f.path === 'history.sqlite'); f.sizeBytes = 3; f.sha256 = hash(path.join(bad, 'history.sqlite')); }
      fs.writeFileSync(path.join(bad, 'manifest.json'), JSON.stringify(m)); assert.throws(() => validateBackup(bad, version), kind);
    }
  });
  await check('Nested junction is rejected without reading external files', () => {
    const bad = path.join(root, 'junction'); fs.cpSync(backup, bad, { recursive: true });
    fs.symlinkSync(root, path.join(bad, 'uploads/external'), 'junction');
    assert.throws(() => validateBackup(bad, version), /符号链接|联接/);
    fs.unlinkSync(path.join(bad, 'uploads/external'));
  });
  await check('Download setting persists without changing history identity', () => {
    writableDirectory(destination); saveDownloadDirectory(configuration, destination);
    const again = loadConfiguration(path.dirname(configuration.directory)); assert.equal(again.downloadDirectory, destination); assert.equal(again.clientId, configuration.clientId);
    assert.throws(() => writableDirectory('relative'), /本机磁盘/);
    const statfs = fs.statfsSync; try { fs.statfsSync = () => ({ bavail: 0, bsize: 4096 }); assert.throws(() => writableDirectory(destination), /空间不足/); } finally { fs.statfsSync = statfs; }
  });
  await check('Restore old ordered history/GIF, create rollback, keep logs and restart DB', async () => {
    await db.query('INSERT INTO parse_records (original_url, client_id) VALUES (?, ?)', ['newer', configuration.clientId]);
    fs.writeFileSync(path.join(upload, 'new-file'), 'current');
    const result = await restoreBackup({ configuration, database: db, backup, version });
    assert.equal(result.restored, true); assert.equal(validateBackup(result.rollback, version).historyCount, 2);
    const rows = (await db.query('SELECT * FROM parse_records'))[0]; assert.equal(rows.length, 1); assert.deepEqual(JSON.parse(rows[0].pages_json).map(p => p.page), [1, 2, 3]);
    assert.equal(JSON.parse(rows[0].extraction_metadata_json).completenessStatus, 'partial');
    assert.deepEqual(fs.readFileSync(path.join(upload, 'original.gif')), gif); assert.equal(fs.existsSync(path.join(upload, 'new-file')), false);
    assert.equal(fs.readFileSync(path.join(configuration.directory, 'logs/secret.log'), 'utf8'), 'secret'); assert.equal(configuration.downloadDirectory, null);
  });
  await check('Failure after each replacement rolls back original DB/config/uploads', async () => {
    await db.query('INSERT INTO parse_records (original_url, client_id) VALUES (?, ?)', ['current-state', configuration.clientId]);
    fs.writeFileSync(path.join(upload, 'keep'), 'keep'); saveDownloadDirectory(configuration, destination);
    for (const name of ['config.json', 'history.sqlite', 'uploads']) {
      await assert.rejects(restoreBackup({ configuration, database: db, backup, version, fault: point => { if (point === name) throw new Error('injected-copy-failure'); } }), /已回滚/);
      assert.equal((await db.query('SELECT * FROM parse_records'))[0].length, 2); assert.equal(configuration.downloadDirectory, destination);
      assert.equal(fs.readFileSync(path.join(upload, 'keep'), 'utf8'), 'keep'); assert.equal(fs.existsSync(path.join(configuration.directory, '.restore-journal.json')), false);
    }
  });
  await check('Interrupted replacement recovers on next startup and discards newer WAL', async () => {
    await db.end(); const id = 'restore-00000000-0000-0000-0000-000000000001'; const previous = path.join(configuration.temporaryDirectory, id, 'previous'); fs.mkdirSync(previous, { recursive: true });
    fs.renameSync(configuration.databasePath, path.join(previous, 'history.sqlite')); fs.copyFileSync(path.join(backup, 'history.sqlite'), configuration.databasePath);
    fs.writeFileSync(configuration.databasePath + '-wal', 'new database WAL');
    fs.writeFileSync(path.join(configuration.directory, '.restore-journal.json'), JSON.stringify({ id, original: ['history.sqlite', 'config.json', 'uploads'] }));
    assert.equal(recoverInterruptedRestore(configuration.directory), true); db.reopen(); assert.equal((await db.query('SELECT * FROM parse_records'))[0].length, 2);
  });
  await check('Settings cancel and restore-confirm cancel do not alter DB/config', async () => {
    let cancelChoice = true; let confirm = 0; const handlers = new Map(); let pauses = 0;
    installSettings({ app: { getPath: n => n === 'userData' ? path.dirname(configuration.directory) : destination, getVersion: () => version }, ipcMain: { handle: (name, fn) => handlers.set(name, fn) }, window: {}, configuration,
      backend: { database: db, pause: () => pauses++, resume() {}, status: () => ({}) }, trusted: e => e.trusted,
      dialog: { showOpenDialog: async () => ({ canceled: cancelChoice, filePaths: [backup] }), showMessageBox: async () => ({ response: confirm }) }, isBusy: () => false });
    for (const channel of ['backup', 'restore', 'choose-download']) assert.equal((await handlers.get('desktop:' + channel)({ trusted: true })).canceled, true);
    cancelChoice = false; assert.equal((await handlers.get('desktop:restore')({ trusted: true })).canceled, true); assert.equal(pauses, 0);
    await assert.rejects(handlers.get('desktop:backup')({ trusted: false }), /不允许/);
    assert.equal((await db.query('SELECT * FROM parse_records'))[0].length, 2);
  });
  await check('Diagnostics allowlist excludes tokens, cookies, passwords, paths and signed URLs', () => {
    const sentinel = 'super-secret-sentinel'; recordError(new Error(`Cookie: ${sentinel}; password=${sentinel}; https://cdn.test/a?signature=${sentinel}`), 'restore_failed');
    const report = diagnostics({ version, status: { chromiumPath: `C:\\Users\\${sentinel}\\resources\\chromium\\chrome-win64\\chrome.exe`, chromiumVersion: 'Chrome/121', browser: { available: 1, inUse: 0, waiting: 0, total: 1 }, database: { ready: true, schemaVersion: 1 }, activeRequests: 0, telemetry: { success: 1, failed: 2, partial: 3, unknown: 4, token: sentinel, recent: [{ state: 'partial', durationMs: 42, url: sentinel }] }, cookie: sentinel }, errors: recentErrors, operations: [{ type: 'backup', result: 'success', at: '2026-10-15', durationMs: 20, secret: sentinel }] });
    const serialized = JSON.stringify(report); assert.equal(serialized.includes(sentinel), false); assert.equal(serialized.includes('signature='), false);
    assert.equal(report.tasks.extraction.partial, 3); assert.deepEqual(report.tasks.recent, [{ state: 'partial', durationMs: 42 }]);
    const file = path.join(destination, 'diagnostics.json'); exportDiagnostics(file, report); assert.throws(() => exportDiagnostics(file, report)); assert.equal(fs.readFileSync(file, 'utf8').includes(sentinel), false);
  });
  await check('Separate account data/config remain untouched by restore', () => {
    const other = loadConfiguration(path.join(root, 'account-two')); assert.notEqual(other.clientId, configuration.clientId);
    const bytes = fs.readFileSync(path.join(other.directory, 'config.json')); assert.equal(recoverInterruptedRestore(other.directory), false); assert.deepEqual(fs.readFileSync(path.join(other.directory, 'config.json')), bytes);
  });
  await check('Last browser startup failure persists as safe actionable category across reload', () => {
    recordBrowserFailure(configuration.directory, new Error('Failed to launch chrome.exe EPERM Cookie=secret-value C:\\Users\\private'));
    const reason = lastBrowserFailure(configuration.directory); assert.match(reason, /权限不足/); assert.equal(reason.includes('secret-value'), false); assert.equal(reason.includes('private'), false);
    recordBrowserFailure(configuration.directory, new Error('SQLite unrelated failure'));
    assert.equal(lastBrowserFailure(configuration.directory), reason);
  });
  await db.end();
  const report = { version, isolatedDirectory: root, results, realMultiAccountWindowsAcceptance: 'not_executed' };
  fs.writeFileSync(path.resolve(__dirname, '../../server/test-artifacts/120-personal-data.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2)); app.exit(results.every(r => r.passed) ? 0 : 1);
}).catch(error => { console.error(error.stack); app.exit(1); });
