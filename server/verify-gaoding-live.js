// Real HTTP extraction against the public share, isolated DB adapter for API boot.
const fs = require('fs');
const assert = require('assert/strict');
const axios = require('axios');
const mysql = require('mysql2/promise');
const browserService = require('./services/browser-pool');
const { redact } = require('./extractors/818ps-pages');
const verifyHistory = process.argv.includes('--history');
const records = [];
// All calls terminate in this adapter; no MySQL connection is created.
mysql.createPool = () => ({ getConnection: async () => ({ release() {} }), query: async (sql, values) => {
  if (sql.startsWith('SHOW')) return [[{ Type: 'varchar(32)' }]];
  if (verifyHistory && sql.startsWith('INSERT INTO parse_records')) {
    const id = records.length + 1;
    records.push({ id, original_url: values[0], platform: values[1], client_id: values[2], thumbnail_url: values[4], status: values[5],
      image_urls_json: values[6], pages_json: values[7], page_count: values[8], is_multi_page: values[9], extraction_metadata_json: values[10] });
    return [{ insertId: id }];
  }
  if (verifyHistory && sql.startsWith('SELECT') && sql.includes('FROM parse_records')) return [records.filter(r => r.client_id === values[0])];
  throw new Error('Live verification prohibits database writes');
} });
browserService.initDefaultPool = async () => ({ getStatus: () => ({ available: 0 }) });
async function main() {
  const { app } = require('./index');
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    const url = process.argv[2] || 'https://www.gaoding.com/dam/share/ZKZqaGEo5aMBudoBxbzCJ#我分享了「[现代风治愈文案旅游宣...]」，点击链接查看吧～';
    const r = await axios.post(`http://127.0.0.1:${server.address().port}/api/extract-image`, { url, platform: 'Gaoding' }, { timeout: 90000 });
    const prefix = process.argv.find(arg => arg.startsWith('--artifact-prefix='))?.split('=')[1] || 'gaoding-live';
    if (!/^[a-z0-9-]+$/.test(prefix)) throw new Error('Invalid artifact prefix');
    fs.writeFileSync(`test-artifacts/${prefix}-api.json`, JSON.stringify(r.data, null, 2));
    console.log(redact(JSON.stringify(r.data, null, 2)));
    if (verifyHistory && r.data.success) {
      const root = `http://127.0.0.1:${server.address().port}/api`, headers = { 'X-Client-Id': 'gaoding-live-isolated' };
      const saved = (await axios.post(`${root}/parse`, { ...r.data, url }, { headers })).data.data;
      const history = (await axios.get(`${root}/history`, { headers })).data.data[0];
      for (const record of [saved, history]) {
        assert.deepEqual(record.pages, r.data.pages); assert.deepEqual(record.imageUrls, r.data.imageUrls);
        assert.equal(record.pageCount, r.data.pageCount); assert.equal(record.completenessStatus, r.data.completenessStatus);
      }
      fs.writeFileSync(`test-artifacts/${prefix}-history.json`, JSON.stringify({ saved, history, database: 'isolated_in_memory' }, null, 2));
      console.log('history roundtrip', { pageCount: history.pageCount, completenessStatus: history.completenessStatus, database: 'isolated_in_memory' });
    }
  } finally { await browserService.closeDefaultPool(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
