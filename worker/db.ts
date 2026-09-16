import type { Env } from './env'
import type {
  AiSummary,
  HealthLog,
  HealthLogInput,
  HealthLogRow,
  HealthStore,
  JournalEntry,
  JournalRow,
  JournalStore,
  MealSlot,
  Profile,
  ProfileRow,
  SessionRow,
  Todo,
  TodoRow,
  TodoStore,
  WeightEntry,
  WeightRow,
  WeightStore,
} from './types'

type DB = Env['mycalDB']

function toTodo(r: TodoRow): Todo {
  const t: Todo = { id: r.id, text: r.text, done: !!r.done, createdAt: r.created_at }
  if (r.source) t.source = r.source as Todo['source']
  if (r.uid) t.uid = r.uid
  return t
}

/** 全量读取(v0.4 起仅剩 ICS 日程):Record<'YYYY-MM-DD', Todo[]> */
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

/** 按 id 删除日程(纠错用);v0.4 起待办的新增/切换已退役 */
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
    weightKg: r.weight_kg as number | null,
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

// ---------- 当日流水(v0.4) ----------

function toJournal(r: JournalRow): JournalEntry {
  return { id: r.id, text: r.text, createdAt: r.created_at }
}

/** 全量读取流水:Record<'YYYY-MM-DD', JournalEntry[]> */
export async function getAllJournal(db: DB): Promise<JournalStore> {
  const res = await db
    .prepare('SELECT * FROM day_logs ORDER BY created_at ASC, rowid ASC')
    .all<JournalRow>()
  const store: JournalStore = {}
  for (const r of res.results) {
    ;(store[r.date_key] ??= []).push(toJournal(r))
  }
  return store
}

export async function getJournalByDate(db: DB, dateKey: string): Promise<JournalEntry[]> {
  const res = await db
    .prepare('SELECT * FROM day_logs WHERE date_key = ? ORDER BY created_at ASC, rowid ASC')
    .bind(dateKey)
    .all<JournalRow>()
  return res.results.map(toJournal)
}

export async function createJournal(db: DB, dateKey: string, text: string): Promise<JournalEntry> {
  const id = crypto.randomUUID()
  const createdAt = Date.now()
  await db.prepare('INSERT INTO day_logs (id, date_key, text, created_at) VALUES (?, ?, ?, ?)').bind(id, dateKey, text, createdAt).run()
  return { id, text, createdAt }
}

/** 改流水文字;不存在返回 null */
export async function patchJournal(db: DB, id: string, text: string): Promise<JournalEntry | null> {
  const res = await db.prepare('UPDATE day_logs SET text = ? WHERE id = ?').bind(text, id).run()
  if (!res.meta.changes) return null
  const r = await db.prepare('SELECT * FROM day_logs WHERE id = ?').bind(id).first<JournalRow>()
  return r ? toJournal(r) : null
}

export async function deleteJournalById(db: DB, id: string): Promise<boolean> {
  const res = await db.prepare('DELETE FROM day_logs WHERE id = ?').bind(id).run()
  return (res.meta.changes ?? 0) > 0
}

// ---------- 体重记录(v0.4) ----------

function toWeight(r: WeightRow): WeightEntry {
  return { dateKey: r.date_key, weightKg: r.weight_kg, updatedAt: r.updated_at }
}

/** 全量读取体重:Record<'YYYY-MM-DD', WeightEntry> */
export async function getAllWeights(db: DB): Promise<WeightStore> {
  const res = await db.prepare('SELECT * FROM weight_logs ORDER BY date_key ASC').all<WeightRow>()
  const store: WeightStore = {}
  for (const r of res.results) store[r.date_key] = toWeight(r)
  return store
}

/** 按日期 upsert:同日再录即覆盖 */
export async function upsertWeight(db: DB, dateKey: string, weightKg: number): Promise<WeightEntry> {
  const updatedAt = Date.now()
  await db
    .prepare(
      `INSERT INTO weight_logs (date_key, weight_kg, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(date_key) DO UPDATE SET weight_kg = excluded.weight_kg, updated_at = excluded.updated_at`,
    )
    .bind(dateKey, weightKg, updatedAt)
    .run()
  return { dateKey, weightKg, updatedAt }
}

export async function deleteWeight(db: DB, dateKey: string): Promise<boolean> {
  const res = await db.prepare('DELETE FROM weight_logs WHERE date_key = ?').bind(dateKey).run()
  return (res.meta.changes ?? 0) > 0
}

/** 早于等于 fromKey 的最近 n 条体重(升序返回),供 AI 汇总算近 7 日均值 */
export async function getRecentWeights(db: DB, fromKey: string, n = 7): Promise<WeightEntry[]> {
  const res = await db
    .prepare('SELECT * FROM weight_logs WHERE date_key <= ? ORDER BY date_key DESC LIMIT ?')
    .bind(fromKey, n)
    .all<WeightRow>()
  return res.results.map(toWeight).reverse()
}

// ---------- 登录会话(v0.4;lock.ts 专用) ----------

export async function getSessionRow(db: DB, tokenHash: string): Promise<SessionRow | null> {
  return db.prepare('SELECT * FROM auth_sessions WHERE token_hash = ?').bind(tokenHash).first<SessionRow>()
}

export async function createSessionRow(
  db: DB,
  tokenHash: string,
  label: string,
  createdAt: number,
  expiresAt: number,
): Promise<void> {
  await db
    .prepare('INSERT OR REPLACE INTO auth_sessions (token_hash, label, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .bind(tokenHash, label, createdAt, expiresAt)
    .run()
}

export async function touchSessionRow(db: DB, tokenHash: string, expiresAt: number): Promise<void> {
  await db.prepare('UPDATE auth_sessions SET expires_at = ? WHERE token_hash = ?').bind(expiresAt, tokenHash).run()
}

/** 清过期会话,并在超过 max 条时淘汰最久未活跃的,给新会话腾位 */
export async function trimSessions(db: DB, max: number): Promise<void> {
  await db.prepare('DELETE FROM auth_sessions WHERE expires_at <= ?').bind(Date.now()).run()
  const rows = await db.prepare('SELECT token_hash FROM auth_sessions ORDER BY created_at ASC').all<{ token_hash: string }>()
  const excess = rows.results.length - (max - 1)
  for (const r of rows.results.slice(0, Math.max(0, excess))) {
    await db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').bind(r.token_hash).run()
  }
}

export async function clearSessions(db: DB): Promise<void> {
  await db.prepare('DELETE FROM auth_sessions').run()
}
