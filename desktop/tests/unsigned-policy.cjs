const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { unsignedEnvironment } = require('../scripts/unsigned.cjs');
test('candidate environment disables discovery and removes signing-only inputs', () => {
  const env = unsignedEnvironment({ PATH: 'normal', CSC_LINK: 'secret', CSC_KEY_PASSWORD: 'secret', DESKTOP_SIGNING_PROVIDER: 'pfx', AZURE_CLIENT_SECRET: 'secret' });
  assert.equal(env.PATH, 'normal'); assert.equal(env.CSC_IDENTITY_AUTO_DISCOVERY, 'false');
  assert.ok(!JSON.stringify(env).includes('secret'));
  const builder = require('../builder.cjs'); assert.equal(builder.forceCodeSigning, false); assert.equal(builder.win.signExecutable, false); assert.equal(builder.afterSign, undefined);
});
test('release command explicitly fails before building, never silently signs or downgrades', () => {
  const result = spawnSync(process.execPath, [require.resolve('../scripts/dist.cjs'), 'release'], { encoding: 'utf8', windowsHide: true });
  assert.notEqual(result.status, 0); assert.match(result.stderr, /当前未启用正式签名/);
});
