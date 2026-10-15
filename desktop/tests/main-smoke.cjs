// Runs the actual main/preload with isolated appData and deterministic dialogs.
const { app, dialog } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const root = path.resolve(__dirname, '../..');
const profile = path.resolve(process.argv.find(arg => arg.startsWith('--profile='))?.slice(10) || path.join(root, '.desktop-build/main-smoke 中文 空格'));
if (!profile.startsWith(path.join(root, '.desktop-build') + path.sep)) throw new Error('Smoke profile must be inside build workspace');
fs.mkdirSync(profile, { recursive: true });
process.env.DESIGN_EXTRACTOR_DEV_DATA_DIR = profile;
const getPath = app.getPath.bind(app);
app.getPath = name => name === 'appData' ? profile : getPath(name);
const verify = process.argv.includes('--verify-persistence');
const results = [];
let failure;
let fixture;
let cancelNext = false;
dialog.showSaveDialog = async (_window, options) => {
  if (cancelNext) { cancelNext = false; return { canceled: true }; }
  return { canceled: false, filePath: path.join(profile, path.basename(options.defaultPath)) };
};
dialog.showMessageBox = async (...args) => {
  const options = args.at(-1);
  if (options.title === '迁移旧版个人数据') { results.push('Actual main detects isolated legacy data and requests migration confirmation (dialog response injected)'); return { response: 1 }; }
  failure = options.message; console.error('Unexpected startup dialog', options.message); return { response: 0 };
};
const timeout = setTimeout(() => { failure = 'Main smoke timeout'; app.quit(); }, 90000);
app.on('will-quit', () => {
  clearTimeout(timeout); fixture?.close();
  fs.writeFileSync(path.join(profile, verify ? 'verify-results.json' : 'seed-results.json'), JSON.stringify({ failure, results, userData: app.getPath('userData') }, null, 2));
  if (failure) app.exit(1);
});
app.once('browser-window-created', (_event, window) => {
  window.webContents.once('did-finish-load', async () => {
    try {
      await new Promise(resolve => setTimeout(resolve, 700));
      const evaluate = code => window.webContents.executeJavaScript(code);
      const connection = await evaluate('({api:window.desktop?.apiBaseUrl, clientId:window.desktop?.clientId, node:typeof require, token:window.desktop?.token})');
      assert.ok(connection.api.startsWith('http://127.0.0.1:'));
      assert.equal(connection.node, 'undefined'); assert.equal(connection.token, undefined);
      const post = record => evaluate(`fetch(window.desktop.apiBaseUrl+'/parse', {method:'POST', headers:{'Content-Type':'application/json','X-Client-Id':window.desktop.clientId}, body:JSON.stringify(${JSON.stringify(record)})}).then(r=>r.json())`);
      const history = () => evaluate("fetch(window.desktop.apiBaseUrl+'/history?clientId='+window.desktop.clientId).then(r=>r.json())");
      const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOwAAAABJRU5ErkJggg==';
      if (!verify) {
        const pages = Array.from({ length: 3 }, (_, i) => ({ page: i + 1, pageNumber: i + 1, pageId: `p${i + 1}`, designId: 'smoke-design', imageUrl: png }));
        const saved = await post({ url: 'https://www.gaoding.com/dam/share/smoke', platform: 'Gaoding', imageUrl: png, pages, imageUrls: pages.map(p => p.imageUrl), expectedPageCount: 3, completenessStatus: 'complete', isComplete: true });
        assert.equal(saved.data.pageCount, 3);
        const gif = (await require('./fixtures.cjs').animatedGif()).dataUrl;
        const animated = await post({ url: 'https://818ps.com/smoke', platform: '818ps', imageUrl: gif, imageUrls: [gif], isAnimated: true, animationUrl: gif, detectedFormat: 'gif', frameCount: 2 });
        assert.equal(animated.data.isAnimated, true);
        await evaluate(`window.desktop.saveResource(${JSON.stringify(png)},'page-1.png')`);
        const savedGif = await evaluate(`window.desktop.saveResource(${JSON.stringify(gif)},'animation.gif')`);
        assert.ok(savedGif.saved); assert.equal(fs.readFileSync(path.join(profile, 'animation.gif')).subarray(0, 6).toString(), 'GIF89a');
        assert.ok(fs.existsSync(path.join(profile, 'page-1.png')));
        fixture = http.createServer((_req, res) => { res.setHeader('Content-Type', 'image/gif'); res.end(Buffer.from(gif.split(',')[1], 'base64')); });
        await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
        const remote = `http://127.0.0.1:${fixture.address().port}/animation.gif?signature=preserved`;
        assert.ok((await evaluate(`window.desktop.saveResource(${JSON.stringify(remote)},'network-animation.gif')`)).saved);
        assert.deepEqual(fs.readFileSync(path.join(profile, 'network-animation.gif')), fs.readFileSync(path.join(profile, 'animation.gif')));
        assert.equal(require('../../server/extractors/818ps-animation').parseGif(fs.readFileSync(path.join(profile, 'network-animation.gif'))).frameCount, 2);
        await assert.rejects(evaluate("window.desktop.saveResource('file:///C:/Windows/win.ini','bad.txt')"));
        cancelNext = true;
        assert.ok((await evaluate(`window.desktop.saveResource(${JSON.stringify(png)},'cancel.png')`)).canceled);
        assert.ok(!fs.existsSync(path.join(profile, 'cancel.png')));
        results.push('Actual main/preload/session guard; data and HTTP resource saves; cancel; filesystem URL rejection');
      }
      const data = await history();
      assert.equal(data.data.length, 2);
      assert.equal(data.data.find(record => record.platform === 'Gaoding').pageCount, 3);
      assert.equal(data.data.find(record => record.platform === '818ps').isAnimated, true);
      await window.webContents.reload();
      await new Promise(resolve => setTimeout(resolve, 1000));
      const body = await evaluate('document.body.innerText');
      assert.match(body, /Gaoding|稿定/);
      results.push(verify ? 'Restart retains same clientId and multi-page/GIF histories' : 'Vue restores SQLite multi-page/GIF histories');
      const screenshot = await window.webContents.capturePage();
      fs.writeFileSync(path.join(profile, verify ? 'restarted.png' : 'main-window.png'), screenshot.toPNG());
    } catch (error) { failure = error.stack; console.error(error); }
    window.close();
  });
});
require('../main.cjs');
