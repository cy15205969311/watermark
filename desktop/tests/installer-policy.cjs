const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const root = path.resolve(__dirname, '../..');
const config = require('../builder.cjs');
const wizard = fs.readFileSync(path.join(root, 'desktop/installer/wizard.nsh'), 'utf8');
const installer = fs.readFileSync(config.nsis.script, 'utf8');
test('stable identity and explicit assisted, current-user default with elevation', () => {
  assert.equal(config.appId, 'com.designextractor.personal');
  assert.equal(config.nsis.oneClick, false); assert.equal(config.nsis.perMachine, false);
  assert.equal(config.nsis.allowElevation, true); assert.equal(config.nsis.selectPerMachineByDefault, false);
  assert.deepEqual(config.nsis.installerLanguages, ['zh_CN']);
  assert.equal(config.nsis.deleteAppDataOnUninstall, false);
  assert.match(fs.readFileSync(path.join(root, 'desktop/main.cjs'), 'utf8'), /app\.getPath\('appData'\), 'DesignExtractorPersonal'/);
});
test('compiled script declares ordered wizard pages and explicit license checkbox', () => {
  const pages = ['MUI_PAGE_WELCOME', 'licensePage', 'Page custom ScopePage ScopeLeave', 'Page custom DirectoryPage DirectoryLeave', 'Page custom ShortcutPage ShortcutLeave', 'MUI_PAGE_INSTFILES', 'MUI_PAGE_FINISH'];
  let position = wizard.indexOf('!insertmacro MUI_PAGE_WELCOME');
  for (const page of pages) { const next = wizard.indexOf(page, position); assert.ok(next >= position, page); position = next + page.length; }
  assert.match(wizard, /!define MUI_LICENSEPAGE_CHECKBOX/);
  const license = fs.readFileSync(config.nsis.license);
  assert.equal(license.subarray(0, 3).toString('hex'), 'efbbbf');
  assert.match(license.toString(), /不替代项目原有 MIT/);
  assert.match(license.toString(), /Permission is hereby granted/);
});
test('scope conflict blocks before upgrade removal; preflight runs after elevation', () => {
  const section = installer.slice(installer.indexOf('Section "install"'));
  assert.ok(section.indexOf('Call CheckScopeConflict') < section.indexOf('Call EnsureMachineElevation'));
  assert.ok(section.indexOf('Call ValidateDirectory') > section.indexOf('Call EnsureMachineElevation'));
  assert.ok(section.indexOf('Call ValidateDirectory') < section.indexOf('installSection.nsh'));
  assert.match(wizard, /SetErrorLevel 1638/);
  assert.match(wizard, /ReadRegStr \$OriginalUserInstall HKCU/);
  assert.match(wizard, /ReadRegStr \$OriginalMachineInstall HKLM/);
  assert.match(wizard, /DriveSpace/); assert.match(wizard, /FileOpen/);
});
test('uninstaller has no app-specific recursive deletion; dangerous delete flag rejected', () => {
  assert.doesNotMatch(wizard, /RMDir\s+\/r/i);
  assert.match(wizard, /customUnInit[\s\S]*isDeleteAppData[\s\S]*SetErrorLevel 87/);
  assert.match(wizard, /本版本不提供自动清空个人数据功能/);
});

test('explicit scope and directory intent survive elevation; cancel cannot copy files', () => {
  const leave = wizard.slice(wizard.indexOf('Function ScopeLeave'), wizard.indexOf('Function DirectoryPage'));
  assert.ok(leave.indexOf('Call CheckScopeConflict') < leave.indexOf('Call EnsureMachineElevation'));
  assert.match(wizard, /UAC_AsUser_GetGlobalVar \$installScope/);
  assert.match(wizard, /UAC_AsUser_GetGlobalVar \$CustomDirectory/);
  assert.match(wizard, /UAC_AsUser_GetGlobalVar \$OriginalUserInstall/);
  assert.match(wizard, /\$0 == 1223[\s\S]*uac_cancelled/);
  assert.match(wizard, /Function ScopeChanged[\s\S]*Call ApplyInstallScope/);
  assert.match(installer, /\$ScopeCommitted != \$installScope/);
  assert.doesNotMatch(installer.slice(installer.indexOf('Function .onInit'), installer.indexOf('!include "installUtil.nsh"')), /!insertmacro initMultiUser/);
});
test('native uninstaller generated and vendor version pinned', () => {
  require('../scripts/nsis-templates.cjs').prepareNsisTemplates(root);
  const generated = fs.readFileSync(path.join(root, '.desktop-build/nsis/installer-helpers.nsh'), 'utf8');
  assert.match(generated, /WriteUninstaller "\$INSTDIR\\\$\{UNINSTALL_FILENAME\}"/);
  assert.doesNotMatch(generated, /File "\/oname=\$\{UNINSTALL_FILENAME\}"/);
  assert.match(installer, /!include "\$\{PROJECT_DIR\}\\.desktop-build\\nsis\\uninstaller.nsh"/);
  const uninstaller = fs.readFileSync(path.join(root, '.desktop-build/nsis/uninstaller.nsh'), 'utf8');
  assert.match(uninstaller, /StrCmp \$R2 "Downloads" continue/);
  assert.match(uninstaller, /StrCmp \$R2 "personal" continue/);
  assert.match(uninstaller, /Call un.RemoveProgramFilesKeepingDownloads/);
  assert.doesNotMatch(uninstaller, /RMDir \/r \$INSTDIR/);
});

test('personal permissions are scoped, persisted and provisioned before launch; old unsafe uninstallers block', () => {
  assert.match(wizard, /Call ProvisionPersonalStorage[\s\S]*WriteINIStr "\$INSTDIR\\storage-layout.ini" "storage" "scope" "\$installScope"/);
  assert.match(installer, /Call PreparePersonalStorage[\s\S]*installSection.nsh/);
  assert.match(wizard, /旧卸载程序尚未登记保留 personal/);
  const script = fs.readFileSync(path.join(root, 'desktop/installer/storage-permissions.ps1'), 'utf8');
  assert.match(script, /ReadAndExecute,CreateDirectories/);
  assert.match(script, /SetAccessRuleProtection\(\$true, \$false\)/);
  assert.doesNotMatch(script, /Remove-Item|\/T|AllDirectories/);
});
test('third-party licenses included without credentials or user data', () => {
  const directory = path.join(root, '.desktop-build/notices');
  const dependencies = JSON.parse(fs.readFileSync(path.join(directory, 'dependencies.json')));
  assert.ok(dependencies.some(pkg => pkg.name === 'puppeteer' && pkg.version === '21.11.0'));
  for (const file of ['PROJECT-MIT.txt', 'Electron-LICENSE', 'Electron-LICENSES.chromium.html', 'THIRD-PARTY-NOTICES.txt', 'build-tool-electron-builder-LICENSE']) assert.ok(fs.statSync(path.join(directory, file)).size > 0);
});
