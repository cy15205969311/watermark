// Execute the SAME functions as the production NSIS wizard. No installation,
// elevation, registration, or personal-data access; only a dedicated report.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
if (process.platform !== 'win32') throw new Error('Native installer tests require Windows');
const cache = path.join(process.env.LOCALAPPDATA, 'electron-builder/Cache');
const nsisDirectory = fs.readdirSync(cache).find(name => name.startsWith('nsis-3.0.4.1'));
assert.ok(nsisDirectory, 'NSIS cache missing; build the desktop package first');
const parent = path.join(cache, nsisDirectory);
const distribution = fs.readdirSync(parent).find(name => fs.existsSync(path.join(parent, name, 'Bin/makensis.exe')));
const compiler = path.join(parent, distribution, 'Bin/makensis.exe');
const directory = fs.mkdtempSync(path.join(root, '.desktop-build', 'installer-native-'));
const executable = path.join(directory, 'no-install-tests.exe');
const report = path.join(directory, 'results.txt');
const quote = value => '"' + value.replace(/\$/g, '$$$$').replace(/"/g, '$\\"') + '"';
const drive = root.slice(0, 3);
const unused = 'ZYXWVUTSRQPONMLKJIHGFDC'.split('').find(letter => !fs.existsSync(`${letter}:\\`));
const cases = [
  ['manual-root', drive, 'manual', `${drive}DesignExtractor Personal`, '', 'root_path_normalized'],
  ['browse-root', drive, 'browse', `${drive}DesignExtractor Personal`, '', 'root_path_normalized'],
  ['manual-parent', `${drive}Applications\\`, 'manual', `${drive}Applications\\DesignExtractor Personal`, '', 'parent_path_normalized'],
  ['browse-parent', `${drive}Applications`, 'browse', `${drive}Applications\\DesignExtractor Personal`, '', 'parent_path_normalized'],
  ['manual-product', `${drive}Applications\\DesignExtractor Personal`, 'manual', `${drive}Applications\\DesignExtractor Personal`, '', 'unchanged'],
  ['browse-product', `${drive}Applications\\DesignExtractor Personal`, 'browse', `${drive}Applications\\DesignExtractor Personal`, '', 'unchanged'],
  ['product-case-trailing', `${drive}Applications\\designextractor PERSONAL\\`, 'browse', `${drive}Applications\\designextractor PERSONAL`, '', 'unchanged'],
  ['complete-custom', `${drive}中文 空格\\我的程序`, 'manual', `${drive}中文 空格\\我的程序`, '', 'unchanged'],
  ['chinese-parent', `${drive}中文 空格\\`, 'manual', `${drive}中文 空格\\DesignExtractor Personal`, '', 'parent_path_normalized'],
  ['network', '\\\\server\\share', 'manual', null, 'network_path_rejected'],
  ['relative', 'Applications\\App', 'manual', null, 'invalid_path'],
  ['drive-relative', drive.slice(0, 2), 'manual', null, 'invalid_path'],
  ['unused-drive', `${unused}:\\App`, 'manual', null, 'invalid_path'],
  ['invalid-character', `${drive}App*`, 'manual', null, 'invalid_path'],
  ['dot-segment', `${drive}App\\..\\Other`, 'manual', null, 'invalid_path'],
  ['trailing-dot', `${drive}App.`, 'manual', null, 'invalid_path'],
  ['trailing-space', `${drive}App `, 'manual', null, 'invalid_path'],
  ['reserved-name', `${drive}con.txt`, 'manual', null, 'invalid_path'],
  ['reserved-port', `${drive}COM9`, 'manual', null, 'invalid_path'],
];
let assertions = 0;
const check = (name, variable, expected, expand = false) => {
  assertions++;
  return `!insertmacro Assert ${quote(name)} ${variable} ${expand ? '"' + expected + '"' : quote(expected)}\n`;
};
let body = '';
for (const [name, input, mode, expected, error, status] of cases) {
  body += `StrCpy $PathInput ${quote(input)}\nStrCpy $PathInputMode ${quote(mode)}\nCall NormalizeDirectory\n`;
  body += check(name + '-error', '$PathError', error);
  if (expected) body += check(name + '-path', '$NormalizedPath', expected);
  if (status) body += check(name + '-status', '$PathStatus', status);
}
body += 'StrCpy $installScope "user"\nStrCpy $DirectorySource "auto"\nSetShellVarContext current\nCall ResolveScopeDirectory\n';
body += check('user-default', '$INSTDIR', '$LOCALAPPDATA\\Programs\\DesignExtractor Personal', true);
body += 'StrCpy $installScope "machine"\nSetShellVarContext all\nCall ResolveScopeDirectory\n';
body += check('machine-default', '$INSTDIR', '$PROGRAMFILES64\\DesignExtractor Personal', true);
body += 'StrCpy $installScope "user"\nSetShellVarContext current\nCall ResolveScopeDirectory\n';
body += check('switch-back-default', '$INSTDIR', '$LOCALAPPDATA\\Programs\\DesignExtractor Personal', true);
body += `StrCpy $OriginalUserInstall ${quote(drive + 'Old User')}\nStrCpy $OriginalMachineInstall ${quote(drive + 'Old Machine')}\nStrCpy $DirectorySource "auto"\nCall ResolveScopeDirectory\n`;
body += check('registered-user', '$INSTDIR', drive + 'Old User');
body += 'StrCpy $installScope "machine"\nCall ResolveScopeDirectory\n';
body += check('registered-machine', '$INSTDIR', drive + 'Old Machine');
body += `StrCpy $DirectorySource "custom"\nStrCpy $CustomDirectory ${quote(drive + '中文 自定义')}\nStrCpy $installScope "user"\nCall ResolveScopeDirectory\nStrCpy $installScope "machine"\nCall ResolveScopeDirectory\n`;
body += check('custom-preserved-on-switch', '$INSTDIR', drive + '中文 自定义');
body += 'StrCpy $DirectorySource "default"\nCall ResolveScopeDirectory\n';
body += check('explicit-reset-ignores-registration', '$INSTDIR', '$PROGRAMFILES64\\DesignExtractor Personal', true);
body += 'Call ClassifyScopeConflict\n';
body += check('both-registrations-machine-blocked', '$ScopeConflict', 'existing_install_conflict');
body += 'StrCpy $installScope "user"\nCall ClassifyScopeConflict\n';
body += check('both-registrations-user-blocked', '$ScopeConflict', 'existing_install_conflict');
body += 'StrCpy $OriginalMachineInstall ""\nCall ClassifyScopeConflict\n';
body += check('same-user-upgrade-allowed', '$ScopeConflict', '');
body += 'StrCpy $installScope "machine"\nCall ClassifyScopeConflict\n';
body += check('user-to-machine-blocked', '$ScopeConflict', 'existing_install_conflict');
body += 'StrCpy $OriginalUserInstall ""\nStrCpy $ElevatedUserInstall ""\nCall ClassifyScopeConflict\n';
body += check('fresh-machine-allowed', '$ScopeConflict', '');
body += `StrCpy $OriginalMachineInstall ${quote(drive + 'Old Machine')}\nCall ClassifyScopeConflict\n`;
body += check('same-machine-upgrade-allowed', '$ScopeConflict', '');
body += 'StrCpy $installScope "user"\nCall ClassifyScopeConflict\n';
body += check('machine-to-user-blocked', '$ScopeConflict', 'existing_install_conflict');
body += 'StrCpy $installScope "machine"\nStrCpy $ElevatedUserInstall "admin-account-old-user"\nCall ClassifyScopeConflict\n';
body += check('elevated-account-conflict-blocked', '$ScopeConflict', 'existing_install_conflict');
const lines = [
  'Unicode true', 'Name "Installer no-install tests"', `OutFile ${quote(executable)}`,
  'RequestExecutionLevel user', 'SilentInstall silent',
  `!include ${quote(path.join(root, 'desktop/installer/path-state.nsh'))}`,
  '!macro Assert name actual expected',
  '  StrCmp "${actual}" "${expected}" +3',
  '  FileWrite $9 "FAIL: ${name} actual=[${actual}] expected=[${expected}]$\\r$\\n"',
  '  IntOp $8 $8 + 1', '!macroend', 'Section',
  `  FileOpen $9 ${quote(report)} w`, '  StrCpy $8 0', body,
  `  FileWrite $9 "assertions=${assertions}; failures=$8$\\r$\\n"`,
  '  FileClose $9', '  SetErrorLevel $8', 'SectionEnd',
];
const nsi = path.join(directory, 'test.nsi');
fs.writeFileSync(nsi, '\ufeff' + lines.join('\n'));
const compiled = spawnSync(compiler, ['/V2', nsi], { encoding: 'utf8', timeout: 30000 });
assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
const executed = spawnSync(executable, [], { windowsHide: true, timeout: 30000 });
const output = fs.readFileSync(report, 'utf8');
assert.equal(executed.status, 0, output);
const result = { passed: true, assertions, output: output.trim(), executable, realInstallation: 'not executed' };
fs.writeFileSync(path.join(root, 'server/test-artifacts/installer-native-results.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
