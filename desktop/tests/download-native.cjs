// Interactive native dialog acceptance on an isolated packaged-app copy.
// Run test:desktop:package -- --download-ui, operate dialogs using Computer Use.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
async function verifyNativeDownloads(application, page, executable, profile, artifacts) {
  const { buffer, dataUrl } = await require('./fixtures.cjs').animatedGif();
  const directory = path.join(path.dirname(executable), 'personal', 'Downloads');
  assert.ok(!fs.existsSync(directory), 'Test copy must start without Downloads');
  const status = await page.evaluate(() => window.desktop.getSettings());
  assert.equal(status.downloadDirectory, directory); assert.ok(!fs.existsSync(directory));
  const alternateDirectory = path.join(profile, '手动 保存位置'); fs.mkdirSync(alternateDirectory);
  const steps = [
    { name: 'native-default.gif', expected: path.join(directory, 'native-default.gif') },
    { name: 'native-manual.gif', expected: path.join(alternateDirectory, 'native-manual.gif') },
    { name: 'native-cancel.gif', cancel: true },
  ];
  const results = [];
  for (const step of steps) {
    fs.writeFileSync(path.join(artifacts, 'download-native-session.json'), JSON.stringify({ executable, profile, directory, step, results }, null, 2));
    await page.evaluate(({ dataUrl, name }) => {
      window.nativeSaveOutcome = null;
      void window.desktop.saveResource(dataUrl, name).then(value => { window.nativeSaveOutcome = value; }, error => { window.nativeSaveOutcome = { error: error.message }; });
    }, { dataUrl, name: step.name });
    console.log('NATIVE DOWNLOAD DIALOG READY', JSON.stringify(step));
    await page.waitForFunction(() => window.nativeSaveOutcome !== null, null, { timeout: 300000 });
    const outcome = await page.evaluate(() => window.nativeSaveOutcome);
    assert.ok(!outcome.error, outcome.error);
    if (step.cancel) { assert.equal(outcome.canceled, true); assert.ok(!fs.existsSync(path.join(directory, step.name))); }
    else {
      assert.equal(outcome.saved, true); assert.deepEqual(fs.readFileSync(step.expected), buffer);
      assert.equal(require('../../server/extractors/818ps-animation').parseGif(fs.readFileSync(step.expected)).frameCount, 2);
    }
    results.push({ ...step, outcome, passed: true });
  }
  assert.equal((await page.evaluate(() => window.desktop.getSettings())).downloadDirectory, directory, 'Manual selection must not persist as a custom directory');
  fs.writeFileSync(path.join(artifacts, 'download-native-results.json'), JSON.stringify({ executable, directory, profile, results, installationAcceptance: 'not_executed' }, null, 2));
  return results;
}
module.exports = { verifyNativeDownloads };
