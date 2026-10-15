const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
// Export an allowlist of runtime facts, never raw logs, history or config.
function diagnostics({ version, status, operations = [], errors = [] }) {
  return {
    format: 'DesignExtractorPersonalDiagnostics', version, mode: 'desktop-sqlite', createdAt: new Date().toISOString(),
    os: { platform: os.platform(), release: os.release(), architecture: os.arch() },
    browser: { path: '[随包资源]/chromium/' + path.basename(path.dirname(status.chromiumPath)) + '/' + path.basename(status.chromiumPath), version: status.chromiumVersion,
      available: status.browser.available, inUse: status.browser.inUse, waiting: status.browser.waiting, total: status.browser.total },
    database: { ready: status.database.ready, schemaVersion: status.database.schemaVersion },
    tasks: { activeRequests: status.activeRequests, resourceSaves: status.resourceSaves || 0, browserDownloads: status.browserDownloads || 0, maintenance: status.maintenance === true,
      extraction: Object.fromEntries(['success', 'failed', 'partial', 'unknown'].map(k => [k, Number(status.telemetry[k]) || 0])), recent: status.telemetry.recent.map(r => ({ state: ['success', 'failed', 'partial', 'unknown'].includes(r.state) ? r.state : 'unknown', durationMs: Number(r.durationMs) || 0 })) },
    operations: operations.slice(-20).map(r => ({ type: ['backup', 'restore', 'diagnostics', 'settings'].includes(r.type) ? r.type : 'unknown', result: ['success', 'failed', 'canceled'].includes(r.result) ? r.result : 'unknown', at: r.at, durationMs: r.durationMs })),
    errors: errors.slice(-10).map(e => ({ at: e.at, category: e.category, stackFrames: e.stackFrames })),
    excluded: ['凭据、Cookie 和授权令牌', '图片内容与历史资源 URL', '原始日志与个人配置', '个人文件夹完整路径'],
  };
}
const recentErrors = [];
const browserReasons = new Set(['随包浏览器资源缺失，请从完整安装包重新安装', '浏览器启动超时，请检查系统资源与安全软件记录', '浏览器进程权限不足，请检查文件访问权限与安全软件记录', '浏览器进程启动失败，请查看本机日志中的具体原因']);
function recordBrowserFailure(directory, error) {
  const message = String(error?.message || '');
  if (!/chromium|chrome|browser|浏览器|Failed to launch|spawn/i.test(message)) return;
  const reason = /缺失|ENOENT|not found/i.test(message) ? [...browserReasons][0] : /timeout|timed out|超时/i.test(message) ? [...browserReasons][1] : /EACCES|EPERM|permission/i.test(message) ? [...browserReasons][2] : [...browserReasons][3];
  const file = path.join(directory, 'browser-status.json'); const temporary = file + '.tmp';
  try { fs.writeFileSync(temporary, JSON.stringify({ at: new Date().toISOString(), reason })); fs.renameSync(temporary, file); }
  catch { /* A full/read-only disk must not replace the original startup error. */ }
}
function lastBrowserFailure(directory) {
  try { const value = JSON.parse(fs.readFileSync(path.join(directory, 'browser-status.json'), 'utf8')); return browserReasons.has(value.reason) && Number.isFinite(Date.parse(value.at)) ? `${value.reason}（${value.at}）` : null; }
  catch { return null; }
}
function recordError(error, category = 'desktop_operation_failed') {
  recentErrors.push({ at: new Date().toISOString(), category,
    // Only function identifiers, never arguments, paths, URLs or messages.
    stackFrames: String(error?.stack || '').split('\n').slice(1, 6).map(line => line.match(/^\s*at\s+([\w.$<>]+)/)?.[1] || 'anonymous') });
  if (recentErrors.length > 10) recentErrors.shift();
}
function exportDiagnostics(target, report) {
  const temporary = path.join(path.dirname(target), `.diagnostics-${crypto.randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, JSON.stringify(report, null, 2), { flag: 'wx' });
    // Hard link commits without ever overwriting an existing diagnostic file.
    fs.linkSync(temporary, target);
  } finally { fs.rmSync(temporary, { force: true }); }
}
module.exports = { diagnostics, recordError, recentErrors, exportDiagnostics, recordBrowserFailure, lastBrowserFailure };
