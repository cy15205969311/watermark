const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const asar = require('@electron/asar');
const root = path.resolve(__dirname, '../..');
const output = require('../scripts/artifact-paths.cjs').artifactDirectory();
const resources = path.join(output, 'win-unpacked/resources');
const archive = path.join(resources, 'app.asar');
const files = asar.listPackage(archive).map(name => name.replace(/\\/g, '/'));
const forbidden = files.filter(name => /(^|\/)\.env|test-artifacts|\/uploads\/|\.sqlite(?:-|$)|\/desktop\/(tests|signing)\/|\.(pfx|p12|pem|key)$/i.test(name));
assert.deepEqual(forbidden, []);
for (const entry of ['/server/index.js', '/server/runtime.js', '/server/database/mysql.js', '/server/database/sqlite.js', '/server/extractors/gaoding.js', '/server/extractors/818ps.js', '/desktop/preload.cjs', '/desktop/main.cjs', '/client/index.html']) assert.ok(files.includes(entry), `Missing ${entry}`);
assert.ok(files.includes('/desktop/menus.cjs'));
assert.ok(files.includes('/desktop/download-directory.cjs'));
for (const name of ['paths.cjs', 'storage-migration.cjs', 'feedback.cjs']) {
  assert.ok(files.includes('/desktop/' + name));
  assert.equal(asar.extractFile(archive, path.join('desktop', name)).toString(), fs.readFileSync(path.join(root, 'desktop', name), 'utf8'));
}
assert.equal(asar.extractFile(archive, path.join('server', 'utils', 'puppeteer-launch.js')).toString(), fs.readFileSync(path.join(root, 'server/utils/puppeteer-launch.js'), 'utf8'));
assert.equal(asar.extractFile(archive, path.join('desktop', 'download-directory.cjs')).toString(), fs.readFileSync(path.join(root, 'desktop/download-directory.cjs'), 'utf8'));
const suppliedIcon = fs.readFileSync(path.join(root, 'desktop/assets/DesignExtractor-Personal-icon.ico'));
assert.deepEqual(asar.extractFile(archive, path.join('desktop', 'assets', 'DesignExtractor-Personal-icon.ico')), suppliedIcon);
const resedit = require('resedit');
const sourceImages = Array.from({ length: suppliedIcon.readUInt16LE(4) }, (_, index) => {
  const entry = 6 + index * 16;
  return suppliedIcon.subarray(suppliedIcon.readUInt32LE(entry + 12), suppliedIcon.readUInt32LE(entry + 12) + suppliedIcon.readUInt32LE(entry + 8));
});
function checkIconResources(executable) {
  const resource = resedit.NtExecutableResource.from(resedit.NtExecutable.from(fs.readFileSync(executable), { ignoreCert: true }));
  const images = resource.entries.filter(entry => entry.type === 3).map(entry => Buffer.from(entry.bin));
  assert.ok(sourceImages.every(image => images.some(actual => actual.equals(image))), 'ICO images missing in ' + executable);
  return { executable, matchedSourceImages: sourceImages.length };
}
assert.ok(files.some(name => name.includes('sharp-win32-x64') && name.endsWith('.node')));
const manifest = JSON.parse(fs.readFileSync(path.join(resources, 'chromium/manifest.json')));
assert.equal(manifest.chromeVersion, '121.0.6167.85'); assert.equal(manifest.puppeteerVersion, '21.11.0');
assert.ok(fs.existsSync(path.join(resources, 'chromium', manifest.executable)));
assert.ok(fs.existsSync(path.join(resources, 'chromium/chrome-win64/locales/zh-CN.pak')));
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version;
const installer = path.join(output, `DesignExtractor-Personal-${version}-x64-Setup.exe`);
const icons = [checkIconResources(path.join(output, 'win-unpacked/去水印下载助手.exe')), checkIconResources(installer)];
// Native one-pass WriteUninstaller runs only at installation. Its runtime icon
// must be checked in the disposable installation test, never inferred here.
const summary = { entries: files.length, forbiddenFiles: forbidden, chromium: manifest, icons, installer, sizeBytes: fs.statSync(installer).size, sha256: crypto.createHash('sha256').update(fs.readFileSync(installer)).digest('hex') };
fs.writeFileSync(path.join(root, 'server/test-artifacts/desktop-package-inspection.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
