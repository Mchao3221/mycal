// v0.4 访问码锁:服务端校验 + 可撤销会话 + 防爆破。
// 设计要点:
//  1. 访问码本体只存 PBKDF2 派生哈希(salt 随机),明文不落库不落日志;
//  2. 解锁签发 256bit 随机 token,库里只存其 SHA-256 —— 「立即上锁」删表即可让所有旧 cookie 作废,
//     这是无状态签名 token 做不到的(借电脑场景必须能真撤销);
//  3. 会话 7 天有效,打开应用时剩余不足 3 天自动滑动续期;最多 5 台设备并存。
// 仅依赖 Web API(WebCrypto)与 db.ts,Workers 运行时可直接执行。
import { HttpError } from './ai'
import {
  clearSessions,
  createSessionRow,
  deleteSetting,
  getSetting,
  getSessionRow,
  setSetting,
  touchSessionRow,
  trimSessions,
} from './db'
import type { Env } from './env'

type DB = Env['mycalDB']

const COOKIE_NAME = 'mycal_session'
const SESSION_TTL_MS = 7 * 24 * 3600_000 // 记住 7 天
const REFRESH_THRESHOLD_MS = 3 * 24 * 3600_000 // 剩余不足 3 天时续期
const MAX_SESSIONS = 5
// 注意:workerd(Cloudflare Workers 运行时)拒绝 >100000 的 PBKDF2 迭代数,勿再调高
const PBKDF2_ITERATIONS = 100_000
const SALT_BYTES = 16

/** 防爆破:settings.lock.fails 存 { count, until },连续失败 ≥5 次后指数退避 */
const FAILS_KEY = '***'
const FAIL_LIMIT = 5
const FAIL_COOLDOWN_CAP_MS = 5 * 60_000

// ---------- 哈希原语 ----------

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

function bytesToHex(buf: ArrayBuffer | Uint8Array): string {
  const v = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  return Array.from(v, b => b.toString(16).padStart(2, '0')).join('')
}

/** PBKDF2-SHA256 派生访问码哈希(hex, 64 字符) */
async function deriveHash(password: string, saltHex: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, [
    'deriveBits',
  ])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: hexToBytes(saltHex), iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    key,
    256,
  )
  return bytesToHex(bits)
}

/** hex 串常量时间比较,防时序侧信道 */
function constEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

async function sha256Hex(text: string): Promise<string> {
  return bytesToHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
}

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes)
  crypto.getRandomValues(buf)
  return bytesToHex(buf)
}

// ---------- Cookie ----------

/** secure 仅在 https 下附加,避免本地 http://localhost 调试时 cookie 被丢弃 */
function cookieValue(token: string, maxAgeSec: number, secure: boolean): string {
  const parts = [`${COOKIE_NAME}=${token}`, 'HttpOnly', 'SameSite=Lax', 'Path=/', `Max-Age=${maxAgeSec}`]
  if (secure) parts.push('Secure')
  return parts.join('; ')
}

export const clearSessionCookie = (secure: boolean) => cookieValue('', 0, secure)

// ---------- 防爆破 ----------

interface FailState {
  count: number
  until: number
}

async function readFails(db: DB): Promise<FailState | null> {
  const raw = await getSetting(db, FAILS_KEY)
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as FailState
    return typeof v.count === 'number' ? v : null
  } catch {
    return null
  }
}

function guardFails(fails: FailState | null): void {
  if (fails && fails.until > Date.now()) {
    const secs = Math.ceil((fails.until - Date.now()) / 1000)
    throw new HttpError(429, `失败次数过多,请 ${secs} 秒后再试`)
  }
}

async function registerFailure(db: DB): Promise<void> {
  const cur = (await readFails(db)) ?? { count: 0, until: 0 }
  const count = cur.count + 1
  const until =
    count >= FAIL_LIMIT ? Date.now() + Math.min(FAIL_COOLDOWN_CAP_MS, 15_000 * 2 ** (count - FAIL_LIMIT)) : 0
  await setSetting(db, FAILS_KEY, JSON.stringify({ count, until }))
}

// ---------- 对外流程 ----------

export interface LockStatus {
  isSet: boolean
  unlocked: boolean
}

/** 所有受保护 /api/* 都走这里;通过则可能返回滑动续期 cookie(需追加到响应) */
export async function verifySession(
  db: DB,
  req: Request,
): Promise<LockStatus & { refreshCookie?: string }> {
  const isSet = !!(await getSetting(db, 'lock.hash'))
  const token = readCookie(req.headers.get('Cookie'))
  let unlocked = false
  let refreshCookie: string | null = null

  if (token && isSet) {
    const row = await getSessionRow(db, await sha256Hex(token))
    if (row && row.expires_at > Date.now()) {
      unlocked = true
      if (row.expires_at - Date.now() < REFRESH_THRESHOLD_MS) {
        const expiresAt = Date.now() + SESSION_TTL_MS
        await touchSessionRow(db, row.token_hash, expiresAt)
        refreshCookie = cookieValue(token, Math.floor(SESSION_TTL_MS / 1000), req.url.startsWith('https'))
      }
    }
  }
  return { isSet, unlocked, ...(refreshCookie ? { refreshCookie } : {}) }
}

function readCookie(header: string | null): string | null {
  if (!header) return null
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=')
    if (k === COOKIE_NAME) return decodeURIComponent(rest.join('='))
  }
  return null
}

export function normPassword(v: unknown): string {
  const p = typeof v === 'string' ? v : ''
  if (p.length < 6 || p.length > 64) throw new HttpError(400, '访问码需为 6~64 个字符')
  return p
}

/** 首次设置访问码(已设置则拒绝;重置只能到 D1 手动删 lock.salt/lock.hash) */
export async function setupLock(db: DB, req: Request, password: string): Promise<string> {
  if (await getSetting(db, 'lock.hash')) {
    throw new HttpError(403, '访问码已设置。如需重置,请在 Cloudflare D1 Console 删除 settings 表中 lock.salt / lock.hash 两行')
  }
  const salt = randomHex(SALT_BYTES)
  const hash = await deriveHash(password, salt)
  await setSetting(db, 'lock.salt', salt)
  await setSetting(db, 'lock.hash', hash)
  await deleteSetting(db, FAILS_KEY)
  return issueSession(db, req)
}

/** 校验访问码并签发会话;失败计入防爆破 */
export async function unlockLock(db: DB, req: Request, password: string): Promise<string> {
  const salt = await getSetting(db, 'lock.salt')
  const hash = await getSetting(db, 'lock.hash')
  if (!salt || !hash) throw new HttpError(400, '尚未设置访问码,请刷新页面进入设置流程')
  guardFails(await readFails(db))
  const derived = await deriveHash(password, salt)
  if (!constEqual(derived, hash)) {
    await registerFailure(db)
    const left = FAIL_LIMIT - ((await readFails(db))?.count ?? 0)
    throw new HttpError(401, left > 0 ? '访问码不正确' : '访问码不正确,继续尝试将触发冷却')
  }
  await deleteSetting(db, FAILS_KEY)
  return issueSession(db, req)
}

/** 签发会话,返回 Set-Cookie 头值 */
async function issueSession(db: DB, req: Request): Promise<string> {
  const token = randomHex(32)
  const expiresAt = Date.now() + SESSION_TTL_MS
  const ua = req.headers.get('User-Agent') ?? ''
  const label = /android/i.test(ua) ? 'android' : /iphone|ipad/i.test(ua) ? 'ios' : 'desktop'
  await trimSessions(db, MAX_SESSIONS) // 清过期 + 给新会话腾位(只保留最活跃的设备)
  await createSessionRow(db, await sha256Hex(token), label, Date.now(), expiresAt)
  return cookieValue(token, Math.floor(SESSION_TTL_MS / 1000), req.url.startsWith('https'))
}

/** 立即上锁:清空全部会话(所有设备的旧 cookie 即刻失效) */
export async function lockNow(db: DB): Promise<void> {
  await clearSessions(db)
}
