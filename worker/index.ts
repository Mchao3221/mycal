import {
  getAllTodos,
  createTodo,
  toggleTodo,
  deleteTodoById,
  insertIcsTodos,
  getAllHealthLogs,
  createHealthLog,
  patchHealthLog,
  deleteHealthLogById,
  getProfile,
  upsertProfile,
  getAiSummary,
  deleteAiSummary,
  setSetting,
  deleteSetting,
} from './db'
import { parseIcs, expandEvents } from './ics'
import { HttpError, resolveAiConfig, summarizeDay } from './ai'
import { isValidDateKey, normKcal, normProfile, HEALTH_KINDS, MEALS } from './validate'
import type { Env } from './env'
import type { MealSlot } from './types'

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

    if (!path.startsWith('/api/')) return new Response(null, { status: 404 })

    try {
      return await route(req, env, path, method)
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

  // ---- todos ----
  if (path === '/api/todos' && method === 'GET') {
    return json(await getAllTodos(db))
  }

  if (path === '/api/todos' && method === 'POST') {
    const body = await readBody<{ dateKey?: string; text?: string }>(req)
    if (!body || !isValidDateKey(body.dateKey)) {
      throw new HttpError(400, 'dateKey 需为 YYYY-MM-DD')
    }
    const text = String(body.text ?? '').trim()
    if (!text) throw new HttpError(400, 'text 不能为空')
    return json(await createTodo(db, body.dateKey, text), 201)
  }

  const toggleMatch = path.match(/^\/api\/todos\/([^/]+)\/toggle$/)
  if (toggleMatch && method === 'POST') {
    const updated = await toggleTodo(db, toggleMatch[1])
    if (!updated) throw new HttpError(404, 'todo 不存在')
    return json(updated)
  }

  const todoMatch = path.match(/^\/api\/todos\/([^/]+)$/)
  if (todoMatch && method === 'DELETE') {
    const ok = await deleteTodoById(db, todoMatch[1])
    if (!ok) throw new HttpError(404, 'todo 不存在')
    return json({ ok: true })
  }

  // ---- ICS 订阅导入 ----
  if (path === '/api/ics/import' && method === 'POST') {
    const body = await readBody<{ url?: string }>(req)
    const target = String(body?.url ?? '').trim()
    if (!/^https?:\/\//i.test(target)) {
      throw new HttpError(400, '请提供 http(s) 的 .ics 链接')
    }
    let resp: Response
    try {
      resp = await fetch(target, {
        headers: { 'User-Agent': 'MyCal/0.3 (+cloudflare-workers)' },
        redirect: 'follow',
        signal: AbortSignal.timeout(15_000),
      })
    } catch (err) {
      throw new HttpError(502, `导入失败:${err instanceof Error ? err.message : String(err)}`)
    }
    if (!resp.ok) throw new HttpError(502, `拉取失败:HTTP ${resp.status}`)

    const events = parseIcs(await resp.text())
    const now = new Date()
    const fromMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 365)
    const toMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 365)
    const { items, skippedRecurring, outOfWindow } = expandEvents(events, { fromMs, toMs })

    const { imported, duplicates } = await insertIcsTodos(db, items)
    return json({ fetchedEvents: events.length, imported, duplicates, skippedRecurring, outOfWindow })
  }

  // ---- 打卡日记 ----
  if (path === '/api/health' && method === 'GET') {
    return json(await getAllHealthLogs(db))
  }

  if (path === '/api/health' && method === 'POST') {
    const { dateKey, kind, text, meal, kcal } =
      (await readBody<{ dateKey?: string; kind?: string; text?: string; meal?: string; kcal?: unknown }>(req)) ?? {}
    if (!isValidDateKey(dateKey)) throw new HttpError(400, 'dateKey 需为 YYYY-MM-DD')
    if (!kind || !HEALTH_KINDS.has(kind)) throw new HttpError(400, "kind 需为 'diet' 或 'exercise'")
    const trimmed = String(text ?? '').trim()
    if (!trimmed) throw new HttpError(400, 'text 不能为空')
    if (trimmed.length > 200) throw new HttpError(400, 'text 超长(≤200 字)')
    if (kind === 'diet' && meal != null && meal !== '' && !MEALS.has(meal)) {
      throw new HttpError(400, 'meal 需为 breakfast/lunch/dinner/snack')
    }
    const mealVal = kind === 'diet' && meal && MEALS.has(meal) ? (meal as MealSlot) : null
    const k = normKcal(kcal)
    if (k === undefined) throw new HttpError(400, 'kcal 需为 1~20000 的数字或留空')
    return json(
      await createHealthLog(db, {
        dateKey,
        kind: kind as 'diet' | 'exercise',
        text: trimmed,
        meal: mealVal,
        kcal: k,
      }),
      201,
    )
  }

  const healthMatch = path.match(/^\/api\/health\/([^/]+)$/)
  if (healthMatch && method === 'PATCH') {
    const { text, meal, kcal } =
      (await readBody<{ text?: unknown; meal?: unknown; kcal?: unknown }>(req)) ?? {}
    const patch: { text?: string; meal?: MealSlot | null; kcal?: number | null } = {}
    if (text !== undefined) {
      const trimmed = String(text).trim()
      if (!trimmed) throw new HttpError(400, 'text 不能为空')
      if (trimmed.length > 200) throw new HttpError(400, 'text 超长(≤200 字)')
      patch.text = trimmed
    }
    if (meal !== undefined) {
      if (meal !== null && !MEALS.has(String(meal))) throw new HttpError(400, 'meal 非法')
      patch.meal = meal === null ? null : (String(meal) as MealSlot)
    }
    if (kcal !== undefined) {
      const k = normKcal(kcal)
      if (k === undefined) throw new HttpError(400, 'kcal 需为 1~20000 的数字或 null')
      patch.kcal = k
    }
    const updated = await patchHealthLog(db, healthMatch[1], patch)
    if (!updated) throw new HttpError(404, '打卡记录不存在')
    return json(updated)
  }

  if (healthMatch && method === 'DELETE') {
    const ok = await deleteHealthLogById(db, healthMatch[1])
    if (!ok) throw new HttpError(404, '打卡记录不存在')
    return json({ ok: true })
  }

  // ---- 健康档案 ----
  if (path === '/api/profile' && method === 'GET') {
    return json(await getProfile(db))
  }

  if (path === '/api/profile' && method === 'PUT') {
    const body = (await readBody<Record<string, unknown>>(req)) ?? {}
    const { p, error } = normProfile(body)
    if (error) throw new HttpError(400, error)
    return json(await upsertProfile(db, p!))
  }

  // ---- AI 服务配置(key 只进不出)----
  if (path === '/api/ai/config' && method === 'GET') {
    const { baseUrl, model, apiKey } = await resolveAiConfig(db, env)
    return json({ baseUrl, model, hasKey: !!apiKey })
  }

  if (path === '/api/ai/config' && method === 'PUT') {
    const { baseUrl, apiKey, model } =
      (await readBody<{ baseUrl?: unknown; apiKey?: unknown; model?: unknown }>(req)) ?? {}
    if (typeof baseUrl === 'string') {
      const v = baseUrl.trim()
      if (v) {
        if (!/^https?:\/\//i.test(v)) throw new HttpError(400, 'baseUrl 需为 http(s) 地址')
        await setSetting(db, 'ai.baseUrl', v)
      } else await deleteSetting(db, 'ai.baseUrl')
    }
    if (typeof model === 'string') {
      const v = model.trim()
      if (v) await setSetting(db, 'ai.model', v)
      else await deleteSetting(db, 'ai.model')
    }
    if (typeof apiKey === 'string') {
      const v = apiKey.trim()
      if (v) await setSetting(db, 'ai.apiKey', v)
      else await deleteSetting(db, 'ai.apiKey')
    }
    const cur = await resolveAiConfig(db, env)
    return json({ baseUrl: cur.baseUrl, model: cur.model, hasKey: !!cur.apiKey })
  }

  // ---- AI 每日汇总 ----
  const summaryMatch = path.match(/^\/api\/ai\/summary\/([^/]+)$/)
  if (summaryMatch && method === 'GET') {
    if (!isValidDateKey(summaryMatch[1])) throw new HttpError(400, 'dateKey 需为 YYYY-MM-DD')
    return json(await getAiSummary(db, summaryMatch[1]))
  }

  if (path === '/api/ai/summary' && method === 'POST') {
    const body = await readBody<{ dateKey?: string }>(req)
    if (!body || !isValidDateKey(body.dateKey)) throw new HttpError(400, 'dateKey 需为 YYYY-MM-DD')
    return json(await summarizeDay(db, env, body.dateKey))
  }

  if (summaryMatch && method === 'DELETE') {
    if (!isValidDateKey(summaryMatch[1])) throw new HttpError(400, 'dateKey 需为 YYYY-MM-DD')
    await deleteAiSummary(db, summaryMatch[1])
    return json({ ok: true })
  }

  throw new HttpError(404, '接口不存在')
}
