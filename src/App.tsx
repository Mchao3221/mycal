import { useCallback, useEffect, useState } from 'react'
import { api } from './utils/api'
import type { Project, ReqStatus, Requirement } from './types'

const STATUS_LABEL: Record<ReqStatus, string> = { todo: '记下', doing: '做了', done: '归档' }

export default function App() {
  const [projects, setProjects] = useState<Project[]>([])
  const [activeProject, setActiveProject] = useState<string>('')
  const [status, setStatus] = useState<string>('')
  const [q, setQ] = useState('')
  const [items, setItems] = useState<Requirement[]>([])
  const [error, setError] = useState('')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [linkUrl, setLinkUrl] = useState('')

  const reload = useCallback(async () => {
    try {
      setError('')
      const [p, r] = await Promise.all([
        api.projects(),
        api.listReq({ project: activeProject || undefined, status: status || undefined, q: q || undefined }),
      ])
      setProjects(p.projects)
      setItems(r.requirements)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [activeProject, status, q])

  useEffect(() => {
    void reload()
  }, [reload])

  const createProject = async () => {
    const name = window.prompt('新项目名称')
    if (!name?.trim()) return
    await api.createProject(name.trim())
    await reload()
  }

  const createReq = async () => {
    if (!activeProject) {
      setError('先选一个项目（左侧），或新建项目')
      return
    }
    if (!title.trim()) {
      setError('标题不能为空')
      return
    }
    await api.createReq({
      projectId: activeProject,
      title: title.trim(),
      body,
      links: linkUrl.trim() ? [{ label: '', url: linkUrl.trim() }] : [],
    })
    setTitle('')
    setBody('')
    setLinkUrl('')
    await reload()
  }

  const setItemStatus = async (id: string, next: ReqStatus) => {
    await api.updateReq(id, { status: next })
    await reload()
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-base-100">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-base-300 px-3">
        <span className="text-sm font-semibold">需求管理</span>
        <input
          className="input input-bordered input-sm ml-auto w-64"
          placeholder="全文搜索标题/正文/链接备注"
          value={q}
          onChange={e => setQ(e.target.value)}
        />
      </header>
      {error && <div className="alert alert-error rounded-none py-1 text-sm">{error}</div>}
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-56 shrink-0 flex-col border-r border-base-300">
          <div className="flex items-center px-2 py-2">
            <span className="text-xs opacity-60">项目</span>
            <button type="button" className="btn btn-ghost btn-xs ml-auto" onClick={() => void createProject()}>
              新建
            </button>
          </div>
          <div className="panel-scroll min-h-0 flex-1 overflow-auto px-2 pb-4">
            <button
              type="button"
              className={`btn btn-ghost btn-sm mb-1 w-full justify-start ${!activeProject ? 'btn-active' : ''}`}
              onClick={() => setActiveProject('')}
            >
              全部
            </button>
            {projects.map(p => (
              <button
                key={p.id}
                type="button"
                className={`btn btn-ghost btn-sm mb-1 w-full justify-start ${activeProject === p.id ? 'btn-active' : ''}`}
                onClick={() => setActiveProject(p.id)}
              >
                {p.name}
              </button>
            ))}
          </div>
          <div className="flex gap-1 border-t border-base-300 p-2">
            {(['', 'todo', 'doing', 'done'] as const).map(s => (
              <button
                key={s}
                type="button"
                className={`btn btn-xs ${status === s ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setStatus(s)}
              >
                {s === '' ? '全部' : STATUS_LABEL[s]}
              </button>
            ))}
          </div>
        </aside>
        <main className="panel-scroll min-h-0 flex-1 overflow-auto p-4">
          <div className="mb-4 rounded-box border border-base-300 p-3">
            <div className="mb-2 text-sm font-semibold">速记一条（几秒）</div>
            <input
              className="input input-bordered input-sm mb-2 w-full"
              placeholder="标题（必填）"
              value={title}
              onChange={e => setTitle(e.target.value)}
            />
            <textarea
              className="textarea textarea-bordered textarea-sm mb-2 w-full"
              placeholder="补充说明（可选）"
              value={body}
              onChange={e => setBody(e.target.value)}
            />
            <div className="flex gap-2">
              <input
                className="input input-bordered input-sm flex-1"
                placeholder="资料链接（可选，文档/视频/网盘地址）"
                value={linkUrl}
                onChange={e => setLinkUrl(e.target.value)}
              />
              <button type="button" className="btn btn-primary btn-sm" onClick={() => void createReq()}>
                记下
              </button>
            </div>
          </div>
          {items.map(it => (
            <div key={it.id} className="mb-2 rounded-box border border-base-300 p-3">
              <div className="flex items-center gap-2">
                <span className="badge badge-ghost badge-sm">{STATUS_LABEL[it.status]}</span>
                <span className="font-medium">{it.title}</span>
                <span className="ml-auto flex gap-1">
                  {(['todo', 'doing', 'done'] as const).map(s => (
                    <button
                      key={s}
                      type="button"
                      className={`btn btn-xs ${it.status === s ? 'btn-primary' : 'btn-ghost'}`}
                      onClick={() => void setItemStatus(it.id, s)}
                    >
                      {STATUS_LABEL[s]}
                    </button>
                  ))}
                </span>
              </div>
              {it.body && <pre className="mt-2 whitespace-pre-wrap text-sm opacity-80">{it.body}</pre>}
              {it.links.length > 0 && (
                <ul className="mt-2 text-sm">
                  {it.links.map(l => (
                    <li key={l.id}>
                      <a className="link link-primary break-all" href={l.url} target="_blank" rel="noreferrer">
                        {l.label || l.url}
                      </a>
                      {l.note && <span className="ml-2 opacity-60">{l.note}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
          {items.length === 0 && <div className="py-10 text-center text-sm opacity-60">没有匹配的需求</div>}
        </main>
      </div>
    </div>
  )
}
