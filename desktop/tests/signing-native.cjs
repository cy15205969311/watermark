// Paid signing tests are replaced by independent unsigned candidate verification.
// No cert/private key, signer, cloud provider or product installation is used.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { root } = require('../scripts/unsigned.cjs');
test('real Windows Authenticode reports NotSigned and rejects tampered vendor signatures', { skip: process.platform !== 'win32' }, () => {
  const directory = fs.mkdtempSync(path.join(root, '.desktop-build', 'unsigned-native-'));
  const original = path.join(root, 'node_modules/electron/dist/d3dcompiler_47.dll');
  const vendor = path.join(directory, 'vendor.dll'); fs.copyFileSync(original, vendor);
  const tampered = path.join(directory, 'tampered.dll'); const bytes = fs.readFileSync(original);
  const pe = bytes.readUInt32LE(60); const firstSection = pe + 24 + bytes.readUInt16LE(pe + 20);
  const rawData = bytes.readUInt32LE(firstSection + 20); bytes[rawData + 16] ^= 1; fs.writeFileSync(tampered, bytes);
  const unsigned = path.join(directory, 'unsigned.exe'); fs.copyFileSync(path.join(root, 'node_modules/electron/dist/electron.exe'), unsigned);
  // Electron distribution main executable is unsigned on this build; preserve
  // its bytes rather than synthesizing a misleading signature.
  fs.writeFileSync(path.join(directory, 'input.json'), JSON.stringify(['vendor.dll', 'tampered.dll', 'unsigned.exe']));
  const powershell = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const result = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'desktop/scripts/verify-unsigned.ps1'), '-OutputDirectory', directory, '-InputFile', path.join(directory, 'input.json'), '-ReportFile', path.join(directory, 'report.json')], { env: { ...process.env, PSModulePath: path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/Modules') }, windowsHide: true, encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(fs.readFileSync(path.join(directory, 'report.json'), 'utf8').replace(/^\uFEFF/, ''));
  assert.equal(report.files.find(f => f.file === 'unsigned.exe').status, 'NotSigned');
  assert.equal(report.files.find(f => f.file === 'vendor.dll').status, 'Valid');
  assert.notEqual(report.files.find(f => f.file === 'tampered.dll').status, 'Valid');
  assert.equal(report.passed, false);
});
