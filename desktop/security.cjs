const crypto = require('node:crypto');
function createGuard(token) {
  let origin = '';
  let stopping = false;
  let maintenance = false;
  const telemetry = { success: 0, failed: 0, partial: 0, unknown: 0, recent: [] };
  let active = 0;
  const secret = Buffer.from(token);
  function middleware(req, res, next) {
    if (!origin || req.get('host') !== new URL(origin).host) return res.sendStatus(403);
    const requestOrigin = req.get('origin');
    if (requestOrigin && requestOrigin !== origin) return res.sendStatus(403);
    if (req.path.startsWith('/api/') || req.path.startsWith('/uploads/')) {
      const supplied = Buffer.from(req.get('x-desktop-session') || '');
      if (supplied.length !== secret.length || !crypto.timingSafeEqual(supplied, secret)) return res.sendStatus(401);
      if (stopping || maintenance) return res.status(503).json({ success: false, message: maintenance ? '正在备份或恢复个人数据，请稍后重试' : '应用正在退出，请重新启动后操作' });
      const started = Date.now();
      const json = res.json.bind(res);
      res.json = body => {
        if (req.path === '/api/extract-image') {
          const result = body?.data || body || {};
          const state = body?.success === false ? 'failed' : ['partial', 'unknown'].includes(result.completenessStatus) ? result.completenessStatus : 'success';
          telemetry[state]++;
          telemetry.recent.push({ state, durationMs: Date.now() - started });
          if (telemetry.recent.length > 20) telemetry.recent.shift();
        }
        // Persisted local upload URLs survive dynamic-port changes and restore.
        const rebase = value => {
          if (Array.isArray(value)) return value.map(rebase);
          if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, rebase(v)]));
          if (typeof value === 'string' && /^https?:\/\/127\.0\.0\.1:\d+\/uploads\//.test(value)) return origin + new URL(value).pathname;
          return value;
        };
        return json(rebase(body));
      };
      active++;
      let finished = false;
      const done = () => { if (!finished) { active--; finished = true; } };
      // A disconnected request may still be writing files. Conservatively keep
      // it active until finish; maintenance then requires restarting the app.
      res.once('finish', done);
    }
    next();
  }
  return { middleware, setOrigin(value) { origin = value; }, stop() { stopping = true; },
    pause() { if (active || stopping || maintenance) throw new Error('有任务正在进行，请完成后再管理数据；若任务已中断，请重启应用'); maintenance = true; },
    resume() { maintenance = false; }, telemetry, get active() { return active; } };
}
module.exports = { createGuard };
