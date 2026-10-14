const fs = require('node:fs');
const path = require('node:path');
const util = require('node:util');
function sanitize(value) {
  return String(value).replace(/https?:\/\/[^\s<>"']+/gi, raw => {
    try { const u = new URL(raw); u.username = ''; u.password = ''; if (u.search) u.search = '?redacted'; u.hash = ''; return u.href; } catch { return '[url]'; }
  }).replace(/((?:cookie|authorization|token|password|x-desktop-session)\s*["']?\s*[:=]\s*)[^\s,}]+/gi, '$1[redacted]');
}
function installLogging(directory, { maxBytes = 2 * 1024 * 1024, backups = 3 } = {}) {
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, 'desktop.log');
  const originals = {};
  for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
    originals[level] = console[level];
    console[level] = (...args) => {
      const line = `${new Date().toISOString()} [${level}] ${sanitize(util.format(...args))}\n`;
      try {
        if (fs.existsSync(file) && fs.statSync(file).size + Buffer.byteLength(line) > maxBytes) {
          for (let i = backups; i >= 1; i--) {
            const target = `${file}.${i}`;
            if (fs.existsSync(target)) fs.unlinkSync(target);
            const source = i === 1 ? file : `${file}.${i - 1}`;
            if (fs.existsSync(source)) fs.renameSync(source, target);
          }
        }
        fs.appendFileSync(file, Buffer.from(line).subarray(0, maxBytes));
      } catch { originals.error('桌面日志无法写入，请检查磁盘空间和目录权限'); }
      originals[level](line.trimEnd());
    };
  }
  return () => { Object.assign(console, originals); };
}
module.exports = { installLogging, sanitize };
