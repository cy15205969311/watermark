const crypto = require('node:crypto');
function createGuard(token) {
  let origin = '';
  let stopping = false;
  let active = 0;
  const secret = Buffer.from(token);
  function middleware(req, res, next) {
    if (!origin || req.get('host') !== new URL(origin).host) return res.sendStatus(403);
    const requestOrigin = req.get('origin');
    if (requestOrigin && requestOrigin !== origin) return res.sendStatus(403);
    if (req.path.startsWith('/api/') || req.path.startsWith('/uploads/')) {
      const supplied = Buffer.from(req.get('x-desktop-session') || '');
      if (supplied.length !== secret.length || !crypto.timingSafeEqual(supplied, secret)) return res.sendStatus(401);
      if (stopping) return res.status(503).json({ success: false, message: '应用正在退出，请重新启动后操作' });
      active++;
      let finished = false;
      const done = () => { if (!finished) { active--; finished = true; } };
      res.once('finish', done); res.once('close', done);
    }
    next();
  }
  return { middleware, setOrigin(value) { origin = value; }, stop() { stopping = true; }, get active() { return active; } };
}
module.exports = { createGuard };
