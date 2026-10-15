// Native NSIS file-operation fixture only: never registers/installs the app,
// elevates, or reads personal data. Runs the production removal/rollback code.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const buildRoot = path.join(root, '.desktop-build');
const directory = fs.mkdtempSync(path.join(buildRoot, 'download-retention-'));
assert.equal(path.dirname(directory), buildRoot);
const cache = path.join(process.env.LOCALAPPDATA, 'electron-builder/Cache');
const parent = path.join(cache, fs.readdirSync(cache).find(n => n.startsWith('nsis-3.0.4.1')));
const distribution = fs.readdirSync(parent).find(n => fs.existsSync(path.join(parent, n, 'Bin/makensis.exe')));
const compiler = path.join(parent, distribution, 'Bin/makensis.exe');
require('../scripts/nsis-templates.cjs').prepareNsisTemplates(root);
const generated = fs.readFileSync(path.join(buildRoot, 'nsis/uninstaller.nsh'), 'utf8');
const functions = generated.slice(generated.indexOf('Function un.atomicRMDir'), generated.indexOf('!ifndef UNINSTALL_SECTION_NAME'));
const quote = value => '"' + value.replace(/\$/g, '$$$$').replace(/"/g, '$\\"') + '"';
const seed = name => {
  const dir = path.join(directory, name); fs.mkdirSync(path.join(dir, 'resources'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'Downloads/nested'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'app.exe'), 'program'); fs.writeFileSync(path.join(dir, 'resources/app.asar'), 'program resources');
  fs.mkdirSync(path.join(dir, 'personal/users/S-1-5-21-123/uploads'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'personal/users/S-1-5-21-123/history.sqlite'), 'keep history bytes');
  fs.writeFileSync(path.join(dir, 'Downloads/nested/用户 GIF.gif'), 'keep download bytes'); return dir;
};
const upgrade = seed('upgrade 中文 Path'); const normal = seed('uninstall 中文 Path');
fs.writeFileSync(path.join(directory, 'parent-sentinel'), 'keep parent');
const generator = path.join(directory, 'generate.exe'); const uninstaller = path.join(directory, 'fixture.exe'); const report = path.join(directory, 'results.txt');
const nsi = path.join(directory, 'fixture.nsi');
fs.writeFileSync(nsi, '\ufeff' + [
  'Unicode true', '!include LogicLib.nsh', '!define UNINSTALL_FILENAME "Uninstall.exe"', 'Name "No-install download retention fixture"',
  `OutFile ${quote(generator)}`, 'RequestExecutionLevel user', 'SilentInstall silent', 'SilentUnInstall silent',
  functions, `!include ${quote(path.join(root, 'desktop/installer/keep-downloads.nsh'))}`,
  'Section', `WriteUninstaller ${quote(uninstaller)}`, 'SectionEnd',
  'Section "Uninstall"', 'InitPluginsDir', 'SetOutPath "$TEMP"', `FileOpen $9 ${quote(report)} w`,
  `StrCpy $INSTDIR ${quote(upgrade)}`, 'CreateDirectory "$PLUGINSDIR\\old-install"', 'Push ""', 'Call un.atomicRMDir', 'Pop $R0',
  'StrCmp $R0 0 +3', 'FileWrite $9 "FAIL atomic staging$\\r$\\n"', 'Abort',
  'IfFileExists "$INSTDIR\\Downloads\\nested\\*.*" +3', 'FileWrite $9 "FAIL Downloads moved$\\r$\\n"', 'Abort',
  'IfFileExists "$PLUGINSDIR\\old-install\\app.exe" +3', 'FileWrite $9 "FAIL program not staged$\\r$\\n"', 'Abort',
  'Push ""', 'Call un.restoreFiles', 'Pop $R0',
  'IfFileExists "$INSTDIR\\app.exe" +3', 'FileWrite $9 "FAIL rollback$\\r$\\n"', 'Abort',
  'Push ""', 'Call un.atomicRMDir', 'Pop $R0', 'Call un.RemoveProgramFilesKeepingDownloads',
  `StrCpy $INSTDIR ${quote(normal)}`, 'Call un.RemoveProgramFilesKeepingDownloads',
  'FileWrite $9 "PASS atomic upgrade staging, rollback and normal removal preserve Downloads$\\r$\\n"', 'FileClose $9', 'SectionEnd',
].join('\n'));
for (const [command, args] of [[compiler, ['/V2', nsi]], [generator, []], [uninstaller, ['/S', '_?=' + directory]]]) {
  const result = spawnSync(command, args, { windowsHide: true, encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, result.stdout + result.stderr + (result.error?.message || ''));
}
assert.match(fs.readFileSync(report, 'utf8'), /^PASS/);
for (const target of [upgrade, normal]) {
  assert.deepEqual(fs.readdirSync(target), ['Downloads', 'personal']);
  assert.equal(fs.readFileSync(path.join(target, 'personal/users/S-1-5-21-123/history.sqlite'), 'utf8'), 'keep history bytes');
  assert.equal(fs.readFileSync(path.join(target, 'Downloads/nested/用户 GIF.gif'), 'utf8'), 'keep download bytes');
}
assert.equal(fs.readFileSync(path.join(directory, 'parent-sentinel'), 'utf8'), 'keep parent');
const result = { passed: true, directory, productionNsisFunctionsExecuted: true, cases: ['atomic upgrade stages program only', 'rollback restores program', 'upgrade leaves Downloads and personal untouched', 'normal uninstall retains Downloads and SID history bytes', 'parent sentinel unchanged'], realApplicationInstallation: 'not_executed' };
fs.writeFileSync(path.join(root, 'server/test-artifacts/download-retention-native-results.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
