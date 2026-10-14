const fs = require('node:fs');
const path = require('node:path');

function databaseError(error) {
  const message = String(error.message || '');
  const hint = /full|ENOSPC/i.test(message) ? '磁盘空间不足，请清理空间后重试' :
    /malformed|corrupt|not a database/i.test(message) ? '历史数据库损坏，请退出应用并从备份恢复' :
    /readonly|permission|EACCES|unable to open/i.test(message) ? '无法写入历史数据库，请检查数据目录权限' :
    /locked|busy/i.test(message) ? '历史数据库正在使用，请稍后重试' : '历史数据库读写失败，请查看桌面日志';
  const wrapped = new Error(hint, { cause: error });
  wrapped.code = error.code;
  return wrapped;
}

function createDatabase(filename) {
  if (!path.isAbsolute(filename)) throw new Error('SQLite requires an absolute userData path');
  let db;
  try {
    const { DatabaseSync } = require('node:sqlite');
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    db = new DatabaseSync(filename);
    db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
    const version = db.prepare('PRAGMA user_version').get().user_version;
    if (version > 1) throw new Error('数据库版本高于应用支持版本，请使用较新的应用');
    if (version < 1) {
      db.exec(`BEGIN IMMEDIATE;
        CREATE TABLE IF NOT EXISTS parse_records (
          id INTEGER PRIMARY KEY AUTOINCREMENT, original_url TEXT NOT NULL,
          platform TEXT DEFAULT 'Unknown', client_id TEXT, client_ip TEXT,
          thumbnail_url TEXT, status TEXT NOT NULL DEFAULT 'success',
          image_urls_json TEXT, pages_json TEXT, extraction_metadata_json TEXT,
          page_count INTEGER DEFAULT 1, is_multi_page INTEGER NOT NULL DEFAULT 0,
          created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
          updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
        );
        CREATE INDEX IF NOT EXISTS idx_history_client_created ON parse_records(client_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_history_platform ON parse_records(platform);
        PRAGMA user_version = 1;
        COMMIT;`);
    }
  } catch (error) {
    if (db) { try { db.exec('ROLLBACK'); } catch {} try { db.close(); } catch {} }
    if (/版本高于/.test(error.message)) throw error;
    throw databaseError(error);
  }
  let closed = false;
  return {
    async getConnection() { if (closed) throw new Error('Database closed'); return { release() {} }; },
    async query(sql, values = []) {
      try {
        const statement = db.prepare(sql);
        if (/^\s*SELECT/i.test(sql)) return [statement.all(...values)];
        const result = statement.run(...values);
        return [{ insertId: Number(result.lastInsertRowid), affectedRows: Number(result.changes) }];
      } catch (error) { throw databaseError(error); }
    },
    async end() {
      if (!closed) { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); db.close(); closed = true; }
    },
  };
}
module.exports = { createDatabase, databaseError };
