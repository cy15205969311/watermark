// Keep electron-builder's archive extraction and upgrade logic intact, but
// generate a native one-pass uninstaller for our custom script (no signing).
const fs = require('node:fs');
const path = require('node:path');
function prepareNsisTemplates(root) {
  const metadata = require('app-builder-lib/package.json');
  if (metadata.version !== '26.15.3') throw new Error('Review NSIS template integration before changing electron-builder');
  const directory = path.join(root, '.desktop-build/nsis');
  fs.mkdirSync(directory, { recursive: true });
  const templates = path.join(path.dirname(require.resolve('app-builder-lib/package.json')), 'templates/nsis');
  function transform(source, target, search, replacement) {
    const contents = fs.readFileSync(path.join(templates, source), 'utf8');
    if (contents.split(search).length !== 2) throw new Error(`NSIS template changed: ${source}`);
    fs.writeFileSync(path.join(directory, target), contents.replace(search, replacement));
  }
  transform('installSection.nsh', 'installSection.nsh', '!include installer.nsh', '!include "${PROJECT_DIR}\\.desktop-build\\nsis\\installer-helpers.nsh"');
  transform('include/installer.nsh', 'installer-helpers.nsh', 'File "/oname=${UNINSTALL_FILENAME}" "${UNINSTALLER_OUT_FILE}"', 'WriteUninstaller "$INSTDIR\\${UNINSTALL_FILENAME}"');
  const running = fs.readFileSync(path.join(templates, 'include/allowOnlyOneInstallerInstance.nsh'), 'utf8');
  fs.writeFileSync(path.join(directory, 'allowOnlyOneInstallerInstance.nsh'), running.replace(/Var \/GLOBAL (\w+)([^\r\n]*)/g, (_, name, comment) => `!ifndef PERSONAL_VAR_${name}\n!define PERSONAL_VAR_${name}\nVar /GLOBAL ${name}${comment}\n!endif`));
}
module.exports = { prepareNsisTemplates };
