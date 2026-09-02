import type { Env } from './env'
import type { Todo, TodoRow, TodoStore } from './types'

function toTodo(r: TodoRow): Todo {
  const t: Todo = { id: r.id, text: r.text, done: !!r.done, createdAt: r.created_at }
  if (r.source) t.source = r.source as Todo['source']
  if (r.uid) t.uid = r.uid
  return t
}

/** 全量读取:Record<'YYYY-MM-DD', Todo[]> */
export async function getAllTodos(db: Env['mycalDB']): Promise<TodoStore> {
  const res = await db
    .prepare('SELECT * FROM todos ORDER BY created_at ASC, rowid ASC')
    .all<TodoRow>()
  const store: TodoStore = {}
  for (const r of res.results) {
    ;(store[r.date_key] ??= []).push(toTodo(r))
  }
  return store
}

export async function createTodo(db: Env['mycalDB'], dateKey: string, text: string): Promise<Todo> {
  const id = crypto.randomUUID()
  const createdAt = Date.now()
  await db
    .prepare('INSERT INTO todos (id, date_key, text, done, created_at) VALUES (?, ?, ?, 0, ?)')
    .bind(id, dateKey, text, createdAt)
    .run()
  return { id, text, done: false, createdAt }
}

async function getRowById(db: Env['mycalDB'], id: string): Promise<TodoRow | null> {
  return db.prepare('SELECT * FROM todos WHERE id = ?').bind(id).first<TodoRow>()
}

/** 翻转完成态;不存在返回 null */
export async function toggleTodo(db: Env['mycalDB'], id: string): Promise<Todo | null> {
  const cur = await getRowById(db, id)
  if (!cur) return null
  await db.prepare('UPDATE todos SET done = ? WHERE id = ?').bind(cur.done ? 0 : 1, id).run()
  const r = await getRowById(db, id)
  return r ? toTodo(r) : null
}

export async function deleteTodoById(db: Env['mycalDB'], id: string): Promise<boolean> {
  const res = await db.prepare('DELETE FROM todos WHERE id = ?').bind(id).run()
  return (res.meta.changes ?? 0) > 0
}

export interface SeedItem {
  uid: string
  dateKey: string
  text: string
}

/**
 * 批量插入 ICS 条目:依赖 0002 迁移的唯一索引(uid, date_key),
 * INSERT OR IGNORE 撞唯一键时 changes=0,据此统计 imported / duplicates。
 * D1 批量按 50 条分块,规避单次批量上限。
 */
export async function insertIcsTodos(
  db: Env['mycalDB'],
  items: SeedItem[],
): Promise<{ imported: number; duplicates: number }> {
  const stmt = db.prepare(
    'INSERT OR IGNORE INTO todos (id, date_key, text, done, created_at, source, uid) VALUES (?, ?, ?, 0, ?, ?, ?)',
  )
  const base = Date.now()
  let imported = 0

  for (let chunkStart = 0; chunkStart < items.length; chunkStart += 50) {
    const chunk = items.slice(chunkStart, chunkStart + 50)
    const results = await db.batch(
      chunk.map((it, i) =>
        stmt.bind(crypto.randomUUID(), it.dateKey, it.text, base + chunkStart + i, 'ics', it.uid),
      ),
    )
    for (const r of results) {
      if ((r.meta.changes ?? 0) > 0) imported++
    }
  }

  return { imported, duplicates: items.length - imported }
}
