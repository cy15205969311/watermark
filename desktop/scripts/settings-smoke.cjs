// Real Electron/Vue runtime; native chooser/confirmation responses are injected
// only in this isolated process. This does not validate Windows installation UI.
const { _electron } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
const profile = fs.mkdtempSync(path.join(root, '.desktop-build', 'settings-profile-'));
const artifacts = path.join(root, 'server/test-artifacts');
const results = []; let application;
async function main() {
  application = await _electron.launch({ executablePath: require('electron'), args: [path.join(root, 'desktop/tests/settings-bootstrap.cjs'), '--profile=' + profile], timeout: 60000 });
  const page = await application.firstWindow(); await page.waitForLoadState('networkidle');
  results.push(...await require('../tests/settings-runtime.cjs').verifySettings(application, page, profile, artifacts));
}
main().catch(error => { console.error(error.stack); results.push({ passed: false, error: error.message }); process.exitCode = 1; }).finally(async () => {
  if (application) await application.close();
  fs.writeFileSync(path.join(artifacts, '120-settings-runtime.json'), JSON.stringify({ profile, results, nativeDialogs: 'injected in isolated process; manual acceptance not executed', realInstallAcceptance: 'not_executed' }, null, 2));
  console.log(JSON.stringify(results, null, 2));
});
