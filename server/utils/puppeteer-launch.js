function getPuppeteerExecutablePath() {
  const runtime = require('../runtime').getRuntime();
  if (runtime.mode === 'desktop') return runtime.chromiumPath;
  const executablePath = String(
    process.env.PUPPETEER_EXECUTABLE_PATH || ""
  ).trim();

  return executablePath || undefined;
}

function withPuppeteerExecutablePath(launchOptions = {}) {
  const normalizedLaunchOptions = { ...launchOptions };
  const runtime = require('../runtime').getRuntime();
  if (runtime.mode === 'desktop') {
    normalizedLaunchOptions.executablePath = runtime.chromiumPath;
    normalizedLaunchOptions.env = { ...process.env, TEMP: runtime.temporaryDirectory, TMP: runtime.temporaryDirectory };
    normalizedLaunchOptions.timeout = Math.min(Number(normalizedLaunchOptions.timeout) || 10000, 10000);
    return normalizedLaunchOptions;
  }
  const explicitExecutablePath = String(
    normalizedLaunchOptions.executablePath || ""
  ).trim();

  if (explicitExecutablePath) {
    normalizedLaunchOptions.executablePath = explicitExecutablePath;
    return normalizedLaunchOptions;
  }

  const executablePath = getPuppeteerExecutablePath();
  if (executablePath) {
    normalizedLaunchOptions.executablePath = executablePath;
  }

  return normalizedLaunchOptions;
}

const tracked = new Set();
const pending = new Set();
const cleanups = new Set();
let closing = false;
function cleanProfile(profile) {
  if (!profile) return;
  const fs = require('node:fs');
  const path = require('node:path');
  const directory = require('../runtime').getRuntime().temporaryDirectory;
  if (!directory || !path.resolve(profile).startsWith(path.resolve(directory) + path.sep)) throw new Error('Invalid browser profile cleanup path');
  const cleanup = fs.promises.rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }).catch(error => console.warn('Chromium 临时目录清理失败', error.code));
  cleanups.add(cleanup);
  cleanup.finally(() => cleanups.delete(cleanup));
}
function launchTracked(puppeteer, options) {
  if (closing) return Promise.reject(new Error('应用正在退出，无法启动浏览器'));
  const runtime = require('../runtime').getRuntime();
  let profile;
  if (runtime.mode === 'desktop') {
    profile = require('node:fs').mkdtempSync(require('node:path').join(runtime.temporaryDirectory, 'chromium-profile-'));
    options = { ...options, userDataDir: profile };
    console.log('Chromium launch', { executablePath: options.executablePath, headless: options.headless, args: options.args, timeout: options.timeout });
  }
  const launch = (async () => {
    let browser;
    try { browser = await puppeteer.launch(options); }
    catch (error) { cleanProfile(profile); throw error; }
    browser.once('disconnected', () => { tracked.delete(browser); cleanProfile(profile); });
    if (closing) { await closeBrowser(browser); throw new Error('应用正在退出'); }
    tracked.add(browser);
    return browser;
  })();
  pending.add(launch);
  launch.then(() => pending.delete(launch), () => pending.delete(launch));
  return launch;
}
async function closeBrowser(browser) {
  let timer;
  try {
    await Promise.race([browser.close(), new Promise(resolve => {
      timer = setTimeout(() => {
        const child = browser.process();
        if (child?.pid && child.exitCode === null) {
          if (process.platform === 'win32') require('node:child_process').execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
          else child.kill('SIGKILL');
        }
        resolve();
      }, 3000);
    })]);
  } finally { clearTimeout(timer); tracked.delete(browser); }
}
async function closeTrackedBrowsers() {
  closing = true;
  await Promise.allSettled([...tracked].map(closeBrowser));
  await Promise.allSettled([...pending]);
  await Promise.allSettled([...cleanups]);
}
module.exports = {
  getPuppeteerExecutablePath,
  withPuppeteerExecutablePath,
  launchTracked,
  closeTrackedBrowsers,
};
