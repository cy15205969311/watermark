// Real HTTP extraction against the public share, isolated DB adapter for API boot.
const fs = require('fs');
const axios = require('axios');
const mysql = require('mysql2/promise');
const browserService = require('./services/browser-pool');
const { redact } = require('./extractors/818ps-pages');
mysql.createPool = () => ({ getConnection: async () => ({ release() {} }), query: async sql => {
  if (sql.startsWith('SHOW')) return [[{ Type: 'varchar(32)' }]];
  throw new Error('Live verification prohibits database writes');
} });
browserService.initDefaultPool = async () => ({ getStatus: () => ({ available: 0 }) });
async function main() {
  const { app } = require('./index');
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    const url = process.argv[2] || 'https://www.gaoding.com/dam/share/ZKZqaGEo5aMBudoBxbzCJ#我分享了「[现代风治愈文案旅游宣...]」，点击链接查看吧～';
    const r = await axios.post(`http://127.0.0.1:${server.address().port}/api/extract-image`, { url, platform: 'Gaoding' }, { timeout: 90000 });
    fs.writeFileSync('test-artifacts/gaoding-live-api.json', JSON.stringify(r.data, null, 2));
    console.log(redact(JSON.stringify(r.data, null, 2)));
  } finally { await browserService.closeDefaultPool(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
