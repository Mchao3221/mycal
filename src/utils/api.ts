// 前端 API 薄封装：同源 /api/*，本地开发可经 VITE_API_BASE 指向 wrangler dev。
const BASE = import.meta.env.VITE_API_BASE ?? ''

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error((body as { error?: string }).error ?? `请求失败 ${res.status}`)
  }
  return res.json() as Promise<T>
}

export const api = {
  projects: () => req<{ projects: import('../types').Project[] }>('/api/projects'),
  createProject: (name: string) =>
    req<{ project: import('../types').Project }>('/api/projects', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
  listReq: (params: { project?: string; status?: string; q?: string }) => {
    const sp = new URLSearchParams()
    if (params.project) sp.set('project', params.project)
    if (params.status) sp.set('status', params.status)
    if (params.q) sp.set('q', params.q)
    const qs = sp.toString()
    return req<{ requirements: import('../types').Requirement[] }>(`/api/req${qs ? `?${qs}` : ''}`)
  },
  createReq: (input: { projectId: string; title: string; body?: string; links?: { label: string; url: string; note?: string }[] }) =>
    req<{ requirement: import('../types').Requirement }>('/api/req', { method: 'POST', body: JSON.stringify(input) }),
  updateReq: (id: string, input: { title?: string; body?: string; status?: string; projectId?: string; links?: { label: string; url: string; note?: string }[] }) =>
    req<{ requirement: import('../types').Requirement }>(`/api/req/${id}`, { method: 'PUT', body: JSON.stringify(input) }),
}
