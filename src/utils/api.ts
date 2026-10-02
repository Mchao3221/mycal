/** 极简 REST 客户端:非 2xx 时抛后端 { error } 里的中文消息 */
export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!res.ok) throw new Error(await errorMessage(res))
  return res.json() as Promise<T>
}

/**
 * 取文档正文。必须用 res.text() 而不是 res.json():
 *  1. 后端按 text/plain 下发,内容本身就是原文;
 *  2. 老 SQL 在仓库里是 GBK,后端可能用 charset=gb18030 下发,
 *     这时 res.text() 会按响应头里的 charset 正确解码,前端拿到的直接是正常中文。
 */
export async function fetchText(url: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(await errorMessage(res))
  return res.text()
}

/** 从非 2xx 响应里挖出后端的中文错误文案 */
async function errorMessage(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null
  return body?.error ?? `${res.status} ${res.statusText}`
}
