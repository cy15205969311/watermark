// Real native-UI assertions. Invoke from node_repl with the Computer Use sky
// client, following observe -> inspect -> one action -> observe. No terminal
// UI automation, UAC automation, or guessed element IDs are used here.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
function createSession(sky, artifactDirectory) {
  let window;
  let state;
  const records = [];
  fs.mkdirSync(artifactDirectory, { recursive: true });
  return {
    async bind(executable) {
      const matches = (await sky.list_windows()).filter(w => w.app.toLowerCase() === `process:${path.resolve(executable)}`.toLowerCase());
      assert.equal(matches.length, 1, 'Expected one returned installer window');
      window = await sky.get_window(matches[0]);
    },
    async observe(label) {
      state = await sky.get_window_state({ window, include_text: true, include_screenshot: true });
      window = state.window;
      const record = { label, time: new Date().toISOString(), tree: state.accessibility?.tree || '' };
      records.push(record);
      fs.writeFileSync(path.join(artifactDirectory, 'observations.json'), JSON.stringify(records, null, 2));
      // Evidence for the test report, not an additional screenshot inspection.
      const screenshot = state.screenshots?.[0];
      const encoded = screenshot?.url?.match(/^data:image\/(png|jpeg);base64,(.+)$/s);
      if (encoded) fs.writeFileSync(path.join(artifactDirectory, `${records.length}.${encoded[1] === 'jpeg' ? 'jpg' : 'png'}`), Buffer.from(encoded[2], 'base64'));
      return record.tree;
    },
    assertPage(expression) { assert.match(state?.accessibility?.tree || '', expression); },
    assertLicenseBlocked() {
      const lines = (state?.accessibility?.tree || '').split('\n');
      assert.ok(lines.some(line => /按钮.*disabled.*下一步/.test(line)), 'Next must be disabled before accepting license');
      assert.ok(lines.some(line => /复选框.*我已阅读并接受/.test(line)), 'Explicit acceptance checkbox required');
    },
    async click(expression) {
      const matches = (state?.accessibility?.tree || '').split('\n').filter(line => expression.test(line));
      assert.equal(matches.length, 1, 'Expected one observed control');
      assert.doesNotMatch(matches[0], /disabled/);
      const index = Number(matches[0].match(/^\s*(\d+) /)?.[1]);
      assert.ok(Number.isInteger(index));
      const observed = state;
      state = null;
      await sky.click({ window: observed.window, element_index: index });
      return this.observe('after click');
    },
    async setDirectory(value) {
      const matches = (state?.accessibility?.tree || '').split('\n').filter(line => /编辑.*settable/.test(line));
      assert.equal(matches.length, 1);
      const index = Number(matches[0].match(/^\s*(\d+) /)?.[1]);
      const observed = state;
      state = null;
      await sky.set_value({ window: observed.window, element_index: index, value });
      return this.observe('after path input');
    },
  };
}
module.exports = { createSession };
