// Read-only audit. Reports locations/field names, never credential values;
// does not delete, untrack or rotate any existing user files.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const listed = spawnSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', windowsHide: true });
if (listed.status !== 0) throw new Error('TRACKED_FILE_AUDIT_UNAVAILABLE');
const tracked = listed.stdout.split('\0').filter(Boolean);
const credentialFiles = tracked.filter(file => /\.(pfx|p12|pvk|pem|key|snk|jks|keystore)$/i.test(file));
const privateKeyMarkers = [];
const trackedEnvironment = [];
for (const relative of tracked) {
  const file = path.join(root, relative);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile() || fs.statSync(file).size > 2 * 1024 * 1024) continue;
  const contents = fs.readFileSync(file, 'utf8');
  if (/-----BEGIN (?:RSA |EC |ENCRYPTED |OPENSSH )?PRIVATE KEY-----/.test(contents)) privateKeyMarkers.push(relative);
  if (/(^|\/)\.env(?:\.|$)/.test(relative)) {
    const fields = contents.split(/\r?\n/).map(line => line.match(/^\s*([A-Z0-9_]*(?:PASSWORD|SECRET|TOKEN|PRIVATE_KEY|API_KEY)[A-Z0-9_]*)\s*=\s*(.*?)\s*$/i)).filter(match => match && match[2] && !/^(?:['"]?\$\{|['"]?$|['"]?(?:your_|change_me|example|placeholder))/i.test(match[2])).map(match => match[1]);
    trackedEnvironment.push({ file: relative, possiblySensitiveAssignedFields: fields });
  }
}
const stagedCredentialFiles = [];
for (const base of ['.desktop-build/app', '.desktop-build/chromium', '.desktop-build/notices']) {
  const directory = path.join(root, base); if (!fs.existsSync(directory)) continue;
  const visit = current => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (/\.(pfx|p12|pvk|key|snk|jks|keystore)$/i.test(entry.name) || /^\.env/.test(entry.name)) stagedCredentialFiles.push(path.relative(root, file));
    }
  };
  visit(directory);
}
const report = { readOnly: true, credentialFiles, privateKeyMarkers, trackedEnvironment, stagedCredentialFiles, contentValuesPrinted: false, action: 'No files deleted or changed; review tracked environment history and rotate externally if needed' };
fs.mkdirSync(path.join(root, 'server/test-artifacts'), { recursive: true });
fs.writeFileSync(path.join(root, 'server/test-artifacts/signing-security-audit.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (credentialFiles.length || privateKeyMarkers.length || stagedCredentialFiles.length) process.exitCode = 1;
