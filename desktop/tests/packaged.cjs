// Developer-machine packaged smoke, not a substitute for a clean Windows VM.
const { _electron: electron } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const http = require('node:http');
const { spawnSync } = require('node:child_process');
const asar = require('@electron/asar');
const root = path.resolve(__dirname, '../..');
const installed = process.argv.find(arg => arg.startsWith('--installed='))?.slice(12);
const productionCopy = process.argv.includes('--production-copy');
const destination = installed ? path.resolve(installed) : fs.mkdtempSync(path.join(root, '.desktop-build', '安装 中文 Path '));
if (!destination.startsWith(path.join(root, '.desktop-build') + path.sep)) throw new Error('Test install must be inside build workspace');
if (!installed) fs.cpSync(path.join(require('../scripts/artifact-paths.cjs').artifactDirectory(), 'win-unpacked'), destination, { recursive: true });
const executable = path.join(destination, '去水印下载助手.exe');
const digest = file => require('node:crypto').createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const originalDigests = [executable, path.join(destination, 'resources/app.asar')].map(digest);
// No daily-user history/config writes during package smoke. For a copied test
// bundle only, install a bootstrap BEFORE the unchanged production entry.
// Installed targets are permitted solely by the disposable NSIS test runner.
const isolatedProfile = fs.mkdtempSync(path.join(root, '.desktop-build', 'package-profile-'));
const results = [];
let application;
let beforeIds;
let createdIds = [];
let origin;
async function launch() {
  const minimalPath = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
  application = await electron.launch({ executablePath: executable, env: { ...process.env, PATH: minimalPath, DB_HOST: 'must-not-connect.invalid', PUPPETEER_EXECUTABLE_PATH: 'missing-global-chrome.exe' }, timeout: 60000 });
  const page = await application.firstWindow({ timeout: 20000 }); await page.waitForLoadState('networkidle');
  const info = await application.evaluate(({ app }) => {
    const load = process.getBuiltinModule('node:module').createRequire(app.getAppPath() + '/package.json');
    const runtime = load('./server/runtime.js').getRuntime();
    return { isPackaged: app.isPackaged, userData: app.getPath('userData'), appPath: app.getAppPath(), database: runtime.database, databasePath: runtime.databasePath, chromiumPath: runtime.chromiumPath,
      temp: app.getPath('temp'), sessionData: app.getPath('sessionData'), logs: app.getPath('logs'), browserProfileDirectory: runtime.browserProfileDirectory, browserDownloadDirectory: runtime.browserDownloadDirectory,
      mysqlLoaded: Object.keys(load.cache).some(name => /node_modules[\\/]mysql2[\\/]/.test(name)) };
  });
  assert.equal(info.isPackaged, true); assert.equal(info.database, 'sqlite'); assert.equal(info.mysqlLoaded, false);
  assert.ok(info.chromiumPath.startsWith(destination)); assert.ok(info.databasePath.startsWith(info.userData)); assert.ok(info.databasePath.startsWith(path.join(destination, 'personal') + path.sep));
  for (const value of [info.temp, info.sessionData, info.logs, info.browserProfileDirectory, info.browserDownloadDirectory]) assert.ok(value.startsWith(info.userData + path.sep));
  if (!installed && !productionCopy) {
    if (beforeIds === undefined) assert.deepEqual(fs.readdirSync(isolatedProfile), [], 'Initial startup must not write legacy AppData');
    assert.equal(fs.existsSync(path.join(isolatedProfile, 'DesignExtractorPersonal')), false);
  }
  origin = new URL(page.url()).origin;
  return { page, info };
}
async function request(page, route, options = {}) {
  return page.evaluate(async ({ route, options }) => {
    const response = await fetch(window.desktop.apiBaseUrl + route, { ...options, headers: { 'X-Client-Id': window.desktop.clientId, 'Content-Type': 'application/json' }, ...(options.body ? { body: JSON.stringify(options.body) } : {}) });
    return { status: response.status, data: await response.json() };
  }, { route, options });
}
async function shutdown() {
  if (!application) return;
  const child = application.process();
  const closed = new Promise(resolve => child.once('exit', resolve));
  await application.evaluate(({ BrowserWindow, app }) => { const first = BrowserWindow.getAllWindows()[0]; if (first) first.close(); else app.quit(); }).catch(() => {});
  let timer;
  try { await Promise.race([closed, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Packaged shutdown timeout')), 20000); })]); }
  finally { clearTimeout(timer); }
  application = null;
}
async function run() {
  if (!installed && productionCopy) {
    // Data fixture only. Original EXE, ASAR and integrity fuses stay byte-for-byte
    // unchanged. The initialization marker avoids prompting about daily data.
    const data = path.join(destination, 'personal'); fs.mkdirSync(data);
    fs.writeFileSync(path.join(data, '.storage-layout.json'), JSON.stringify({ version: 1, kind: 'new', at: new Date().toISOString() }));
    results.push({ name: 'Unmodified production EXE/ASAR copy; isolated initialized personal data fixture, no bootstrap or fuse changes' });
  } else if (!installed) {
    const archive = path.join(destination, 'resources/app.asar');
    const extracted = path.join(destination, 'test-bundle-source');
    asar.extractAll(archive, extracted);
    const manifestFile = path.join(extracted, 'package.json');
    const manifest = JSON.parse(fs.readFileSync(manifestFile));
    const originalEntry = manifest.main;
    manifest.main = 'isolated-test-bootstrap.cjs';
    fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
    fs.mkdirSync(isolatedProfile, { recursive: true });
    fs.writeFileSync(path.join(extracted, manifest.main), `require('electron').app.setPath('appData', ${JSON.stringify(isolatedProfile)});\nrequire('./' + ${JSON.stringify(originalEntry)});\n`);
    await asar.createPackageWithOptions(extracted, archive, { unpack: '*.node', unpackDir: path.join('node_modules', '@img') });
    // Repacked test ASAR differs from the production header hash. Disable its
    // validation ONLY on this task-owned executable copy; release stays intact.
    const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');
    await flipFuses(executable, { version: FuseVersion.V1, [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: false });
    results.push({ name: 'Instrumented copy isolates appData; release archive/executable unchanged', isolatedProfile, testCopyAsarIntegrityValidation: false });
  } else if (!process.argv.includes('--disposable-environment')) {
    throw new Error('Installed-app smoke requires an explicitly disposable environment');
  }
  const first = await launch();
  if (!installed) assert.equal(first.info.userData, path.join(destination, 'personal'));
  results.push({ name: 'Packaged app runs with Chinese/space installation path and no Node/Chrome on PATH', info: first.info });
  const feedbackResult = await application.evaluate(async ({ Menu, dialog, shell, clipboard }) => {
    const menu = Menu.getApplicationMenu().items.find(i => i.label === '帮助').submenu.items.find(i => i.label === '问题反馈 / 报告 Bug');
    if (!menu) throw new Error('Feedback entry missing');
    const show = dialog.showMessageBox, open = shell.openExternal, write = clipboard.writeText;
    let copied, draft, preview;
    try {
      dialog.showMessageBox = async (_w, options) => { preview = options; return { response: 1 }; };
      shell.openExternal = async url => { draft = url; throw new Error('isolated missing mail client fixture'); };
      clipboard.writeText = value => { copied = value; }; // Do not alter user's clipboard.
      menu.click();
      const deadline = Date.now() + 5000;
      while (!copied && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
      if (!copied) throw new Error('Feedback copy fallback did not complete');
      return { draft, copied, fallbackTitle: preview.title };
    } finally { dialog.showMessageBox = show; shell.openExternal = open; clipboard.writeText = write; }
  });
  assert.equal(new URL(feedbackResult.draft).pathname, 'ad4928115@gmail.com');
  assert.equal(feedbackResult.fallbackTitle, '无法打开邮件客户端'); assert.match(feedbackResult.copied, /软件版本：1\.2\.0/);
  results.push({ name: 'Actual packaged help callback composes mail draft and provides copy fallback; transport, native dialogs and clipboard injected, no mail sent' });
  if (process.argv.includes('--download-ui')) {
    if (installed) throw new Error('Native download acceptance uses only an isolated bundle copy');
    console.log(await require('./download-native.cjs').verifyNativeDownloads(application, first.page, executable, isolatedProfile, path.join(root, 'server/test-artifacts')));
    await shutdown(); return;
  }
  if (process.argv.includes('--menu-ui')) {
    if (process.argv.includes('--menu-busy-fixture')) {
      // Hold an isolated local extraction fixture for native warning screenshots;
      // no platform request, daily history write or database mutation is sent.
      first.page.on('dialog', () => {}); // Electron owns beforeunload confirmation.
      let release;
      await first.page.route('**/api/extract-image', async route => {
        await new Promise(resolve => { release = resolve; });
        await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ success: false, message: '本地菜单验收夹具结束' }) }).catch(() => {});
      });
      application.process().once('exit', () => release?.());
      await first.page.locator('textarea').first().fill('https://818ps.com/?share_id=local-menu-fixture');
      await first.page.getByRole('button', { name: '解析链接' }).click();
      await first.page.getByRole('button', { name: '解析中，请稍候…' }).waitFor();
    }
    const stateFile = path.join(root, 'server/test-artifacts/menu-ui-session.json');
    fs.writeFileSync(stateFile, JSON.stringify({ executable, destination, isolatedProfile, productionBundleInstrumentedForIsolation: !installed }, null, 2));
    console.log('Menu UI session ready:', executable);
    // Finite observation session, no fixture writes. Close via the real menu.
    await new Promise(resolve => {
      const timer = setTimeout(resolve, 15 * 60 * 1000);
      application.process().once('exit', () => { clearTimeout(timer); application = null; resolve(); });
    });
    if (application) await shutdown();
    return;
  }
  results.push(await require('./menu-runtime.cjs').verifyMenus(application, first.page));
  if (!installed) results.push(...await require('./settings-runtime.cjs').verifySettings(application, first.page, isolatedProfile, path.join(root, 'server/test-artifacts')));
  const history = await request(first.page, '/history'); beforeIds = history.data.data.map(record => record.id);
  const p1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOwAAAABJRU5ErkJggg==';
  const pages = Array.from({ length: 3 }, (_, i) => ({ page: i + 1, pageNumber: i + 1, pageId: `p${i + 1}`, designId: 'packaged-fixture', imageUrl: p1 }));
  const saved = await request(first.page, '/parse', { method: 'POST', body: { url: 'https://www.gaoding.com/dam/share/packaged-fixture', platform: 'Gaoding', pages, imageUrls: pages.map(p => p.imageUrl), imageUrl: p1, expectedPageCount: 3, completenessStatus: 'complete', isComplete: true } });
  assert.equal(saved.data.data.pageCount, 3); createdIds.push(saved.data.data.id);
  const gif = (await require('./fixtures.cjs').animatedGif()).dataUrl;
  const animated = await request(first.page, '/parse', { method: 'POST', body: { url: 'https://818ps.com/packaged-fixture', platform: '818ps', imageUrl: gif, imageUrls: [gif], animationUrl: gif, isAnimated: true, detectedFormat: 'gif', frameCount: 2 } });
  createdIds.push(animated.data.data.id); assert.equal(animated.data.data.isAnimated, true);
  const client = await first.page.evaluate(() => window.desktop.clientId);
  const secondInstance = spawnSync(executable, [], { windowsHide: true, timeout: 15000 });
  assert.equal(secondInstance.status, 0); assert.equal((await request(first.page, '/health')).data.ready, true);
  results.push({ name: 'Second instance exits and existing authenticated backend remains available' });
  if (process.argv.includes('--live-gaoding')) {
    const live = await request(first.page, '/extract-image', { method: 'POST', body: { url: 'https://www.gaoding.com/dam/share/bbgdyxG0Jdm8ir5koNVTv', platform: 'Gaoding' } });
    results.push({ name: 'Live Gaoding extraction in packaged backend', status: live.status, pageCount: live.data.pageCount, expectedPageCount: live.data.expectedPageCount, completenessStatus: live.data.completenessStatus, source: live.data.source, evidence: live.data.pages?.map(page => ({ pageId: page.pageId, pageNumber: page.pageNumber, source: page.source })) });
    assert.equal(live.status, 200); assert.equal(live.data.pageCount, 3); assert.equal(live.data.completenessStatus, 'complete');
  }
  assert.equal(await new Promise((resolve, reject) => http.get(`${origin}/api/history`, res => { res.resume(); resolve(res.statusCode); }).on('error', reject)), 401);
  await first.page.reload({ waitUntil: 'networkidle' });
  await first.page.screenshot({ path: path.join(root, 'server/test-artifacts/desktop-packaged.png'), fullPage: true });
  const oldOrigin = origin;
  await shutdown();
  await assert.rejects(fetch(`${oldOrigin}/api/health`));
  const restarted = await launch();
  assert.equal(await restarted.page.evaluate(() => window.desktop.clientId), client);
  if (!installed) assert.equal((await restarted.page.evaluate(() => window.desktop.getSettings())).downloadDirectory, path.join(isolatedProfile, 'downloads'));
  const restored = await request(restarted.page, '/history');
  assert.equal(restored.data.data.find(record => record.id === createdIds[0]).pages.length, 3);
  assert.equal(restored.data.data.find(record => record.id === createdIds[1]).isAnimated, true);
  for (const id of createdIds) await request(restarted.page, `/history/${id}`, { method: 'DELETE' });
  createdIds = [];
  results.push({ name: 'Packaged restart retains ordered multi-page/GIF metadata; test records removed', existingRecordIds: beforeIds });
  await shutdown();
  if (productionCopy) {
    assert.deepEqual([executable, path.join(destination, 'resources/app.asar')].map(digest), originalDigests);
    results.push({ name: 'Original production EXE/ASAR hashes unchanged after startup, downloads, restore, feedback and restart' });
  }
  fs.writeFileSync(path.join(root, 'server/test-artifacts/desktop-packaged-results.json'), JSON.stringify({ destination, results, cleanWindowsVM: 'not executed' }, null, 2));
  console.log(JSON.stringify({ passed: true, destination, results, cleanWindowsVM: 'not executed' }, null, 2));
}
run().catch(async error => {
  console.error(error);
  if (application) {
    try { const page = application.windows()[0]; if (page) for (const id of createdIds) await request(page, `/history/${id}`, { method: 'DELETE' }); } catch {}
    await shutdown().catch(() => application?.process().kill());
  }
  process.exitCode = 1;
});
