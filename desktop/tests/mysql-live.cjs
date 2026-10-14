// Read-only connection/schema verification. Never imports index.js or runs migrations.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const dotenv = require(path.join(root, 'server/node_modules/dotenv'));
const protectedKeys = new Set(Object.keys(process.env));
const nodeEnv = process.env.NODE_ENV || '';
for (const name of [...new Set(['.env.production', '.env', '.env.local', nodeEnv && `.env.${nodeEnv}`, nodeEnv && `.env.${nodeEnv}.local`].filter(Boolean))]) {
  const file = path.join(root, 'server', name);
  if (fs.existsSync(file)) for (const [key, value] of Object.entries(dotenv.parse(fs.readFileSync(file)))) if (!protectedKeys.has(key)) process.env[key] = value;
}
async function verify() {
  const pool = require(path.join(root, 'server/database/mysql')).createDatabase({
    host: process.env.DB_HOST || 'localhost', user: process.env.DB_USER || '', password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'watermark_remover', connectTimeout: 5000,
  });
  try {
    const [ping] = await pool.query('SELECT 1 AS ok');
    const [columns] = await pool.query('SHOW COLUMNS FROM parse_records');
    const required = ['id', 'original_url', 'client_id', 'pages_json', 'image_urls_json', 'extraction_metadata_json', 'page_count', 'is_multi_page'];
    const missing = required.filter(name => !columns.some(column => column.Field === name));
    console.log(JSON.stringify({ mode: 'mysql', readOnly: true, connected: ping[0].ok === 1, columnCount: columns.length, missingColumns: missing }));
    if (missing.length) process.exitCode = 1;
  } finally { await pool.end(); }
}
verify().catch(error => { console.error(JSON.stringify({ mode: 'mysql', readOnly: true, success: false, code: error.code || 'unknown' })); process.exitCode = 1; });
