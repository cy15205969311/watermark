const path = require('node:path');
module.exports = {
  appId: 'com.designextractor.personal', productName: '去水印下载助手',
  electronDist: path.resolve(__dirname, '../node_modules/electron/dist'),
  afterPack: async context => {
    // Windows scanners can briefly lock a freshly copied EXE before resource
    // editing. Wait finitely; never disable security software or skip metadata.
    const fs = require('node:fs/promises');
    const executable = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`);
    await new Promise(resolve => setTimeout(resolve, 2000));
    for (let attempt = 0; ; attempt++) {
      try { const handle = await fs.open(executable, 'r+'); await handle.close(); break; }
      catch (error) { if (!['EBUSY', 'EPERM'].includes(error.code) || attempt >= 12) throw error; await new Promise(resolve => setTimeout(resolve, 250)); }
    }
  },
  directories: { app: '.desktop-build/app', output: 'release' },
  artifactName: 'DesignExtractor-Personal-${version}-${arch}-Setup.${ext}',
  asar: true, asarUnpack: ['**/*.node', '**/node_modules/@img/**'],
  npmRebuild: false, // SQLite is built-in; Sharp uses its existing N-API win32 binary.
  files: ['desktop/**/*', 'server/**/*.js', 'client/**/*', 'package.json', 'node_modules/**/*', '!**/.env*', '!**/test*', '!**/uploads/**', '!**/*.map'],
  extraResources: [{ from: '.desktop-build/chromium', to: 'chromium', filter: ['**/*'] },
    { from: '.desktop-build/notices', to: 'licenses', filter: ['**/*'] }],
  win: { target: [{ target: 'nsis', arch: ['x64'] }], icon: path.join(__dirname, 'assets/icon.ico'), signExecutable: false },
  nsis: { oneClick: false, perMachine: false, allowElevation: true, selectPerMachineByDefault: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: 'always', createStartMenuShortcut: true, deleteAppDataOnUninstall: false,
    runAfterFinish: true, installerLanguages: ['zh_CN'], displayLanguageSelector: false,
    shortcutName: '去水印下载助手',
    license: path.join(__dirname, 'installer/使用协议.txt'),
    script: path.join(__dirname, 'installer/installer.nsi') },
};
