const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { installMenus, contextTemplate } = require('../menus.cjs');

test('context actions use actual Chromium edit flags; read-only and images stay scoped', () => {
  const flags = { canUndo: true, canRedo: false, canCut: false, canCopy: true, canPaste: false, canSelectAll: true };
  const items = contextTemplate({ isEditable: true, editFlags: flags });
  assert.deepEqual(items.filter(i => i.role).map(i => [i.label, i.enabled]), [
    ['撤销', true], ['重做', false], ['剪切', false], ['复制', true], ['粘贴', false], ['全选', true],
  ]);
  assert.deepEqual(contextTemplate({ isEditable: false, mediaType: 'image', editFlags: {} }), []);
  assert.deepEqual(contextTemplate({ isEditable: false, selectionText: 'text', editFlags: { canCopy: true } }), [{ label: '复制', role: 'copy', enabled: true }]);
});

test('refresh protects tasks, unload alternative and quit; real menu callbacks are connected', async () => {
  const contents = new EventEmitter();
  let reloads = 0, busy = true, quitting = false, confirmation = 0, template;
  const opened = [], messages = [], sent = [];
  contents.reload = () => { reloads++; };
  contents.send = (...args) => sent.push(args);
  const window = { webContents: contents };
  let quit = false;
  const app = { quit: () => { quit = true; }, getVersion: () => '1.1.1' };
  installMenus({ app, Menu: { setApplicationMenu: () => {}, buildFromTemplate: t => { template = t; return { popup: () => {} }; } },
    dialog: { showMessageBoxSync: () => confirmation, showMessageBox: async (_window, message) => { messages.push(message); } },
    shell: { openPath: async p => { opened.push(p); return ''; } }, window, directory: 'E:\\isolated', isBusy: () => busy, isQuitting: () => quitting });
  assert.deepEqual(template.map(i => i.label), ['应用', '编辑', '查看', '帮助']);
  assert.deepEqual(template[1].submenu.filter(i => i.role).map(i => [i.label, i.role, i.accelerator]), [
    ['撤销', 'undo', 'Ctrl+Z'], ['重做', 'redo', 'Ctrl+Y'], ['剪切', 'cut', 'Ctrl+X'],
    ['复制', 'copy', 'Ctrl+C'], ['粘贴', 'paste', 'Ctrl+V'], ['全选', 'selectAll', 'Ctrl+A'],
  ]);
  assert.deepEqual(template[2].submenu.map(i => i.accelerator), ['Ctrl+R', 'Ctrl+0', 'Ctrl+Plus', 'Ctrl+-']);
  for (const menu of template) for (const item of menu.submenu) if (item.type !== 'separator') assert.match(item.label, /[\u4e00-\u9fff]/);
  const refresh = template[2].submenu[0];
  assert.equal(refresh.accelerator, 'Ctrl+R');
  refresh.click(); assert.equal(reloads, 0);
  confirmation = 1; refresh.click(); assert.equal(reloads, 1);
  contents.emit('did-finish-load');
  let prevented = false;
  confirmation = 0; contents.emit('will-prevent-unload', { preventDefault: () => { prevented = true; } }); assert.equal(prevented, false);
  confirmation = 1; contents.emit('will-prevent-unload', { preventDefault: () => { prevented = true; } }); assert.equal(prevented, true);
  busy = false; refresh.click(); assert.equal(reloads, 2);
  quitting = true; confirmation = 0; prevented = false;
  contents.emit('will-prevent-unload', { preventDefault: () => { prevented = true; } }); assert.equal(prevented, true);
  await template[0].submenu[0].click(); await template[0].submenu[1].click();
  assert.equal(opened.length, 2);
  template[3].submenu[0].click(); assert.deepEqual(sent, [['desktop:show-tutorial']]);
  await template[3].submenu[3].click(); assert.match(messages[0].detail, /1\.1\.1[\s\S]*SQLite/);
  template[0].submenu[3].click(); assert.equal(quit, true);
  assert.equal(contents.listenerCount('context-menu'), 1);
});
