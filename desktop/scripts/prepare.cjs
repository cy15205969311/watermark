const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const staging = path.join(root, '.desktop-build');
const application = path.join(staging, 'app');
function run(command, args, cwd, env = {}) {
  const result = spawnSync(command, args, { cwd, env: { ...process.env, ...env }, stdio: 'inherit', windowsHide: true, shell: false });
  if (result.error || result.status !== 0) throw result.error || new Error(`${command} failed: ${result.status}`);
}
function npm(args, cwd, env) {
  const cli = process.env.npm_execpath;
  if (!cli) throw new Error('Run this script through npm run desktop:prepare');
  run(process.execPath, [cli, ...args], cwd, env);
}
function copyJavaScript(source, target) {
  fs.mkdirSync(target, { recursive: true });
  for (const item of fs.readdirSync(source, { withFileTypes: true })) {
    if (['node_modules', 'uploads', 'test-artifacts', 'fixtures', 'chrome'].includes(item.name) || /^(test|verify|inspect|check|debug|diagnose)[-.]/.test(item.name)) continue;
    const from = path.join(source, item.name); const to = path.join(target, item.name);
    if (item.isDirectory()) copyJavaScript(from, to);
    else if (/\.js$/.test(item.name)) fs.copyFileSync(from, to);
  }
}
function sameBrowserFiles(source, target) {
  if (!fs.existsSync(target)) return false;
  return fs.readdirSync(source, { withFileTypes: true }).every(item => {
    const from = path.join(source, item.name); const to = path.join(target, item.name);
    if (item.isDirectory()) return sameBrowserFiles(from, to);
    return fs.existsSync(to) && fs.statSync(to).isFile() && fs.statSync(from).size === fs.statSync(to).size;
  });
}
async function prepare() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 13)) throw new Error('桌面构建需要 Node.js 22.13+，建议 Node.js 24；服务器仍可单独启动');
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Windows x64 build host required');
  // Electron 44 downloads lazily on first use. Ensure the build distribution exists.
  const electronExecutable = require('electron');
  if (!fs.existsSync(electronExecutable)) throw new Error('Electron binary missing; reinstall desktop dependencies');
  fs.mkdirSync(application, { recursive: true });
  const frontendOutput = path.join(staging, 'client-dist');
  npm(['run', 'build', '--', '--mode', 'desktop', '--outDir', frontendOutput, '--emptyOutDir'], path.join(root, 'client'));
  for (const directory of ['server', 'client', 'desktop']) {
    // Fixed targets underneath .desktop-build only; user data and server env are untouched.
    const target = path.resolve(application, directory);
    if (!target.startsWith(application + path.sep)) throw new Error('Invalid staging target');
    fs.rmSync(target, { recursive: true, force: true });
  }
  copyJavaScript(path.join(root, 'server'), path.join(application, 'server'));
  fs.cpSync(frontendOutput, path.join(application, 'client'), { recursive: true });
  fs.mkdirSync(path.join(application, 'desktop'), { recursive: true });
  for (const name of ['main.cjs', 'preload.cjs', 'backend.cjs', 'security.cjs', 'config.cjs', 'logging.cjs']) {
    fs.copyFileSync(path.join(root, 'desktop', name), path.join(application, 'desktop', name));
  }
  const serverPackage = JSON.parse(fs.readFileSync(path.join(root, 'server/package.json')));
  const appPackage = { name: 'design-extractor-personal', version: JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version, main: 'desktop/main.cjs',
    description: '设计稿提取助手 Windows 个人版', author: 'Design Extractor', private: true, dependencies: serverPackage.dependencies };
  fs.writeFileSync(path.join(application, 'package.json'), JSON.stringify(appPackage, null, 2));
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'server/package-lock.json')));
  lock.name = appPackage.name; lock.version = appPackage.version;
  lock.packages[''] = { ...appPackage }; delete lock.packages[''].main;
  fs.writeFileSync(path.join(application, 'package-lock.json'), JSON.stringify(lock, null, 2));
  const hash = crypto.createHash('sha256').update(JSON.stringify(lock)).digest('hex');
  const hashFile = path.join(staging, 'dependencies.sha256');
  if (!fs.existsSync(path.join(application, 'node_modules/sharp')) || !fs.existsSync(hashFile) || fs.readFileSync(hashFile, 'utf8') !== hash) {
    npm(['ci', '--omit=dev', '--no-audit', '--no-fund'], application, { PUPPETEER_SKIP_DOWNLOAD: 'true' });
    fs.writeFileSync(hashFile, hash);
  }
  const puppeteer = require(path.join(application, 'node_modules/puppeteer'));
  const buildId = puppeteer.PUPPETEER_REVISIONS.chrome;
  const browsers = require(path.join(application, 'node_modules/@puppeteer/browsers'));
  // A Puppeteer-managed matching cache is safe to reuse at build time; the
  // resulting installation always contains its own full browser directory.
  let cachedExecutable;
  try { cachedExecutable = puppeteer.executablePath(); } catch { /* fresh build host */ }
  const installed = cachedExecutable && fs.existsSync(cachedExecutable) && cachedExecutable.includes(buildId)
    ? { executablePath: cachedExecutable }
    : await browsers.install({ browser: browsers.Browser.CHROME, buildId, cacheDir: path.join(staging, 'browser-cache'), platform: browsers.BrowserPlatform.WIN64 });
  const browserDirectory = path.join(staging, 'chromium');
  fs.mkdirSync(browserDirectory, { recursive: true });
  const chromeFolder = path.dirname(installed.executablePath);
  const stagedChrome = path.join(browserDirectory, 'chrome-win64');
  if (!sameBrowserFiles(chromeFolder, stagedChrome)) fs.cpSync(chromeFolder, stagedChrome, { recursive: true });
  fs.writeFileSync(path.join(browserDirectory, 'manifest.json'), JSON.stringify({ executable: 'chrome-win64/chrome.exe', chromeVersion: buildId, puppeteerVersion: require(path.join(application, 'node_modules/puppeteer/package.json')).version }, null, 2));
  // A simple source-controlled vector mark; ICO contains a PNG at 256px.
  const sharp = require(path.join(application, 'node_modules/sharp'));
  const png = await sharp(Buffer.from(fs.readFileSync(path.join(root, 'desktop/assets/icon.svg')))).resize(256, 256).png().toBuffer();
  const header = Buffer.alloc(22); header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4); header.writeUInt16LE(1, 10); header.writeUInt16LE(32, 12); header.writeUInt32LE(png.length, 14); header.writeUInt32LE(22, 18);
  const icon = Buffer.concat([header, png]);
  fs.writeFileSync(path.join(root, 'desktop/assets/icon.ico'), icon);
  fs.mkdirSync(path.join(application, 'desktop/assets'), { recursive: true });
  fs.writeFileSync(path.join(application, 'desktop/assets/icon.ico'), icon);
  console.log('Desktop staged', { application, chromeVersion: buildId, puppeteerVersion: require(path.join(application, 'node_modules/puppeteer/package.json')).version });
}
prepare().catch(error => { console.error(error); process.exitCode = 1; });
