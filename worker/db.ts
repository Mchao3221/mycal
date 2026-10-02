// D1 数据访问层(v0.5.0 只读文档阅读器)。
// 健康日志业务整体退役后,库表只剩访问码锁所需的两张:
//   settings      —— 键值对,存 lock.salt / lock.hash 等
//   auth_sessions —— 会话哈希(不存明文 token),「立即上锁」清空此表即可撤销所有设备
import type { Env } from './env'

type DB = Env['mycalDB']

export interface SessionRow {
  token_hash: string
  label: string
  created_at: number
  expires_at: number
}

// ---------- 应用设置 ----------

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

// ---------- 登录会话(lock.ts 专用) ----------

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
  const rows = await db
    .prepare('SELECT token_hash FROM auth_sessions ORDER BY created_at ASC')
    .all<{ token_hash: string }>()
  const excess = rows.results.length - (max - 1)
  for (const r of rows.results.slice(0, Math.max(0, excess))) {
    await db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').bind(r.token_hash).run()
  }
}

export async function clearSessions(db: DB): Promise<void> {
  await db.prepare('DELETE FROM auth_sessions').run()
}
