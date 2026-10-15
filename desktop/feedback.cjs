const os = require('node:os');
const EMAIL = 'ad4928115@gmail.com';
const SUBJECT = '[DesignExtractor Personal] Bug 反馈';
function feedbackText({ version, errors = [], now = new Date() }) {
  // Never include raw messages, paths, URLs, history, client IDs or credentials.
  const categories = new Set(['browser_start_failed', 'desktop_operation_failed', 'backup_failed', 'restore_failed', 'diagnostics_failed', 'settings_failed']);
  const latest = errors.filter(e => categories.has(e.category)).at(-1);
  return `您好，我在使用 DesignExtractor Personal 时遇到了一个问题。\n\n软件版本：${/^\d+\.\d+\.\d+$/.test(version) ? version : ''}\n应用运行模式：桌面个人版 · Electron + SQLite\n操作系统版本：${os.platform()} ${os.release()} ${os.arch()}\n问题发生时间：${now.toISOString()}\n操作步骤：\n预期结果：\n实际结果：\n错误摘要：${latest?.category || ''}\n关联请求 ID（如有）：\n\n补充说明：\n请在此填写更多问题信息。\n\n请勿发送 Cookie、Token、密码、有效签名链接或私人图片。`;
}
function createFeedback({ version, dialog, shell, clipboard, window, errors = [] }) {
  let active = false;
  return async () => {
    if (active) return;
    active = true;
    try {
      const body = feedbackText({ version, errors });
      const choice = await dialog.showMessageBox(window, { type: 'info', title: '问题反馈 / 报告 Bug',
        message: `反馈邮箱：${EMAIL}`, detail: `${body}\n\n仅打开邮件草稿，由你编辑并发送。不会自动上传日志或发送邮件。若客户端未弹出，请重新打开此入口复制内容手动发送。`,
        buttons: ['取消', '打开邮件客户端', '复制邮箱与反馈内容'], defaultId: 0, cancelId: 0, noLink: true });
      if (choice.response === 2) { clipboard.writeText(`收件人：${EMAIL}\n主题：${SUBJECT}\n\n${body}`); return; }
      if (choice.response !== 1) return;
      try { await shell.openExternal(`mailto:${EMAIL}?subject=${encodeURIComponent(SUBJECT)}&body=${encodeURIComponent(body)}`); }
      catch {
        const fallback = await dialog.showMessageBox(window, { type: 'warning', title: '无法打开邮件客户端', message: `请手动发送至 ${EMAIL}`, detail: '可复制已脱敏的反馈模板，再粘贴到你使用的邮箱中。没有发送任何邮件或日志。', buttons: ['关闭', '复制邮箱与反馈内容'], defaultId: 0, cancelId: 0 });
        if (fallback.response === 1) clipboard.writeText(`收件人：${EMAIL}\n主题：${SUBJECT}\n\n${body}`);
      }
    } finally { active = false; }
  };
}
module.exports = { createFeedback, feedbackText, EMAIL, SUBJECT };
