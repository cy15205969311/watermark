const { app, BrowserWindow, ipcMain, session } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const http = require('node:http');
const Module = require('node:module');
const root = path.resolve(__dirname, '../..');
const directory = fs.mkdtempSync(path.join(root, '.desktop-build', 'desktop-core-test-'));
const { createPaths, initializePaths } = require('../paths.cjs');
const testPaths = createPaths({ app, developmentRoot: directory }); initializePaths(app, testPaths);
const { createDatabase, databaseError } = require('../../server/database/sqlite');
const { loadConfiguration } = require('../config.cjs');
const { sanitize, installLogging } = require('../logging.cjs');
const results = [];
let backend;
let window;
let occupied;
app.on('window-all-closed', () => {});
async function check(name, fn) {
  try { await fn(); results.push({ name, passed: true }); console.log(`PASS ${name}`); }
  catch (error) { results.push({ name, passed: false, error: error.message }); console.error(`FAIL ${name}`, error.stack); }
}
app.whenReady().then(async () => {
  const config = loadConfiguration(directory, testPaths);
  await check('Electron built-in SQLite and Sharp N-API load', async () => {
    assert.ok(require('node:sqlite').DatabaseSync);
    const sharp = require('../../server/node_modules/sharp');
    const output = await sharp({ create: { width: 8, height: 8, channels: 4, background: '#ff0000' } }).png().toBuffer();
    assert.equal((await sharp(output).metadata()).format, 'png');
  });
  await check('SQLite migration, transaction, reopen persistence and future version protection', async () => {
    const file = path.join(directory, 'migration.sqlite');
    let db = createDatabase(file);
    await db.query('INSERT INTO parse_records (original_url, client_id, pages_json) VALUES (?, ?, ?)', ['https://gaoding.com/test', 'stable', JSON.stringify([{ pageId: '甲' }, { pageId: '乙' }])]);
    await db.end(); db = createDatabase(file);
    const [rows] = await db.query('SELECT * FROM parse_records WHERE client_id = ?', ['stable']);
    assert.equal(rows.length, 1); assert.equal(JSON.parse(rows[0].pages_json).length, 2);
    await db.end();
    const { DatabaseSync } = require('node:sqlite');
    const raw = new DatabaseSync(file);
    assert.equal(raw.prepare('PRAGMA user_version').get().user_version, 1);
    assert.equal(raw.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    assert.ok(raw.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().length >= 2);
    raw.exec('PRAGMA user_version = 99'); raw.close();
    assert.throws(() => createDatabase(file), /版本高于/);
    const after = new DatabaseSync(file); assert.equal(after.prepare('SELECT COUNT(*) AS n FROM parse_records').get().n, 1); after.close();
  });
  await check('SQLite corruption and disk/permission errors have actionable messages', async () => {
    const file = path.join(directory, 'corrupt.sqlite'); fs.writeFileSync(file, 'not a database');
    assert.throws(() => createDatabase(file), /损坏/);
    assert.match(databaseError(new Error('database or disk is full')).message, /空间不足/);
    assert.match(databaseError(new Error('readonly database')).message, /权限/);
  });
  await check('Stable client identity across restart and malformed config protection', async () => {
    assert.equal(loadConfiguration(directory).clientId, config.clientId);
    const other = fs.mkdtempSync(path.join(directory, 'config '));
    const bad = loadConfiguration(other); fs.writeFileSync(path.join(bad.directory, 'config.json'), '{bad');
    assert.throws(() => loadConfiguration(other), /配置损坏/);
  });
  await check('Rotating logs redact credentials and signed URLs', async () => {
    const logs = path.join(directory, 'logs'); const restore = installLogging(logs, { maxBytes: 320, backups: 2 });
    try { for (let i = 0; i < 15; i++) console.log('token=secret https://a.test/image?signature=secret x-desktop-session=secret', i); }
    finally { restore(); }
    const files = fs.readdirSync(logs); assert.ok(files.length <= 3 && files.length >= 2);
    for (const file of files) assert.ok(!fs.readFileSync(path.join(logs, file), 'utf8').includes('secret'));
    assert.ok(!sanitize('https://user:password@a.test/x?token=abc').includes('abc'));
  });
  occupied = net.createServer(); await new Promise(resolve => occupied.listen(0, '127.0.0.1', resolve));
  process.env.PORT = String(occupied.address().port);
  process.env.DB_HOST = 'desktop-must-not-connect.invalid';
  let mysqlAttempts = 0;
  const originalLoad = Module._load;
  Module._load = function(request, ...args) { if (/^mysql2/.test(request)) { mysqlAttempts++; throw new Error('Desktop attempted MySQL'); } return originalLoad.call(this, request, ...args); };
  try {
    await check('Missing bundled Chromium fails before database startup', async () => {
      await assert.rejects(require('../backend.cjs').startBackend({ serverDirectory: path.join(root, 'server'), frontendDirectory: path.join(root, '.desktop-build/app/client'), chromiumPath: path.join(directory, 'missing-chrome.exe'), configuration: config }), /Chromium 缺失/);
      assert.equal(fs.existsSync(config.databasePath), false);
    });
    await check('Real backend, bundled Chromium and dynamic loopback port; no MySQL or server env', async () => {
      const envBefore = { ...process.env };
      const manifest = JSON.parse(fs.readFileSync(path.join(root, '.desktop-build/chromium/manifest.json')));
      backend = await require('../backend.cjs').startBackend({ serverDirectory: path.join(root, 'server'), frontendDirectory: path.join(root, '.desktop-build/app/client'), chromiumPath: path.join(root, '.desktop-build/chromium', manifest.executable), configuration: config });
      assert.notEqual(new URL(backend.origin).port, process.env.PORT);
      assert.equal(new URL(backend.origin).hostname, '127.0.0.1');
      assert.equal(mysqlAttempts, 0); assert.deepEqual({ ...process.env }, envBefore);
      assert.ok(config.databasePath.startsWith(directory));
    });
  } finally { Module._load = originalLoad; }
  if (backend) {
    await check('Site-triggered Chromium attachments stay in managed personal temp, preserve bytes and leave Windows Downloads alone', async () => {
      const bytes = Buffer.from('GIF89a-managed-attachment');
      const fixture = http.createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'image/gif', 'Content-Disposition': 'attachment; filename="managed-browser.gif"' }); res.end(bytes); });
      await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
      const pool = require('../../server/services/browser-pool').getDefaultPool(); const browser = await pool.acquire(); let page;
      try {
        page = await browser.newPage();
        await page.goto(`http://127.0.0.1:${fixture.address().port}/attachment`).catch(error => { if (!/ERR_ABORTED/.test(error.message)) throw error; });
        const file = path.join(config.browserDownloadDirectory, 'managed-browser.gif');
        const deadline = Date.now() + 5000;
        while ((!fs.existsSync(file) || fs.statSync(file).size !== bytes.length) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
        assert.deepEqual(fs.readFileSync(file), bytes);
      } finally {
        await page?.close(); pool.release(browser);
        await new Promise(resolve => { fixture.close(resolve); fixture.closeAllConnections(); });
      }
    });
    const call = async (route, { method = 'GET', body, headers = {} } = {}) => {
      const response = await fetch(`${backend.origin}${route}`, { method, headers: { 'x-desktop-session': backend.token, 'x-client-id': config.clientId, ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { status: response.status, data: await response.json() };
    };
    await check('API rejects missing/invalid token, foreign origin and host rebinding', async () => {
      assert.equal((await fetch(`${backend.origin}/api/history`)).status, 401);
      for (const headers of [{ 'x-desktop-session': 'bad' }, { origin: 'https://evil.test' }, { host: 'evil.test' }]) {
        const status = await new Promise((resolve, reject) => {
          http.get(`${backend.origin}/api/health`, { headers: { 'x-desktop-session': backend.token, ...headers } }, res => { res.resume(); resolve(res.statusCode); }).on('error', reject);
        });
        assert.ok([401, 403].includes(status));
      }
      assert.equal((await call('/api/health')).data.database, 'sqlite');
    });
    await check('Maintenance rejects new writes then resumes the same SQLite connection and history', async () => {
      backend.pause();
      try {
        assert.equal((await call('/api/history')).status, 503);
        assert.equal((await call('/api/parse', { method: 'POST', body: { url: 'https://gaoding.com/must-not-write' } })).status, 503);
        assert.throws(() => backend.pause(), /任务正在进行/);
        assert.equal(backend.status().database.ready, true);
      } finally { backend.resume(); }
      assert.equal((await call('/api/history')).data.data.length, 0);
      assert.equal((await call('/api/health')).status, 200);
    });
    await check('SQLite API preserves ordered pages, shared URLs, partial/unknown and GIF metadata', async () => {
      for (const status of ['complete', 'partial', 'unknown']) {
        const pageCount = status === 'unknown' ? 1 : 3;
        const pages = Array.from({ length: pageCount }, (_, i) => ({ page: i + 1, pageNumber: i + 1, pageId: `page-${i + 1}`, designId: 'design-fixture', url: 'https://cdn.example.com/shared.png', imageUrl: 'https://cdn.example.com/shared.png', source: 'fixture-json' }));
        const result = await call('/api/parse', { method: 'POST', body: { url: `https://www.gaoding.com/dam/share/${status}`, platform: 'Gaoding', imageUrl: pages[0].url, imageUrls: pages.map(page => page.url), pages, pageCount, completenessStatus: status, expectedPageCount: status === 'unknown' ? null : status === 'partial' ? 4 : 3, isComplete: status === 'complete', missingPages: status === 'partial' ? [4] : [] } });
        assert.equal(result.status, 200); assert.equal(result.data.data.pageCount, pageCount);
        const history = await call('/api/history'); const saved = history.data.data.find(record => record.id === result.data.data.id);
        assert.equal(saved.completenessStatus, status); assert.equal(saved.pages.length, pageCount); assert.deepEqual(saved.pages.map(p => p.pageId), pages.map(p => p.pageId));
        assert.equal(saved.imageUrls.length, pageCount);
      }
      const gif = 'https://img.tuguaishou.com/test-animated.gif?signature=retain';
      const result = await call('/api/parse', { method: 'POST', body: { url: 'https://818ps.com/test', platform: '818ps', imageUrl: gif, imageUrls: [gif], isAnimated: true, animationUrl: gif, frameCount: 2, detectedFormat: 'gif', animationStatus: 'verified_animated' } });
      assert.equal(result.status, 200);
      const history = await call('/api/history'); const saved = history.data.data.find(record => record.id === result.data.data.id);
      assert.equal(saved.isAnimated, true); assert.equal(saved.imageUrls[0], gif); assert.equal(saved.frameCount, 2);
      assert.equal((await call('/api/history/search?query=818ps')).data.data.length, 1);
      await call(`/api/history/${saved.id}`, { method: 'DELETE', headers: { 'x-client-id': 'other-client' } });
      assert.ok((await call('/api/history')).data.data.some(record => record.id === saved.id));
      await call(`/api/history/${saved.id}`, { method: 'DELETE' });
      assert.ok(!(await call('/api/history')).data.data.some(record => record.id === saved.id));
    });
    await check('Sandboxed Vue window receives scoped preload and restores SQLite multi-page history', async () => {
      const desktopSession = session.fromPartition('desktop-test');
      desktopSession.webRequest.onBeforeSendHeaders((details, callback) => {
        const headers = { ...details.requestHeaders };
        if (new URL(details.url).origin === backend.origin) headers['X-Desktop-Session'] = backend.token;
        callback({ requestHeaders: headers });
      });
      ipcMain.on('desktop:connection', event => { event.returnValue = { apiBaseUrl: `${backend.origin}/api`, clientId: config.clientId, version: 'test' }; });
      window = new BrowserWindow({ show: false, webPreferences: { preload: path.join(root, 'desktop/preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, session: desktopSession } });
      const errors = []; window.webContents.on('console-message', (_event, level, message) => { if (level === 3) errors.push(message); });
      await window.loadURL(backend.origin);
      await new Promise(resolve => setTimeout(resolve, 1500));
      const view = await window.webContents.executeJavaScript(`({ desktop: { apiBaseUrl: window.desktop?.apiBaseUrl, clientId: window.desktop?.clientId, token: window.desktop?.token }, node: typeof require, text: document.body.innerText, count: document.querySelector('#app').childElementCount })`);
      assert.equal(view.desktop.clientId, config.clientId); assert.equal(view.node, 'undefined'); assert.ok(view.count > 0);
      assert.equal(view.desktop.token, undefined); assert.match(view.text, /提取|解析/);
      const response = await window.webContents.executeJavaScript(`fetch(window.desktop.apiBaseUrl + '/history?clientId=' + window.desktop.clientId).then(r => r.json())`);
      assert.equal(response.data.length, 3); assert.ok(response.data.some(record => record.pages.length === 3));
      const screenshot = await window.webContents.capturePage();
      fs.mkdirSync(path.join(root, 'server/test-artifacts'), { recursive: true });
      fs.writeFileSync(path.join(root, 'server/test-artifacts/desktop-window.png'), screenshot.toPNG());
      assert.deepEqual(errors.filter(message => !/favicon/.test(message)), []);
    });
    await check('Bounded shutdown releases listening port, Chromium and SQLite; reopen retains history', async () => {
      if (window) window.destroy();
      const pool = require('../../server/services/browser-pool').getDefaultPool();
      const browsers = await Promise.all([pool.acquire(), pool.acquire(), pool.acquire()]);
      assert.equal(pool.getStatus().inUse, 3);
      const waiting = pool.acquire(15000).then(() => false, error => error.message === 'browser_pool_closed');
      const pids = browsers.map(browser => browser.process().pid);
      for (const browser of browsers) {
        const profileArgument = browser.process().spawnargs.find(arg => arg.includes('--user-data-dir='));
        assert.ok(profileArgument?.replace(/"/g, '').startsWith('--user-data-dir=' + config.browserProfileDirectory), profileArgument);
      }
      const start = Date.now(); await backend.stop(); assert.ok(Date.now() - start < 16000);
      assert.equal(await waiting, true);
      for (const pid of pids) assert.throws(() => process.kill(pid, 0));
      await assert.rejects(fetch(`${backend.origin}/api/health`));
      const db = createDatabase(config.databasePath); const [rows] = await db.query('SELECT * FROM parse_records WHERE client_id = ?', [config.clientId]); assert.equal(rows.length, 3); await db.end();
    });
  }
  await backend?.stop().catch(() => {});
  occupied?.close();
  console.log(JSON.stringify({ electron: process.versions.electron, node: process.versions.node, sqlite: process.versions.sqlite, directory, results }, null, 2));
  fs.writeFileSync(path.join(root, 'server/test-artifacts/desktop-test-results.json'), JSON.stringify({ versions: process.versions, directory, results }, null, 2));
  app.exit(results.some(result => !result.passed) ? 1 : 0);
}).catch(async error => { console.error(error); await backend?.stop().catch(() => {}); app.exit(1); });
