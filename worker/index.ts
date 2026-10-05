// 需求管理 v0.1 后端：Worker + D1，无锁、无同步，只做 projects / req 的 CRUD + FTS 搜索。
import { HttpError, json, readBody } from './http'
import { createProject, createReq, listProjects, listReq, updateReq } from './req'
import type { Env } from './env'

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)
    const path = url.pathname
    const method = req.method
    if (!path.startsWith('/api/')) return new Response(null, { status: 404 })
    try {
      return await route(req, env, path, method, url.searchParams)
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status)
      console.error(`${method} ${path} failed:`, err)
      return json({ error: '服务器内部错误' }, 500)
    }
  },
}

async function route(req: Request, env: Env, path: string, method: string, params: URLSearchParams): Promise<Response> {
  const db = env.mycalDB

  if (path === '/api/projects' && method === 'GET') return json({ projects: await listProjects(db) })
  if (path === '/api/projects' && method === 'POST') {
    const body = (await readBody<Record<string, unknown>>(req)) ?? {}
    return json({ project: await createProject(db, String(body['name'] ?? '')) })
  }
  if (path === '/api/req' && method === 'GET') return json({ requirements: await listReq(db, params) })
  if (path === '/api/req' && method === 'POST') {
    const body = (await readBody<Record<string, unknown>>(req)) ?? {}
    return json({ requirement: await createReq(db, body) })
  }
  const m = path.match(/^\/api\/req\/([A-Za-z0-9-]+)$/)
  if (m && method === 'PUT') {
    const body = (await readBody<Record<string, unknown>>(req)) ?? {}
    return json({ requirement: await updateReq(db, m[1], body) })
  }
  throw new HttpError(404, '接口不存在')
}
