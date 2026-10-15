const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { artifactDirectory } = require('./artifact-paths.cjs');
const root = path.resolve(__dirname, '../..');
const args = process.argv.slice(2);
const output = artifactDirectory();
const metadata = path.join(output, 'release-metadata.json');
const scripts = ['../tests/package-inspect.cjs', '../tests/packaged.cjs'];
// Resolve once so both checks and verification inspect the same artifact.
const forwarded = args.filter(arg => !arg.startsWith('--output='));
forwarded.push('--output=' + output);
if (fs.existsSync(metadata)) {
  const record = JSON.parse(fs.readFileSync(metadata));
  scripts.unshift('verify-signatures.cjs');
  if (record.state !== 'unsigned_candidate') throw new Error('Current package check accepts unsigned candidates only');
}
for (const script of scripts) {
  const result = spawnSync(process.execPath, [path.join(__dirname, script), ...forwarded], { cwd: root, stdio: 'inherit', windowsHide: true });
  if (result.error || result.status !== 0) { process.exitCode = result.status || 1; break; }
}
