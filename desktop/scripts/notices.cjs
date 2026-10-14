const fs = require('node:fs');
const path = require('node:path');
function generateNotices(root, application) {
  const target = path.join(root, '.desktop-build/notices');
  fs.mkdirSync(target, { recursive: true });
  const packages = [];
  const texts = [];
  const visited = new Set();
  function scan(directory, component) {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const location = path.join(directory, entry.name);
      if (entry.name.startsWith('@')) { scan(location, component); continue; }
      const metadata = path.join(location, 'package.json');
      if (!fs.existsSync(metadata)) continue;
      const pkg = JSON.parse(fs.readFileSync(metadata, 'utf8'));
      const key = `${pkg.name}@${pkg.version}`;
      if (!visited.has(key)) {
        visited.add(key);
        const licenses = fs.readdirSync(location).filter(file => /^(license|licence|copying|notice)([.\-_]|$)/i.test(file) && fs.statSync(path.join(location, file)).isFile());
        packages.push({ component, name: pkg.name, version: pkg.version, license: pkg.license || pkg.licenses || 'not declared', noticeFiles: licenses });
        for (const file of licenses) texts.push(`\n===== ${key} / ${file} =====\n${fs.readFileSync(path.join(location, file), 'utf8')}\n`);
      }
      scan(path.join(location, 'node_modules'), component);
    }
  }
  scan(path.join(application, 'node_modules'), 'backend-runtime');
  scan(path.join(root, 'client/node_modules'), 'frontend-build');
  packages.sort((a, b) => a.name.localeCompare(b.name));
  fs.writeFileSync(path.join(target, 'dependencies.json'), JSON.stringify(packages, null, 2));
  fs.writeFileSync(path.join(target, 'THIRD-PARTY-NOTICES.txt'), texts.join(''));
  for (const [source, name] of [
    ['LICENSE', 'PROJECT-MIT.txt'], ['desktop/installer/使用协议.txt', '安装使用说明.txt'],
    ['desktop/installer/NOTICE.md', 'NOTICE.md'],
    ['node_modules/electron/dist/LICENSE', 'Electron-LICENSE'],
    ['node_modules/electron/dist/LICENSES.chromium.html', 'Electron-LICENSES.chromium.html'],
    ['node_modules/electron-builder/LICENSE', 'build-tool-electron-builder-LICENSE'],
  ]) fs.copyFileSync(path.join(root, source), path.join(target, name));
  console.log('License inventory generated:', packages.length);
}
module.exports = { generateNotices };
