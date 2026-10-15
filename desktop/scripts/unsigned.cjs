const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function unsignedEnvironment(env) {
  const result = { ...env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' };
  for (const key of Object.keys(result)) if (/CSC_LINK|CSC_KEY_PASSWORD|PERSONAL_CSC|DESKTOP_SIGNING|DESKTOP_CERTSTORE|AZURE_|PERSONAL_TIMESTAMP|DESKTOP_TIMESTAMP/i.test(key)) delete result[key];
  return result;
}
function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(e => {
    const file = path.join(directory, e.name);
    if (e.isSymbolicLink()) throw new Error('Artifact reparse point rejected');
    return e.isDirectory() ? walk(file) : [file];
  });
}
function vendorManifest(output) {
  const files = [];
  for (const [source, target] of [[path.join(root, '.desktop-build/chromium'), 'win-unpacked/resources/chromium'], [path.join(root, '.desktop-build/notices'), 'win-unpacked/resources/licenses']]) {
    for (const file of walk(source)) files.push({ file: target + '/' + path.relative(source, file).replace(/\\/g, '/'), sha256: digest(file) });
  }
  for (const file of walk(path.join(root, 'node_modules/electron/dist')).filter(f => /\.dll$/i.test(f))) files.push({ file: 'win-unpacked/' + path.relative(path.join(root, 'node_modules/electron/dist'), file).replace(/\\/g, '/'), sha256: digest(file) });
  fs.writeFileSync(path.join(output, 'vendor-integrity.json'), JSON.stringify(files, null, 2));
}
function verify(output, version) {
  const setup = `DesignExtractor-Personal-${version}-x64-Setup.exe`;
  const required = [setup, 'win-unpacked/去水印下载助手.exe', 'win-unpacked/resources/chromium/chrome-win64/chrome.exe'];
  for (const file of required) if (!fs.existsSync(path.join(output, file))) throw new Error('Required artifact missing: ' + file);
  const vendors = JSON.parse(fs.readFileSync(path.join(output, 'vendor-integrity.json')));
  for (const entry of vendors) if (digest(path.join(output, entry.file)) !== entry.sha256) throw new Error('Bundled vendor file changed: ' + entry.file);
  const binaries = [...new Set([...required, ...walk(path.join(output, 'win-unpacked')).filter(f => /\.(exe|dll|node)$/i.test(f)).map(f => path.relative(output, f).replace(/\\/g, '/'))])];
  const input = path.join(output, 'verification-input.json'); const reportFile = path.join(output, 'verification-report.json');
  fs.writeFileSync(input, JSON.stringify(binaries));
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  // PowerShell 7's inherited module path cannot load Windows PowerShell's
  // security module. Use the OS-owned module directory, not caller profiles.
  const env = { ...process.env, PSModulePath: path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/Modules') };
  const result = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'verify-unsigned.ps1'), '-OutputDirectory', output, '-InputFile', input, '-ReportFile', reportFile], { env, windowsHide: true, encoding: 'utf8', timeout: 180000 });
  if (result.error || result.status !== 0) throw new Error('Authenticode verification unavailable or failed: ' + require('../logging.cjs').sanitize(result.error?.code || result.stderr || result.status));
  const report = JSON.parse(fs.readFileSync(reportFile, 'utf8').replace(/^\uFEFF/, ''));
  if (!report.passed || required.some(f => report.files.find(r => r.file === f)?.status !== 'NotSigned')) throw new Error('Unsigned candidate signature policy failed');
  for (const name of required.slice(0, 2)) {
    const actual = report.files.find(f => f.file === name)?.fileVersion;
    if (!actual || !actual.startsWith(version)) throw new Error('Product version mismatch');
  }
  const metadata = path.join(output, 'release-metadata.json');
  if (fs.existsSync(metadata)) {
    const saved = JSON.parse(fs.readFileSync(metadata));
    if (saved.sha256 !== digest(path.join(output, setup)) || saved.state !== 'unsigned_candidate' || saved.signatureStatus !== 'NotSigned') throw new Error('Candidate metadata or hash mismatch');
  }
  return report;
}
module.exports = { root, digest, unsignedEnvironment, vendorManifest, verify };
