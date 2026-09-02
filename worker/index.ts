import { getAllTodos, createTodo, toggleTodo, deleteTodoById, insertIcsTodos } from './db'
import { parseIcs, expandEvents } from './ics'
import type { Env } from './env'

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  })

async function readBody<T>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T
  } catch {
    return null
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)
    const path = url.pathname
    const method = req.method

    // ---------- REST API ----------

    if (path === '/api/todos' && method === 'GET') {
      return json(await getAllTodos(env.mycalDB))
    }

    if (path === '/api/todos' && method === 'POST') {
      const body = await readBody<{ dateKey?: string; text?: string }>(req)
      if (!body || !DATE_KEY_RE.test(String(body.dateKey ?? ''))) {
        return json({ error: 'dateKey 需为 YYYY-MM-DD' }, 400)
      }
      const text = String(body.text ?? '').trim()
      if (!text) return json({ error: 'text 不能为空' }, 400)
      return json(await createTodo(env.mycalDB, body.dateKey!, text), 201)
    }

    const toggleMatch = path.match(/^\/api\/todos\/([^/]+)\/toggle$/)
    if (toggleMatch && method === 'POST') {
      const updated = await toggleTodo(env.mycalDB, toggleMatch[1])
      if (!updated) return json({ error: 'todo 不存在' }, 404)
      return json(updated)
    }

    const todoMatch = path.match(/^\/api\/todos\/([^/]+)$/)
    if (todoMatch && method === 'DELETE') {
      const ok = await deleteTodoById(env.mycalDB, todoMatch[1])
      if (!ok) return json({ error: 'todo 不存在' }, 404)
      return json({ ok: true })
    }

    if (path === '/api/ics/import' && method === 'POST') {
      const body = await readBody<{ url?: string }>(req)
      const target = String(body?.url ?? '').trim()
      if (!/^https?:\/\//i.test(target)) {
        return json({ error: '请提供 http(s) 的 .ics 链接' }, 400)
      }
      try {
        const resp = await fetch(target, {
          headers: { 'User-Agent': 'MyCal/0.2 (+cloudflare-workers)' },
          redirect: 'follow',
          signal: AbortSignal.timeout(15_000),
        })
        if (!resp.ok) return json({ error: `拉取失败:HTTP ${resp.status}` }, 502)

        const events = parseIcs(await resp.text())
        const now = new Date()
        const fromMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 365)
        const toMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 365)
        const { items, skippedRecurring, outOfWindow } = expandEvents(events, { fromMs, toMs })

        const { imported, duplicates } = await insertIcsTodos(env.mycalDB, items)
        return json({ fetchedEvents: events.length, imported, duplicates, skippedRecurring, outOfWindow })
      } catch (err) {
        console.error('ics import failed:', err)
        return json({ error: `导入失败:${err instanceof Error ? err.message : String(err)}` }, 502)
      }
    }

    // ---------- 其余交给静态资产(SPA 回退) ----------

    return new Response(null, { status: 404 })
  },
}
