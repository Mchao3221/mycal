import type { Env } from './env'
import type {
  AiSummary,
  HealthLog,
  HealthLogInput,
  HealthLogRow,
  HealthStore,
  MealSlot,
  Profile,
  ProfileRow,
  Todo,
  TodoRow,
  TodoStore,
} from './types'

type DB = Env['mycalDB']

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

// ---------- 打卡日记 ----------

function toHealthLog(r: HealthLogRow): HealthLog {
  const h: HealthLog = {
    id: r.id,
    kind: r.kind as HealthLog['kind'],
    text: r.text,
    kcal: r.kcal ?? null,
    createdAt: r.created_at,
  }
  if (r.meal) h.meal = r.meal as MealSlot
  if (r.kcal != null && r.kcal_source) h.kcalSource = r.kcal_source as 'ai' | 'manual'
  return h
}

/** 全量读取打卡:Record<'YYYY-MM-DD', HealthLog[]> */
export async function getAllHealthLogs(db: DB): Promise<HealthStore> {
  const res = await db
    .prepare('SELECT * FROM health_logs ORDER BY created_at ASC, rowid ASC')
    .all<HealthLogRow>()
  const store: HealthStore = {}
  for (const r of res.results) {
    ;(store[r.date_key] ??= []).push(toHealthLog(r))
  }
  return store
}

export async function getHealthLogsByDate(db: DB, dateKey: string): Promise<HealthLog[]> {
  const res = await db
    .prepare('SELECT * FROM health_logs WHERE date_key = ? ORDER BY created_at ASC, rowid ASC')
    .bind(dateKey)
    .all<HealthLogRow>()
  return res.results.map(toHealthLog)
}

async function getHealthRowById(db: DB, id: string): Promise<HealthLogRow | null> {
  return db.prepare('SELECT * FROM health_logs WHERE id = ?').bind(id).first<HealthLogRow>()
}

export async function createHealthLog(
  db: DB,
  input: { dateKey: string } & HealthLogInput,
): Promise<HealthLog> {
  const id = crypto.randomUUID()
  const k = input.kcal ?? null
  await db
    .prepare(
      'INSERT INTO health_logs (id, date_key, kind, text, meal, kcal, kcal_source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(
      id,
      input.dateKey,
      input.kind,
      input.text,
      input.meal ?? null,
      k,
      k === null ? null : 'manual',
      Date.now(),
    )
    .run()
  const r = await getHealthRowById(db, id)
  return r ? toHealthLog(r) : { id, kind: input.kind, text: input.text, kcal: k, createdAt: Date.now() }
}

/** 局部更新 text / meal / kcal(kcal 传数字或 null;非空即视为手动修正) */
export async function patchHealthLog(
  db: DB,
  id: string,
  patch: { text?: string; meal?: MealSlot | null; kcal?: number | null },
): Promise<HealthLog | null> {
  const sets: string[] = []
  const args: unknown[] = []
  if (patch.text !== undefined) {
    sets.push('text = ?')
    args.push(patch.text)
  }
  if (patch.meal !== undefined) {
    sets.push('meal = ?')
    args.push(patch.meal)
  }
  if (patch.kcal !== undefined) {
    sets.push('kcal = ?', 'kcal_source = ?')
    args.push(patch.kcal, patch.kcal === null ? null : 'manual')
  }
  if (sets.length) {
    await db.prepare(`UPDATE health_logs SET ${sets.join(', ')} WHERE id = ?`).bind(...args, id).run()
  }
  const r = await getHealthRowById(db, id)
  return r ? toHealthLog(r) : null
}

export async function deleteHealthLogById(db: DB, id: string): Promise<boolean> {
  const res = await db.prepare('DELETE FROM health_logs WHERE id = ?').bind(id).run()
  return (res.meta.changes ?? 0) > 0
}

/** AI 估算回填:仅当该条 kcal 仍为 NULL 时写入(不覆盖手动值) */
export async function fillKcalIfNull(db: DB, id: string, kcal: number): Promise<boolean> {
  const res = await db
    .prepare("UPDATE health_logs SET kcal = ?, kcal_source = 'ai' WHERE id = ? AND kcal IS NULL")
    .bind(kcal, id)
    .run()
  return (res.meta.changes ?? 0) > 0
}

// ---------- 健康档案(全局单行) ----------

export async function getProfile(db: DB): Promise<Profile | null> {
  const r = await db.prepare('SELECT * FROM profile WHERE id = 1').first<ProfileRow>()
  if (!r) return null
  return {
    sex: r.sex as Profile['sex'],
    age: r.age as number,
    heightCm: r.height_cm as number,
    weightKg: r.weight_kg as number,
    targetWeightKg: r.target_weight_kg ?? null,
    activity: r.activity as Profile['activity'],
    goal: r.goal as Profile['goal'],
    updatedAt: r.updated_at as number,
  }
}

export async function upsertProfile(db: DB, p: Omit<Profile, 'updatedAt'>): Promise<Profile> {
  const updatedAt = Date.now()
  await db
    .prepare(
      `INSERT INTO profile (id, sex, age, height_cm, weight_kg, target_weight_kg, activity, goal, updated_at)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         sex = excluded.sex, age = excluded.age, height_cm = excluded.height_cm,
         weight_kg = excluded.weight_kg, target_weight_kg = excluded.target_weight_kg,
         activity = excluded.activity, goal = excluded.goal, updated_at = excluded.updated_at`,
    )
    .bind(p.sex, p.age, p.heightCm, p.weightKg, p.targetWeightKg ?? null, p.activity, p.goal, updatedAt)
    .run()
  return { ...p, updatedAt }
}

// ---------- AI 每日汇总(按天缓存) ----------

export async function getAiSummary(db: DB, dateKey: string): Promise<AiSummary | null> {
  const r = await db
    .prepare('SELECT content FROM ai_summaries WHERE date_key = ?')
    .bind(dateKey)
    .first<{ content: string }>()
  if (!r) return null
  try {
    return JSON.parse(r.content) as AiSummary
  } catch {
    return null
  }
}

export async function upsertAiSummary(db: DB, dateKey: string, content: AiSummary): Promise<AiSummary> {
  await db
    .prepare(
      `INSERT INTO ai_summaries (date_key, content, created_at) VALUES (?, ?, ?)
       ON CONFLICT(date_key) DO UPDATE SET content = excluded.content, created_at = excluded.created_at`,
    )
    .bind(dateKey, JSON.stringify(content), Date.now())
    .run()
  return content
}

export async function deleteAiSummary(db: DB, dateKey: string): Promise<void> {
  await db.prepare('DELETE FROM ai_summaries WHERE date_key = ?').bind(dateKey).run()
}

// ---------- 应用设置(AI baseUrl / apiKey / model;key 只进不出) ----------

export async function getSetting(db: DB, key: string): Promise<string | null> {
  const r = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>()
  return r ? r.value : null
}

export async function setSetting(db: DB, key: string, value: string): Promise<void> {
  await db
    .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .bind(key, value)
    .run()
}

export async function deleteSetting(db: DB, key: string): Promise<void> {
  await db.prepare('DELETE FROM settings WHERE key = ?').bind(key).run()
}
