const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const http = require('node:http');
const { createGuard } = require('./security.cjs');

async function startBackend({ serverDirectory, frontendDirectory, chromiumPath, configuration }) {
  if (!fs.existsSync(chromiumPath)) throw new Error(`随包 Chromium 缺失：${chromiumPath}。请重新安装应用`);
  if (!fs.existsSync(path.join(frontendDirectory, 'index.html'))) throw new Error('前端资源缺失，请重新安装应用');
  const token = crypto.randomBytes(32).toString('hex');
  const guard = createGuard(token);
  const runtime = require(path.join(serverDirectory, 'runtime.js'));
  runtime.configureDesktop({ ...configuration, dataDirectory: configuration.directory, chromiumPath, guard: guard.middleware });
  const api = require(path.join(serverDirectory, 'index.js'));
  let server;
  let stopped;
  async function stop() {
    if (stopped) return stopped;
    stopped = (async () => {
      guard.stop();
      const closed = server ? new Promise(resolve => server.close(resolve)) : Promise.resolve();
      server?.closeIdleConnections?.();
      const deadline = Date.now() + 8000;
      while (guard.active > 0 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
      const pool = require(path.join(serverDirectory, 'services/browser-pool.js'));
      await require(path.join(serverDirectory, 'utils/puppeteer-launch.js')).closeTrackedBrowsers();
      await pool.closeDefaultPool();
      server?.closeAllConnections?.();
      await closed;
      await api.closeDatabase();
    })();
    return stopped;
  }
  try {
    await api.ready;
    const express = require(require.resolve('express', { paths: [serverDirectory] }));
    api.app.get('/api/health', (_req, res) => res.json({ success: true, ready: true, database: 'sqlite' }));
    api.app.use((_req, res, next) => {
      res.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data: blob:; connect-src 'self' https:; font-src 'self' data:; object-src 'none'; frame-src 'none'; base-uri 'self'");
      next();
    });
    api.app.use(express.static(frontendDirectory));
    server = http.createServer(api.app);
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const origin = `http://127.0.0.1:${server.address().port}`;
    guard.setOrigin(origin);
    await new Promise((resolve, reject) => {
      const req = http.get(`${origin}/api/health`, { headers: { 'x-desktop-session': token } }, res => {
        let data = ''; res.on('data', chunk => { data += chunk; }); res.on('end', () => {
          try { if (res.statusCode !== 200 || !JSON.parse(data).ready) throw new Error('本地服务健康检查失败'); resolve(); } catch (error) { reject(error); }
        });
      });
      req.setTimeout(5000, () => req.destroy(new Error('本地服务健康检查超时'))); req.on('error', reject);
    });
    const browser = await require(path.join(serverDirectory, 'services/browser-pool.js')).getDefaultPool().acquire();
    try { console.log('Desktop browser ready', { chromiumPath, chromiumVersion: await browser.version(), puppeteerVersion: require(require.resolve('puppeteer/package.json', { paths: [serverDirectory] })).version, pool: require(path.join(serverDirectory, 'services/browser-pool.js')).getDefaultPool().getStatus() }); }
    finally { require(path.join(serverDirectory, 'services/browser-pool.js')).getDefaultPool().release(browser); }
    return { origin, token, stop };
  } catch (error) { await stop().catch(() => {}); throw error; }
}
module.exports = { startBackend };
