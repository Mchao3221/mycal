// mycal v0.5.0 —— 只读文档阅读器后端。
// 路由风格沿用自写轻路由(无框架):正则/相等匹配 + method 判断,未匹配的 /api/* 落到 404,
// 非 /api/ 请求交给 wrangler.jsonc 的 assets.not_found_handling 走 SPA 回退。
import { HttpError, json, readBody } from './http'
import { clearSessionCookie, lockNow, normPassword, setupLock, unlockLock, verifySession } from './lock'
import { fetchFile, fetchTree, normPath } from './docs'
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

  // ---- 文档仓库(只读) ----
  if (path === '/api/docs/tree' && method === 'GET') {
    const fresh = new URL(req.url).searchParams.get('refresh') === '1'
    return json(await fetchTree(env, fresh))
  }

  if (path === '/api/docs/raw' && method === 'GET') {
    const params = new URL(req.url).searchParams
    const file = normPath(params.get('path'))
    // sha 由前端从文件树里带过来:有它就不必为了"路径换 sha"再拉一次完整文件树,
    // 打开一个文件最多只剩一次上游请求。sha 的格式校验在 fetchFile 里做。
    return await fetchFile(env, file, params.get('sha') ?? undefined)
  }

  throw new HttpError(404, '接口不存在')
}
