const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { defaultDownloadDirectory, resolveDownloadDirectory, checkDirectory, chooseResourceSavePath } = require('../download-directory.cjs');
const { loadConfiguration, saveDownloadDirectory } = require('../config.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'design-download-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const install = path.join(root, '中文 安装 Path'); fs.mkdirSync(install);
  const userData = path.join(root, 'profile'); const downloads = path.join(root, 'Windows Downloads'); fs.mkdirSync(downloads);
  const app = { isPackaged: true, getVersion: () => '1.2.0', getPath: name => ({ userData, downloads })[name] };
  const paths = require('../paths.cjs').createPaths({ app, execPath: path.join(install, 'app.exe') });
  const configuration = loadConfiguration(userData, paths);
  return { root, app, configuration, execPath: path.join(install, '去水印下载助手.exe'), install, preferred: path.join(install, 'personal', 'Downloads') };
}
test('Packaged EXE location determines default, including custom drive, Chinese and spaces', t => {
  const f = fixture(t); assert.equal(defaultDownloadDirectory(f.app, f.execPath, f.configuration), f.preferred);
  if (process.platform === 'win32') assert.equal(require('../paths.cjs').createPaths({ app: f.app, execPath: 'E:\\Applications\\中文 App\\app.exe' }).downloadDirectory, 'E:\\Applications\\中文 App\\personal\\Downloads');
});
test('Status is lazy; first save creates a genuinely writable Downloads directory', t => {
  const f = fixture(t); assert.equal(resolveDownloadDirectory(f).directory, f.preferred); assert.ok(!fs.existsSync(f.preferred));
  assert.equal(resolveDownloadDirectory({ ...f, ensure: true }).directory, f.preferred);
  assert.deepEqual(fs.readdirSync(f.preferred), []); assert.deepEqual(fs.readdirSync(f.install), ['personal']);
});
test('Development uses explicit writable development personal directory', t => {
  const f = fixture(t); f.app.isPackaged = false;
  const paths = require('../paths.cjs').createPaths({ app: f.app, developmentRoot: path.join(f.root, 'dev') });
  f.configuration = loadConfiguration(f.root, paths);
  assert.equal(resolveDownloadDirectory({ ...f, ensure: true }).directory, path.join(f.root, 'dev/personal/Downloads')); assert.ok(!fs.existsSync(f.preferred));
});
for (const mode of ['mkdir denied', 'actual probe denied', 'disk full']) test(`Unwritable installation (${mode}) reports failure without fallback, elevation or changing config`, t => {
  const f = fixture(t);
  const io = Object.create(fs);
  io.mkdirSync = (file, opts) => { if (mode === 'mkdir denied' && file.startsWith(f.install)) throw Object.assign(new Error('denied'), { code: 'EACCES' }); return fs.mkdirSync(file, opts); };
  io.writeFileSync = (file, ...args) => { if (mode === 'actual probe denied' && file.startsWith(f.install)) throw Object.assign(new Error('read only'), { code: 'EPERM' }); return fs.writeFileSync(file, ...args); };
  io.statfsSync = file => mode === 'disk full' && file.startsWith(f.install) ? { bavail: 0, bsize: 4096 } : fs.statfsSync(file);
  const before = fs.readFileSync(path.join(f.configuration.directory, 'config.json'));
  const result = resolveDownloadDirectory({ ...f, io, ensure: true });
  assert.equal(result.directory, f.preferred); assert.equal(result.available, false); assert.equal(result.fallback, false); assert.match(result.warning, /不会回退 AppData/);
  assert.deepEqual(fs.readFileSync(path.join(f.configuration.directory, 'config.json')), before);
});
test('Custom directory survives config reload; invalid custom location reports error and is retained', t => {
  const f = fixture(t); const custom = path.join(f.root, '用户 下载'); fs.mkdirSync(custom); saveDownloadDirectory(f.configuration, custom);
  const again = loadConfiguration(f.app.getPath('userData'), f.configuration.paths); assert.equal(again.clientId, f.configuration.clientId);
  assert.equal(resolveDownloadDirectory({ ...f, configuration: again }).directory, custom);
  fs.rmdirSync(custom); fs.writeFileSync(custom, 'not a directory');
  assert.equal(resolveDownloadDirectory({ ...f, configuration: again, ensure: true }).available, false);
  assert.equal(loadConfiguration(f.app.getPath('userData'), f.configuration.paths).downloadDirectory, custom);
});
test('Reset clears custom override and recomputes defaults after installation moves', t => {
  const f = fixture(t); saveDownloadDirectory(f.configuration, f.app.getPath('downloads')); saveDownloadDirectory(f.configuration, null);
  const next = path.join(f.root, '新 安装目录'); fs.mkdirSync(next);
  const paths = require('../paths.cjs').createPaths({ app: f.app, execPath: path.join(next, 'app.exe') });
  const result = resolveDownloadDirectory({ ...f, configuration: { ...f.configuration, paths }, ensure: true });
  assert.equal(result.directory, path.join(next, 'personal', 'Downloads')); assert.equal(f.configuration.clientId, loadConfiguration(f.app.getPath('userData'), f.configuration.paths).clientId);
});
test('Manual save choice changes this save only; cancellation writes no output', async t => {
  const f = fixture(t); saveDownloadDirectory(f.configuration, f.app.getPath('downloads'));
  const selected = path.join(f.root, 'chosen.gif'); let options;
  const dialog = { showSaveDialog: async (_w, opts) => { options = opts; return { filePath: selected }; } };
  assert.equal((await chooseResourceSavePath({ ...f, dialog, filename: 'original.gif' })).filePath, selected);
  assert.equal(options.defaultPath, path.join(f.app.getPath('downloads'), 'original.gif')); assert.equal(f.configuration.downloadDirectory, f.app.getPath('downloads'));
  dialog.showSaveDialog = async () => ({ canceled: true });
  assert.equal((await chooseResourceSavePath({ ...f, dialog, filename: 'cancel.gif' })).canceled, true); assert.ok(!fs.existsSync(selected));
});
test('Existing file requires explicit replace; invalid target and missing parent return Chinese errors', async t => {
  const f = fixture(t); saveDownloadDirectory(f.configuration, f.app.getPath('downloads'));
  const output = path.join(f.root, 'existing.gif'); fs.writeFileSync(output, 'keep');
  const dialog = { showSaveDialog: async () => ({ filePath: output }), showMessageBox: async () => ({ response: 0 }) };
  assert.equal((await chooseResourceSavePath({ ...f, dialog, filename: 'existing.gif' })).canceled, true); assert.equal(fs.readFileSync(output, 'utf8'), 'keep');
  dialog.showMessageBox = async () => ({ response: 1 }); assert.equal((await chooseResourceSavePath({ ...f, dialog, filename: 'existing.gif' })).overwrite, true);
  dialog.showSaveDialog = async () => ({ filePath: 'relative.gif' }); await assert.rejects(chooseResourceSavePath({ ...f, dialog, filename: 'x.gif' }), /保存路径无效/);
  dialog.showSaveDialog = async () => ({ filePath: path.join(f.root, 'missing/x.gif') }); await assert.rejects(chooseResourceSavePath({ ...f, dialog, filename: 'x.gif' }), /保存目录不存在/);
});
test('All defaults unavailable still opens save dialog and accepts another writable location', async t => {
  const f = fixture(t);
  const bad = path.join(f.root, 'file'); fs.writeFileSync(bad, 'x');
  f.app.getPath = () => bad; f.configuration.downloadDirectory = bad;
  const target = resolveDownloadDirectory({ ...f, ensure: true }); assert.equal(target.available, false);
  let shown = false;
  const dialog = { showMessageBox: async () => ({ response: 0 }), showSaveDialog: async () => { shown = true; return { filePath: path.join(f.root, 'manual.gif') }; } };
  assert.equal((await chooseResourceSavePath({ ...f, dialog, filename: 'x.gif' })).filePath, path.join(f.root, 'manual.gif')); assert.equal(shown, true);
});
test('Read-only probe and insufficient space are detected independently of folder existence', t => {
  const f = fixture(t); const io = Object.create(fs); io.statfsSync = () => ({ bavail: 1, bsize: 4096 });
  assert.throws(() => checkDirectory(f.install, { io }), /磁盘空间不足/);
  assert.throws(() => checkDirectory('relative'), /完整文件夹路径/);
});
test('Settings open only resolved directory; cancel preserves custom; reset keeps identity and database path', async t => {
  const f = fixture(t); const handlers = new Map(); let opened;
  const custom = f.app.getPath('downloads'); saveDownloadDirectory(f.configuration, custom);
  const before = { clientId: f.configuration.clientId, databasePath: f.configuration.databasePath };
  require('../settings.cjs').installSettings({ ...f, version: '1.2.0', window: {},
    ipcMain: { handle: (name, fn) => handlers.set(name, fn) }, dialog: { showOpenDialog: async () => ({ canceled: true }) },
    shell: { openPath: async value => { opened = value; return ''; } },
    backend: { status: () => ({}) }, isBusy: () => false, trusted: event => event.trusted });
  const event = { trusted: true };
  assert.equal((await handlers.get('desktop:choose-download')(event)).canceled, true); assert.equal(f.configuration.downloadDirectory, custom);
  assert.equal((await handlers.get('desktop:open-download')(event)).opened, true); assert.equal(opened, custom);
  await assert.rejects(handlers.get('desktop:open-download')({}), /不允许/);
  await handlers.get('desktop:reset-download')(event); assert.equal(f.configuration.downloadDirectory, null);
  assert.equal(f.configuration.clientId, before.clientId); assert.equal(f.configuration.databasePath, before.databasePath);
});
