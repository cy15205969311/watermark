const path = require('node:path');

function contextTemplate(params) {
  const flags = params.editFlags || {};
  if (!params.isEditable) {
    return params.selectionText ? [{ label: '复制', role: 'copy', enabled: Boolean(flags.canCopy) }] : [];
  }
  return [
    { label: '撤销', role: 'undo', enabled: Boolean(flags.canUndo) },
    { label: '重做', role: 'redo', enabled: Boolean(flags.canRedo) },
    { type: 'separator' },
    { label: '剪切', role: 'cut', enabled: Boolean(flags.canCut) },
    { label: '复制', role: 'copy', enabled: Boolean(flags.canCopy) },
    { label: '粘贴', role: 'paste', enabled: Boolean(flags.canPaste) },
    { label: '全选', role: 'selectAll', enabled: Boolean(flags.canSelectAll) },
  ];
}

function installMenus({ app, Menu, dialog, shell, window, directory, isBusy, isQuitting = () => false }) {
  let confirming = false;
  let allowUnload = false;
  const confirmRefresh = () => {
    if (confirming) return false;
    confirming = true;
    try {
      return dialog.showMessageBoxSync(window, {
        type: 'warning', title: '任务正在进行',
        message: '正在解析、处理或下载资源，请等待任务完成。',
        detail: '刷新会丢失当前界面状态，尚未保存的结果可能无法恢复。',
        buttons: ['取消刷新', '仍然刷新'], defaultId: 0, cancelId: 0, noLink: true,
      }) === 1;
    } finally { confirming = false; }
  };
  const reload = () => {
    if (isBusy() && !confirmRefresh()) return;
    // beforeunload also protects F5, Ctrl+Shift+R and reloads outside this menu.
    allowUnload = true;
    window.webContents.reload();
  };
  window.webContents.on('did-finish-load', () => { allowUnload = false; });
  window.webContents.on('will-prevent-unload', event => {
    if (isQuitting() || allowUnload || confirmRefresh()) event.preventDefault();
    allowUnload = false;
  });
  const openDirectory = async target => {
    try {
      const error = await shell.openPath(target);
      if (error) throw new Error(error);
    } catch {
      await dialog.showMessageBox(window, {
        type: 'error', title: '无法打开文件夹', message: '文件夹暂时无法打开，请确认目录存在且有访问权限。', buttons: ['确定'],
      });
    }
  };
  const openLogs = () => openDirectory(path.join(directory, 'logs'));
  const template = [
    { label: '应用', submenu: [
      { label: '打开日志文件夹', click: openLogs },
      { label: '打开个人数据文件夹', click: () => openDirectory(directory) },
      { type: 'separator' },
      { label: '退出程序', accelerator: 'Alt+F4', click: () => app.quit() },
    ] },
    { label: '编辑', submenu: [
      { label: '撤销', role: 'undo', accelerator: 'Ctrl+Z' },
      { label: '重做', role: 'redo', accelerator: 'Ctrl+Y' },
      { type: 'separator' },
      { label: '剪切', role: 'cut', accelerator: 'Ctrl+X' },
      { label: '复制', role: 'copy', accelerator: 'Ctrl+C' },
      { label: '粘贴', role: 'paste', accelerator: 'Ctrl+V' },
      { label: '全选', role: 'selectAll', accelerator: 'Ctrl+A' },
    ] },
    { label: '查看', submenu: [
      { label: '刷新界面', accelerator: 'Ctrl+R', click: reload },
      { label: '恢复默认缩放', role: 'resetZoom', accelerator: 'Ctrl+0' },
      { label: '放大', role: 'zoomIn', accelerator: 'Ctrl+Plus' },
      { label: '缩小', role: 'zoomOut', accelerator: 'Ctrl+-' },
    ] },
    { label: '帮助', submenu: [
      { label: '使用教程', click: () => window.webContents.send('desktop:show-tutorial') },
      { label: '打开日志文件夹', click: openLogs },
      { type: 'separator' },
      { label: '关于去水印下载助手', click: () => dialog.showMessageBox(window, {
        type: 'info', title: '关于去水印下载助手', message: '去水印下载助手',
        detail: `个人版 ${app.getVersion()}\n桌面运行模式：Electron + SQLite\n项目按 MIT 许可证提供，第三方组件遵循各自开源许可。`,
        buttons: ['确定'],
      }) },
    ] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  window.webContents.on('context-menu', (_event, params) => {
    const items = contextTemplate(params);
    if (items.length) Menu.buildFromTemplate(items).popup({ window });
  });
}
module.exports = { installMenus, contextTemplate };
