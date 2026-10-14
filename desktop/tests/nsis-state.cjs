const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { createDatabase } = require('../../server/database/sqlite');
async function run() {
  const [mode, filename] = process.argv.slice(2);
  const root = path.resolve(__dirname, '../../.desktop-build');
  if (!filename || !path.resolve(filename).startsWith(root + path.sep)) throw new Error('State artifact must be in build workspace');
  if (mode === 'seed') {
    const directory = path.join(process.env.APPDATA, 'DesignExtractorPersonal/personal');
    const state = { directory, clientId: `nsis-test-${crypto.randomUUID()}`, databasePath: path.join(directory, 'history.sqlite'), config: fs.readFileSync(path.join(directory, 'config.json'), 'utf8') };
    state.marker = path.join(directory, 'uploads', `${state.clientId}.txt`);
    state.markerContents = crypto.randomUUID();
    fs.mkdirSync(path.dirname(state.marker), { recursive: true });
    fs.writeFileSync(state.marker, state.markerContents);
    const db = createDatabase(state.databasePath);
    try { await db.query('INSERT INTO parse_records (original_url, client_id, pages_json, page_count) VALUES (?, ?, ?, ?)', ['https://example.com/nsis-retention-fixture', state.clientId, JSON.stringify([{ page: 1 }, { page: 2 }, { page: 3 }]), 3]); }
    finally { await db.end(); }
    fs.writeFileSync(filename, JSON.stringify(state, null, 2));
  } else {
    const state = JSON.parse(fs.readFileSync(filename));
    assert.equal(fs.readFileSync(path.join(state.directory, 'config.json'), 'utf8'), state.config);
    assert.equal(fs.readFileSync(state.marker, 'utf8'), state.markerContents);
    const db = createDatabase(state.databasePath);
    try {
      const [rows] = await db.query('SELECT * FROM parse_records WHERE client_id = ?', [state.clientId]);
      assert.equal(rows.length, 1); assert.equal(JSON.parse(rows[0].pages_json).length, 3);
      if (mode === 'clean') {
        await db.query('DELETE FROM parse_records WHERE client_id = ?', [state.clientId]);
        assert.equal(path.dirname(state.marker), path.join(state.directory, 'uploads'));
        assert.equal(path.basename(state.marker), `${state.clientId}.txt`);
        fs.unlinkSync(state.marker);
      }
    } finally { await db.end(); }
  }
  console.log(`NSIS user data ${mode} PASS`);
}
run().catch(error => { console.error(error); process.exitCode = 1; });
