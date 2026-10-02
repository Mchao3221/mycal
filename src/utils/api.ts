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
 * 取文档正文。
 *
 * 关键点:**不能用 res.text()**。Fetch 规范的 text() 一律按 UTF-8 解码,
 * 完全无视响应头里的 charset —— 这个仓库里 2022 年前后那批 SQL 是 GBK 的,
 * 后端已经正确地用 `charset=gb18030` 声明了编码,但 text() 照样把中文解成乱码
 * (实测确认:字节流与响应头都对,页面却是乱码)。
 * 所以这里自己读字节、按声明的 charset 用 TextDecoder 解码。
 *
 * 顺带说明为什么后端不改在同步时转成 UTF-8:那样存进 D1 的内容就不再等于仓库里的字节,
 * 「存的到底是什么」变得不可验证。保持字节忠实 + 读取端正确解码,更容易验证也更不容易出错。
 */
export async function fetchText(url: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(await errorMessage(res))

  const buf = await res.arrayBuffer()
  const charset = /charset=([^;]+)/i.exec(res.headers.get('Content-Type') ?? '')?.[1]?.trim().toLowerCase()

  if (!charset || charset === 'utf-8' || charset === 'utf8') {
    return new TextDecoder('utf-8').decode(buf)
  }
  try {
    // gb18030 / gbk / big5 这些都在 WHATWG 编码标准里,浏览器普遍支持
    return new TextDecoder(charset).decode(buf)
  } catch {
    // 遇到不认识的编码别让整页失败,退回 UTF-8(至少结构还在)
    return new TextDecoder('utf-8').decode(buf)
  }
}

/** 从非 2xx 响应里挖出后端的中文错误文案 */
async function errorMessage(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null
  return body?.error ?? `${res.status} ${res.statusText}`
}
