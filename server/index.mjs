import express from 'express'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  getAllTodos,
  createTodo,
  getTodoById,
  setTodoDone,
  deleteTodoById,
  uidExistsOnDate,
} from './db.mjs'
import { parseIcs, expandEvents } from './ics.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const app = express()
app.use(express.json())

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/

// ---------- REST API ----------

app.get('/api/todos', (_req, res) => {
  res.json(getAllTodos())
})

app.post('/api/todos', (req, res) => {
  const { dateKey, text } = req.body ?? {}
  if (!DATE_KEY_RE.test(String(dateKey ?? ''))) {
    return res.status(400).json({ error: 'dateKey 需为 YYYY-MM-DD' })
  }
  const trimmed = String(text ?? '').trim()
  if (!trimmed) return res.status(400).json({ error: 'text 不能为空' })
  res.status(201).json(createTodo({ dateKey, text: trimmed }))
})

app.post('/api/todos/:id/toggle', (req, res) => {
  const cur = getTodoById(req.params.id)
  if (!cur) return res.status(404).json({ error: 'todo 不存在' })
  res.json(setTodoDone(cur.id, !cur.done))
})

app.delete('/api/todos/:id', (req, res) => {
  if (!deleteTodoById(req.params.id)) return res.status(404).json({ error: 'todo 不存在' })
  res.json({ ok: true })
})

// ---------- ICS 订阅导入 ----------

app.post('/api/ics/import', async (req, res) => {
  const url = String(req.body?.url ?? '').trim()
  if (!/^https?:\/\//i.test(url)) {
    return res.status(400).json({ error: '请提供 http(s) 的 .ics 链接' })
  }
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'MyCal/0.1 (+local)' },
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
    })
    if (!resp.ok) return res.status(502).json({ error: `拉取失败:HTTP ${resp.status}` })

    const events = parseIcs(await resp.text())
    const now = new Date()
    const fromMs = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 365).getTime()
    const toMs = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 365).getTime()
    const { items, skippedRecurring, outOfWindow } = expandEvents(events, { fromMs, toMs })

    let imported = 0
    let duplicates = 0
    for (const it of items) {
      if (uidExistsOnDate(it.uid, it.dateKey)) {
        duplicates++
        continue
      }
      createTodo({ dateKey: it.dateKey, text: it.text, source: 'ics', uid: it.uid })
      imported++
    }

    res.json({ fetchedEvents: events.length, imported, duplicates, skippedRecurring, outOfWindow })
  } catch (err) {
    console.error('ics import failed:', err)
    res.status(502).json({ error: `导入失败:${err?.message ?? err}` })
  }
})

// ---------- 生产模式:托管 dist ----------

const distDir = resolve(here, '../dist')
if (existsSync(distDir)) {
  app.use(express.static(distDir))
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api')) {
      return res.sendFile(resolve(distDir, 'index.html'))
    }
    next()
  })
}

const port = Number(process.env.PORT) || 3001
app.listen(port, () => {
  console.log(`[mycal] API server: http://127.0.0.1:${port}`)
})
