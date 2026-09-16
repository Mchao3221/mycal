import {
  getAllHealthLogs,
  createHealthLog,
  patchHealthLog,
  deleteHealthLogById,
  getAllJournal,
  createJournal,
  patchJournal,
  deleteJournalById,
  getAllWeights,
  upsertWeight,
  deleteWeight,
  getRecentWeights,
  getProfile,
  upsertProfile,
  getAiSummary,
  deleteAiSummary,
  setSetting,
  deleteSetting,
} from './db'
import { HttpError, resolveAiConfig, summarizeDay } from './ai'
import { clearSessionCookie, lockNow, normPassword, setupLock, unlockLock, verifySession } from './lock'
import { isValidDateKey, normKcal, normWeight, normProfile, HEALTH_KINDS, MEALS } from './validate'
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
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Set-Cookie': cookie },
    })
  }

  if (path === '/api/lock/unlock' && method === 'POST') {
    const body = await readBody<{ password?: unknown }>(req)
    const cookie = await unlockLock(db, req, normPassword(body?.password))
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Set-Cookie': cookie },
    })
  }

  if (path === '/api/lock/lock' && method === 'POST') {
    await lockNow(db)
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Set-Cookie': clearSessionCookie(secure) },
    })
  }

  // ---- 当日流水 ----
  if (path === '/api/journal' && method === 'GET') {
    return json(await getAllJournal(db))
  }

  if (path === '/api/journal' && method === 'POST') {
    const body = await readBody<{ dateKey?: string; text?: string }>(req)
    if (!body || !isValidDateKey(body.dateKey)) {
      throw new HttpError(400, 'dateKey 需为 YYYY-MM-DD')
    }
    const text = String(body.text ?? '').trim()
    if (!text) throw new HttpError(400, 'text 不能为空')
    if (text.length > 500) throw new HttpError(400, 'text 超长(≤500 字)')
    return json(await createJournal(db, body.dateKey, text), 201)
  }

  const journalMatch = path.match(/^\/api\/journal\/([^/]+)$/)
  if (journalMatch && method === 'PATCH') {
    const body = await readBody<{ text?: unknown }>(req)
    const text = String(body?.text ?? '').trim()
    if (!text) throw new HttpError(400, 'text 不能为空')
    if (text.length > 500) throw new HttpError(400, 'text 超长(≤500 字)')
    const updated = await patchJournal(db, journalMatch[1], text)
    if (!updated) throw new HttpError(404, '流水记录不存在')
    return json(updated)
  }

  if (journalMatch && method === 'DELETE') {
    const ok = await deleteJournalById(db, journalMatch[1])
    if (!ok) throw new HttpError(404, '流水记录不存在')
    return json({ ok: true })
  }

  // ---- 体重记录 ----
  if (path === '/api/weights' && method === 'GET') {
    return json(await getAllWeights(db))
  }

  if (path === '/api/weights' && method === 'POST') {
    const body = await readBody<{ dateKey?: string; weightKg?: unknown }>(req)
    if (!body || !isValidDateKey(body.dateKey)) {
      throw new HttpError(400, 'dateKey 需为 YYYY-MM-DD')
    }
    const w = normWeight(body.weightKg)
    if (w === undefined) throw new HttpError(400, '体重需为 20~400 kg 的数字')
    return json(await upsertWeight(db, body.dateKey, w))
  }

  const weightMatch = path.match(/^\/api\/weights\/(\d{4}-\d{2}-\d{2})$/)
  if (weightMatch && method === 'DELETE') {
    if (!isValidDateKey(weightMatch[1])) throw new HttpError(400, 'dateKey 需为 YYYY-MM-DD')
    const ok = await deleteWeight(db, weightMatch[1])
    if (!ok) throw new HttpError(404, '该日期没有体重记录')
    return json({ ok: true })
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

  // ---- 健康档案(当前体重以体重记录为单一事实源) ----
  if (path === '/api/profile' && method === 'GET') {
    const p = await getProfile(db)
    if (!p) return json(null)
    const [latest] = await getRecentWeights(db, '9999-12-31', 1)
    return json(latest ? { ...p, weightKg: latest.weightKg } : p)
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
