const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const profile = fs.mkdtempSync(path.join(root, '.desktop-build', '桌面 main smoke '));
for (const extra of [[], ['--verify-persistence']]) {
  const result = spawnSync(require('electron'), [path.join(root, 'desktop/tests/main-smoke.cjs'), `--profile=${profile}`, ...extra], { cwd: root, stdio: 'inherit', windowsHide: true, timeout: 100000 });
  if (result.error || result.status !== 0) throw result.error || new Error(`Main smoke failed ${result.status}`);
}
console.log('Actual main process and restart smoke PASS', profile);
