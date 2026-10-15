const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const profile = fs.mkdtempSync(path.join(root, '.desktop-build', '桌面 main smoke '));
async function run() {
  const assert = require('node:assert/strict');
  const legacy = require('../config.cjs').loadConfiguration(path.join(profile, 'DesignExtractorPersonal'));
  const db = require('../../server/database/sqlite').createDatabase(legacy.databasePath); await db.end();
  fs.mkdirSync(path.join(legacy.directory, 'uploads'));
  fs.writeFileSync(path.join(legacy.directory, 'uploads/legacy-retain.txt'), 'legacy upload bytes');
  for (const extra of [[], ['--verify-persistence']]) {
    const result = spawnSync(require('electron'), [path.join(root, 'desktop/tests/main-smoke.cjs'), `--profile=${profile}`, ...extra], { cwd: root, stdio: 'inherit', windowsHide: true, timeout: 100000 });
    if (result.error || result.status !== 0) throw result.error || new Error(`Main smoke failed ${result.status}`);
  }
  assert.equal(JSON.parse(fs.readFileSync(path.join(profile, 'personal/config.json'))).clientId, legacy.clientId);
  assert.equal(fs.readFileSync(path.join(profile, 'personal/uploads/legacy-retain.txt'), 'utf8'), 'legacy upload bytes');
  assert.equal(fs.readFileSync(path.join(legacy.directory, 'uploads/legacy-retain.txt'), 'utf8'), 'legacy upload bytes');
  console.log('Actual main migration, process and restart smoke PASS', profile);
}
run().catch(error => { console.error(error); process.exitCode = 1; });
