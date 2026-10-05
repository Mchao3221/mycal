// D1 存取：projects / requirements / req_links / req_fts。
import { HttpError } from './http'

const uid = () => crypto.randomUUID()

export interface ReqLinkRow {
  id: string
  label: string
  url: string
  note: string
}

async function linksOf(db: D1Database, reqId: string): Promise<ReqLinkRow[]> {
  const r = await db.prepare('SELECT id, label, url, note FROM req_links WHERE req_id = ?').bind(reqId).all()
  return ((r.results as unknown as ReqLinkRow[]) ?? [])
}

async function reindex(db: D1Database, reqId: string, title: string, body: string) {
  const lr = await db.prepare('SELECT note FROM req_links WHERE req_id = ?').bind(reqId).all()
  const note = ((lr.results as { note: string }[]) ?? []).map(x => x.note).join('\n')
  await db.prepare('DELETE FROM req_fts WHERE req_id = ?').bind(reqId).run()
  await db.prepare('INSERT INTO req_fts (req_id, title, body, note) VALUES (?, ?, ?, ?)').bind(reqId, title, body, note).run()
}

export async function listProjects(db: D1Database) {
  const r = await db.prepare('SELECT id, name, created_at AS createdAt FROM projects ORDER BY created_at ASC').all()
  return r.results ?? []
}

export async function createProject(db: D1Database, name: string) {
  const trimmed = name.trim()
  if (!trimmed) throw new HttpError(400, '项目名称不能为空')
  const row = { id: uid(), name: trimmed, createdAt: Date.now() }
  await db.prepare('INSERT INTO projects (id, name, created_at) VALUES (?, ?, ?)').bind(row.id, row.name, row.createdAt).run()
  return row
}

export async function listReq(db: D1Database, params: URLSearchParams) {
  const project = params.get('project') ?? ''
  const status = params.get('status') ?? ''
  const q = params.get('q')?.trim() ?? ''

  let ids: Set<string> | null = null
  if (q) {
    const fts = await db.prepare('SELECT req_id FROM req_fts WHERE req_fts MATCH ?').bind(q).all()
    ids = new Set(((fts.results as { req_id: string }[]) ?? []).map(x => x.req_id))
    if (ids.size === 0) return []
  }

  const conds: string[] = []
  const args: unknown[] = []
  if (project) {
    conds.push('project_id = ?')
    args.push(project)
  }
  if (status) {
    if (!['todo', 'doing', 'done'].includes(status)) throw new HttpError(400, '状态非法')
    conds.push('status = ?')
    args.push(status)
  }
  const where = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : ''
  const r = await db
    .prepare(`SELECT id, project_id AS projectId, title, body, status, created_at AS createdAt, updated_at AS updatedAt FROM requirements ${where} ORDER BY updated_at DESC LIMIT 200`)
    .bind(...args)
    .all()
  let rows = (r.results as Record<string, unknown>[]) ?? []
  if (ids) rows = rows.filter(x => ids.has(x['id'] as string))
  const out = []
  for (const row of rows) {
    out.push({ ...row, links: await linksOf(db, row['id'] as string) })
  }
  return out
}

export async function createReq(db: D1Database, body: Record<string, unknown>) {
  const projectId = String(body['projectId'] ?? '')
  const title = String(body['title'] ?? '').trim()
  const text = String(body['body'] ?? '')
  const links = (body['links'] as { label?: unknown; url?: unknown; note?: unknown }[] | undefined) ?? []
  if (!projectId) throw new HttpError(400, '缺少 projectId')
  if (!title) throw new HttpError(400, '标题不能为空')
  const now = Date.now()
  const id = uid()
  await db
    .prepare('INSERT INTO requirements (id, project_id, title, body, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(id, projectId, title, text, 'todo', now, now)
    .run()
  for (const l of links) {
    const url = String(l.url ?? '').trim()
    if (!url) continue
    await db
      .prepare('INSERT INTO req_links (id, req_id, label, url, note) VALUES (?, ?, ?, ?, ?)')
      .bind(uid(), id, String(l.label ?? ''), url, String(l.note ?? ''))
      .run()
  }
  await reindex(db, id, title, text)
  return { id, projectId, title, body: text, status: 'todo', links: await linksOf(db, id), createdAt: now, updatedAt: now }
}

export async function updateReq(db: D1Database, id: string, body: Record<string, unknown>) {
  const cur = await db.prepare('SELECT id, project_id AS projectId, title, body, status FROM requirements WHERE id = ?').bind(id).first()
  if (!cur) throw new HttpError(404, '需求不存在')
  const next = {
    title: (body['title'] as string | undefined)?.trim() || (cur['title'] as string),
    text: typeof body['body'] === 'string' ? (body['body'] as string) : (cur['body'] as string),
    status: typeof body['status'] === 'string' ? (body['status'] as string) : (cur['status'] as string),
    projectId: typeof body['projectId'] === 'string' ? (body['projectId'] as string) : (cur['projectId'] as string),
  }
  if (!['todo', 'doing', 'done'].includes(next.status)) throw new HttpError(400, '状态非法')
  await db
    .prepare('UPDATE requirements SET project_id = ?, title = ?, body = ?, status = ?, updated_at = ? WHERE id = ?')
    .bind(next.projectId, next.title, next.text, next.status, Date.now(), id)
    .run()
  if (Array.isArray(body['links'])) {
    await db.prepare('DELETE FROM req_links WHERE req_id = ?').bind(id).run()
    for (const l of body['links'] as { label?: unknown; url?: unknown; note?: unknown }[]) {
      const url = String(l.url ?? '').trim()
      if (!url) continue
      await db
        .prepare('INSERT INTO req_links (id, req_id, label, url, note) VALUES (?, ?, ?, ?, ?)')
        .bind(uid(), id, String(l.label ?? ''), url, String(l.note ?? ''))
        .run()
    }
  }
  await reindex(db, id, next.title, next.text)
  const row = await db
    .prepare('SELECT id, project_id AS projectId, title, body, status, created_at AS createdAt, updated_at AS updatedAt FROM requirements WHERE id = ?')
    .bind(id)
    .first()
  return { ...(row as object), links: await linksOf(db, id) }
}
