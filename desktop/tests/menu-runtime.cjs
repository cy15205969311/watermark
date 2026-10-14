// Packaged Electron runtime checks; native click/screenshot acceptance is
// separately recorded through Computer Use, not inferred from these checks.
const assert = require('node:assert/strict');
async function verifyMenus(application, page) {
  // Electron resolves beforeunload via will-prevent-unload. Prevent Playwright
  // from also auto-dismissing the same Chromium dialog through CDP.
  const handleDialog = dialog => {
    if (dialog.type() !== 'beforeunload') void dialog.dismiss().catch(() => {});
  };
  page.on('dialog', handleDialog);
  const click = label => application.evaluate(({ Menu, BrowserWindow }, label) => {
    const item = Menu.getApplicationMenu().items.flatMap(i => i.submenu?.items || []).find(i => i.label === label);
    if (!item) throw new Error('Menu not found: ' + label);
    const window = BrowserWindow.getAllWindows()[0];
    item.click(item, window, window.webContents);
  }, label);
  const menu = await application.evaluate(({ Menu }) => Menu.getApplicationMenu().items.map(i => ({ label: i.label, items: i.submenu.items.map(j => ({ label: j.label, role: j.role, accelerator: j.accelerator })) })));
  assert.deepEqual(menu.map(i => i.label), ['应用', '编辑', '查看', '帮助']);
  for (const top of menu) for (const item of top.items) if (item.label) assert.match(item.label, /[\u4e00-\u9fff]/);
  const input = page.locator('textarea').first();
  await input.focus();
  await input.fill('菜单回归测试');
  await click('全选');
  assert.equal(await input.evaluate(el => el.selectionEnd - el.selectionStart), '菜单回归测试'.length);
  // Restore clipboard formats without logging or transmitting their contents.
  await application.evaluate(async ({ clipboard, ClipboardItem }) => {
    const items = await clipboard.read();
    globalThis.menuClipboardBackup = await Promise.all(items.map(async item => {
      const entries = await Promise.all(item.types.map(async type => [type, await item.getType(type)]));
      return new ClipboardItem(Object.fromEntries(entries));
    }));
  });
  try {
    await click('复制');
    assert.equal(await application.evaluate(({ clipboard }) => clipboard.readText()), '菜单回归测试');
    await click('剪切'); await page.waitForTimeout(100); assert.equal(await input.inputValue(), '');
    await click('粘贴'); await page.waitForTimeout(100); assert.equal(await input.inputValue(), '菜单回归测试');
    await click('撤销'); await page.waitForTimeout(100); assert.equal(await input.inputValue(), '');
    await click('重做'); await page.waitForTimeout(100); assert.equal(await input.inputValue(), '菜单回归测试');
    await page.keyboard.press('Control+a');
    assert.equal(await input.evaluate(el => el.selectionEnd - el.selectionStart), '菜单回归测试'.length);
    await page.keyboard.press('Control+x'); await page.waitForTimeout(100); assert.equal(await input.inputValue(), '');
    await page.keyboard.press('Control+v'); await page.waitForTimeout(100); assert.equal(await input.inputValue(), '菜单回归测试');
    await page.keyboard.press('Control+z'); await page.waitForTimeout(100); assert.equal(await input.inputValue(), '');
    await page.keyboard.press('Control+y'); await page.waitForTimeout(100); assert.equal(await input.inputValue(), '菜单回归测试');
    await page.keyboard.press('Control+a'); await page.keyboard.press('Control+c');
    assert.equal(await application.evaluate(({ clipboard }) => clipboard.readText()), '菜单回归测试');
  } finally {
    await application.evaluate(async ({ clipboard }) => { await clipboard.write(globalThis.menuClipboardBackup); delete globalThis.menuClipboardBackup; });
  }
  const zoom = () => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomLevel());
  await click('放大'); assert.ok(await zoom() > 0);
  await click('缩小'); assert.equal(await zoom(), 0);
  await click('放大'); await click('恢复默认缩放'); assert.equal(await zoom(), 0);
  // CDP keyboard dispatch bypasses native Windows menu accelerators. Zoom and
  // refresh accelerator acceptance is recorded via real Computer Use keys.
  await click('使用教程');
  await page.getByRole('dialog', { name: '使用教程' }).waitFor();
  await page.getByRole('button', { name: '我知道了' }).click();
  // Native dialogs and Explorer are replaced ONLY in the isolated test process
  // to keep automated callbacks bounded; real dialogs are verified manually.
  await application.evaluate(({ dialog, shell }) => {
    globalThis.menuTestOriginal = { sync: dialog.showMessageBoxSync, async: dialog.showMessageBox, open: shell.openPath };
    globalThis.menuTestCalls = { confirmations: [], messages: [], paths: [], response: 0 };
    dialog.showMessageBoxSync = (_window, options) => { menuTestCalls.confirmations.push(options); return menuTestCalls.response; };
    dialog.showMessageBox = async (_window, options) => { menuTestCalls.messages.push(options); return { response: 0 }; };
    shell.openPath = async p => { menuTestCalls.paths.push(p); return ''; };
  });
  let releaseExtraction;
  await page.route('**/api/extract-image', async route => {
    await new Promise(resolve => { releaseExtraction = resolve; });
    await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ success: false, message: '测试结束' }) });
  });
  try {
    await input.fill('https://818ps.com/?share_id=menu-regression');
    await page.getByRole('button', { name: '解析链接' }).click();
    await page.getByRole('button', { name: '解析中，请稍候…' }).waitFor();
    await page.evaluate(() => { window.menuReloadSentinel = true; });
    await click('刷新界面'); await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => window.menuReloadSentinel), true);
    assert.equal(await application.evaluate(() => menuTestCalls.confirmations.length), 1);
    // Direct reload invokes beforeunload and receives the same cancel policy.
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.reload());
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => window.menuReloadSentinel), true);
    assert.equal(await application.evaluate(() => menuTestCalls.confirmations.length), 2);
    releaseExtraction();
    await page.getByRole('button', { name: '解析链接' }).waitFor();
    await click('关于去水印下载助手');
    await click('打开日志文件夹'); await click('打开个人数据文件夹');
    const calls = await application.evaluate(() => ({ messages: menuTestCalls.messages, paths: menuTestCalls.paths }));
    assert.match(calls.messages[0].detail, /1\.1\.1[\s\S]*SQLite/);
    assert.equal(calls.paths.length, 2);
    const reloaded = page.waitForEvent('load');
    await click('刷新界面'); await reloaded;
    assert.equal(await page.evaluate(() => window.menuReloadSentinel), undefined);
  } finally {
    releaseExtraction?.(); await page.unroute('**/api/extract-image');
    await application.evaluate(({ dialog, shell }) => {
      dialog.showMessageBoxSync = menuTestOriginal.sync; dialog.showMessageBox = menuTestOriginal.async; shell.openPath = menuTestOriginal.open;
      delete globalThis.menuTestOriginal; delete globalThis.menuTestCalls;
    });
  }
  return { name: 'Packaged native Chinese menu roles, editing, zoom, tutorial and active extraction reload cancellation', menu, automatedDirectoryCallbacks: 'intercepted; real Explorer verification separate' };
}
module.exports = { verifyMenus };
