const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
function loadConfiguration(userData) {
  const directory = path.join(userData, 'personal');
  fs.mkdirSync(directory, { recursive: true });
  const filename = path.join(directory, 'config.json');
  let config;
  if (fs.existsSync(filename)) {
    try { config = JSON.parse(fs.readFileSync(filename, 'utf8')); } catch { throw new Error('桌面配置损坏，请备份 personal/config.json 后修复，历史数据库未被修改'); }
    if (config.version !== 1 || typeof config.clientId !== 'string' || !config.clientId) throw new Error('桌面配置版本或历史身份无效，请从备份恢复 config.json');
  } else {
    config = { version: 1, clientId: crypto.randomUUID() };
    const temporary = `${filename}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(config, null, 2), { flag: 'w' });
    fs.renameSync(temporary, filename);
  }
  const temporaryDirectory = path.join(directory, 'temp');
  fs.mkdirSync(temporaryDirectory, { recursive: true });
  return { directory, temporaryDirectory, databasePath: path.join(directory, 'history.sqlite'), clientId: config.clientId };
}
module.exports = { loadConfiguration };
