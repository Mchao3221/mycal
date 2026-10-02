// mycal v0.6.0 —— 只读文档阅读器后端。
// 路由风格沿用自写轻路由(无框架):相等匹配 + method 判断,未匹配的 /api/* 落到 404,
// 非 /api/ 请求交给 wrangler.jsonc 的 assets.not_found_handling 走 SPA 回退。
import { HttpError, json, readBody } from './http'
import { clearSessionCookie, lockNow, normPassword, setupLock, unlockLock, verifySession } from './lock'
import { handleFile, handleTree } from './docs'
import { handleFiles, handleFinish, handlePlan, handleStatus } from './sync'
import type { Env } from './env'

/** 锁自身的路由:未解锁也可访问;其余 /api/* 一律先验会话 */
const OPEN_API = new Set(['/api/lock/status', '/api/lock/setup', '/api/lock/unlock'])

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)
    const path = url.pathname
    const method = req.method

    if (!path.startsWith('/api/')) return new Response(null, { status: 404 })

    try {
      let refreshCookie: string | undefined
      if (!OPEN_API.has(path)) {
        const status = await verifySession(env.mycalDB, req)
        if (status.isSet && !status.unlocked) {
          throw new HttpError(401, '已锁定,请输入访问码解锁')
        }
        refreshCookie = status.refreshCookie
      }
      const res = await route(req, env, path, method)
      if (refreshCookie) res.headers.append('Set-Cookie', refreshCookie)
      return res
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status)
      console.error(`${method} ${path} failed:`, err)
      return json({ error: `服务器内部错误:${err instanceof Error ? err.message : String(err)}` }, 500)
    }
  },
}

// ---------- REST API(所有 HttpError 由 fetch 外层统一转状态码) ----------

async function route(req: Request, env: Env, path: string, method: string): Promise<Response> {
  const db = env.mycalDB
  const secure = req.url.startsWith('https')

  // ---- 访问码锁 ----
  if (path === '/api/lock/status' && method === 'GET') {
    const { refreshCookie, ...st } = await verifySession(db, req)
    const res = json(st)
    if (refreshCookie) res.headers.append('Set-Cookie', refreshCookie)
    return res
  }

  if (path === '/api/lock/setup' && method === 'POST') {
    const body = await readBody<{ password?: unknown }>(req)
    const cookie = await setupLock(db, req, normPassword(body?.password))
    return json({ ok: true }, 200, { 'Set-Cookie': cookie })
  }

  if (path === '/api/lock/unlock' && method === 'POST') {
    const body = await readBody<{ password?: unknown }>(req)
    const cookie = await unlockLock(db, req, normPassword(body?.password))
    return json({ ok: true }, 200, { 'Set-Cookie': cookie })
  }

  if (path === '/api/lock/lock' && method === 'POST') {
    await lockNow(db)
    return json({ ok: true }, 200, { 'Set-Cookie': clearSessionCookie(secure) })
  }

  // ---- 阅读(只读本地副本) ----
  if (path === '/api/docs/tree' && method === 'GET') {
    return json(await handleTree(env))
  }

  if (path === '/api/docs/raw' && method === 'GET') {
    const params = new URL(req.url).searchParams
    return await handleFile(env, params.get('path'), params.get('sha') ?? undefined)
  }

  // ---- 同步(把仓库搬进 D1) ----
  if (path === '/api/sync/status' && method === 'GET') {
    return json(await handleStatus(env))
  }

  if (path === '/api/sync/plan' && method === 'POST') {
    return json(await handlePlan(env))
  }

  if (path === '/api/sync/files' && method === 'POST') {
    return json(await handleFiles(env, await readBody<unknown>(req)))
  }

  if (path === '/api/sync/finish' && method === 'POST') {
    return json(await handleFinish(env, await readBody<unknown>(req)))
  }

  throw new HttpError(404, '接口不存在')
}
