const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const cwd = path.resolve(__dirname, '../../server');
fs.mkdirSync(path.join(cwd, 'test-artifacts'), { recursive: true });
const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', 'test-gaoding-regression.js', 'test-818ps-regression.js'], { cwd, stdio: 'inherit', windowsHide: true });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
