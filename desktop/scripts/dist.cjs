const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { root, digest, unsignedEnvironment, vendorManifest, verify } = require('./unsigned.cjs');
const { sanitize } = require('../logging.cjs');
async function main() {
  if ((process.argv[2] || 'candidate') !== 'candidate') throw new Error('当前未启用正式签名。请使用 npm run desktop:dist 构建未签名候选包；不会降级为签名成功。');
  const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version;
  const id = new Date().toISOString().replace(/[:.]/g, '-') + '-' + crypto.randomBytes(3).toString('hex');
  const output = path.join(root, 'release/candidates', version, id); fs.mkdirSync(output, { recursive: true });
  const env = { ...unsignedEnvironment(process.env), DESKTOP_BUILD_MODE: 'candidate', DESKTOP_MANAGED_BUILD: 'true', DESKTOP_ARTIFACT_DIR: output };
  const log = line => { const text = sanitize(line); console.log(text); fs.appendFileSync(path.join(output, 'build.log'), text + '\n'); };
  const run = script => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, script)], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    for (const stream of [child.stdout, child.stderr]) { let pending = ''; stream.on('data', chunk => { pending += chunk; let pos; while ((pos = pending.indexOf('\n')) >= 0) { log(pending.slice(0, pos)); pending = pending.slice(pos + 1); } }); stream.on('end', () => { if (pending) log(pending); }); }
    child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(`Build step ${script} failed: ${code}`)));
  });
  try {
    log('unsigned_candidate / 正式签名未启用 / 不自动发布');
    await run('prepare.cjs'); vendorManifest(output); await run('build-worker.cjs');
    const report = verify(output, version);
    const installer = `DesignExtractor-Personal-${version}-x64-Setup.exe`; const file = path.join(output, installer); const sha256 = digest(file);
    const metadata = { version, appId: 'com.designextractor.personal', productName: '去水印下载助手', architecture: 'x64', installer, sizeBytes: fs.statSync(file).size, sha256, state: 'unsigned_candidate', signatureStatus: 'NotSigned', signingEnabled: false, publisher: null, timestamp: null, builtAt: new Date().toISOString(), verificationReport: 'verification-report.json', vendorIntegrity: 'vendor-integrity.json', verifiedBinaries: report.files.length, windowsInstallAcceptance: 'not_executed', publication: 'not_published' };
    fs.writeFileSync(path.join(output, installer + '.sha256'), `${sha256}  ${installer}\n`);
    fs.writeFileSync(path.join(output, 'release-metadata.json'), JSON.stringify(metadata, null, 2));
    fs.writeFileSync(path.join(root, 'release/latest-candidate.json'), JSON.stringify({ version, directory: path.relative(root, output), state: 'unsigned_candidate' }, null, 2));
    log(JSON.stringify(metadata));
  } catch (error) { fs.writeFileSync(path.join(output, 'build-failure.json'), JSON.stringify({ state: 'build_failed', error: sanitize(error.message) })); throw error; }
}
main().catch(error => { console.error(sanitize(error.message)); process.exitCode = 1; });
