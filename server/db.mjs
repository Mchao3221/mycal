import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const dataDir = resolve(here, '../data')
mkdirSync(dataDir, { recursive: true })

export const db = new DatabaseSync(resolve(dataDir, 'mycal.db'))

db.exec(`
  CREATE TABLE IF NOT EXISTS todos (
    id         TEXT PRIMARY KEY,
    date_key   TEXT    NOT NULL,
    text       TEXT    NOT NULL,
    done       INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    source     TEXT,
    uid        TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_todos_date ON todos(date_key);
  CREATE INDEX IF NOT EXISTS idx_todos_uid  ON todos(uid);
`)

const insertStmt = db.prepare(
  'INSERT INTO todos (id, date_key, text, done, created_at, source, uid) VALUES (?, ?, ?, ?, ?, ?, ?)',
)
const selectAllStmt = db.prepare('SELECT * FROM todos ORDER BY created_at ASC, rowid ASC')
const getByIdStmt = db.prepare('SELECT * FROM todos WHERE id = ?')
const deleteByIdStmt = db.prepare('DELETE FROM todos WHERE id = ?')
const updateDoneStmt = db.prepare('UPDATE todos SET done = ? WHERE id = ?')
const uidExistsStmt = db.prepare('SELECT 1 FROM todos WHERE uid = ? AND date_key = ?')

function rowToTodo(r) {
  const t = { id: r.id, text: r.text, done: !!r.done, createdAt: r.created_at }
  if (r.source) t.source = r.source
  if (r.uid) t.uid = r.uid
  return t
}

/** 全量读取:Record<'YYYY-MM-DD', Todo[]> */
export function getAllTodos() {
  const store = {}
  for (const r of selectAllStmt.all()) {
    ;(store[r.date_key] ??= []).push(rowToTodo(r))
  }
  return store
}

export function createTodo({ dateKey, text, source = null, uid = null }) {
  const id = crypto.randomUUID()
  const createdAt = Date.now()
  insertStmt.run(id, dateKey, text, 0, createdAt, source, uid)
  return rowToTodo(getByIdStmt.get(id))
}

export function getTodoById(id) {
  const r = getByIdStmt.get(id)
  return r ? rowToTodo(r) : null
}

export function setTodoDone(id, done) {
  updateDoneStmt.run(done ? 1 : 0, id)
  return rowToTodo(getByIdStmt.get(id))
}

export function deleteTodoById(id) {
  return deleteByIdStmt.run(id).changes > 0
}

/** 同一 UID 在同一天只允许一条(ICS 重复导入去重) */
export function uidExistsOnDate(uid, dateKey) {
  return !!uidExistsStmt.get(uid, dateKey)
}
