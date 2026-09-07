import { DatabaseSync } from 'node:sqlite'

export class EditorStore {
  constructor(path) {
    this.db = new DatabaseSync(path)
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(kind,id));')
  }
  get(kind, id) { const row = this.db.prepare('SELECT payload FROM records WHERE kind=? AND id=?').get(kind, id); return row ? JSON.parse(row.payload) : null }
  list(kind) { return this.db.prepare('SELECT payload FROM records WHERE kind=? ORDER BY id').all(kind).map(row => JSON.parse(row.payload)) }
  put(kind, id, value) { this.db.prepare('INSERT INTO records(kind,id,payload) VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET payload=excluded.payload').run(kind, id, JSON.stringify(value)); return value }
  remove(kind, id) { this.db.prepare('DELETE FROM records WHERE kind=? AND id=?').run(kind, id) }
  transaction(fn) { this.db.exec('BEGIN IMMEDIATE'); try { const result = fn(); this.db.exec('COMMIT'); return result } catch (error) { this.db.exec('ROLLBACK'); throw error } }
  close() { this.db.close() }
}
