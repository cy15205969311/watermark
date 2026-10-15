const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
function artifactDirectory() {
  const requested = process.argv.find(arg => arg.startsWith('--output='))?.slice(9) || process.env.DESKTOP_TEST_ARTIFACT_DIR;
  if (requested) return path.resolve(root, requested);
  const latest = path.join(root, 'release/latest-candidate.json');
  if (fs.existsSync(latest)) return path.resolve(root, JSON.parse(fs.readFileSync(latest)).directory);
  return path.join(root, 'release'); // Historic unmodified candidates remain usable.
}
module.exports = { artifactDirectory };
