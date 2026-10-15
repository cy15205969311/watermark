const { build, Platform, Arch } = require('electron-builder');
if (process.env.DESKTOP_MANAGED_BUILD !== 'true' || !process.env.DESKTOP_ARTIFACT_DIR) throw new Error('Managed output directory required');
// Normal custom NSIS compile, native WriteUninstaller; no signer or adapter.
build({ config: require('../builder.cjs'), targets: Platform.WINDOWS.createTarget(['nsis'], Arch.x64), publish: 'never' })
  .catch(error => { console.error(require('../logging.cjs').sanitize(error.message)); process.exit(1); });
