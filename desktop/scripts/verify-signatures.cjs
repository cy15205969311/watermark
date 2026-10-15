const fs = require('node:fs');
const path = require('node:path');
const { verify, root } = require('./unsigned.cjs');
try {
  if (process.argv.includes('--release')) throw new Error('当前未启用正式签名');
  const report = verify(require('./artifact-paths.cjs').artifactDirectory(), JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version);
  console.log(JSON.stringify(report, null, 2));
} catch (error) { console.error(error.message); process.exitCode = 1; }
