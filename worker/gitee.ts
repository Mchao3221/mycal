// Gitee 访问层(v0.6.0)。
//
// 只被同步流程使用 —— 阅读路径已经改成只读 D1(见 docs.ts),不再实时回源。
// 这样「链路慢」只影响一次批量同步,不影响每次打开文件。
//
// 为什么必须走服务端(两条都是实测结论,不是推测):
//   1. 仓库私有,匿名访问一律 404;且 raw 直链即使带上 access_token 也照样 403;
//   2. raw 直链不返回任何 CORS 头,浏览器直连根本拿不到内容
//      (对照:api/v5 返回 Access-Control-Allow-Origin: *)。
// 所以令牌只存在于 Worker 侧,浏览器永远不接触它。
import { HttpError } from './http'
import { base64ToBytes, isHidden, isTextPath } from './paths'
import type { Env } from './env'

const API_BASE = 'https://gitee.com/api/v5'

const DEFAULT_OWNER = 'chu-tianshu'
const DEFAULT_REPO = 'my-docs'
const DEFAULT_BRANCH = 'master'

/** 文件树按分钟级缓存:一次同步里会多次用到它,没必要每次都回源 */
const TREE_TTL_SEC = 60

/**
 * 单个上游请求的超时。
 * 同步是批量操作,允许慢,但不能允许挂死 —— 挂住一次会把整批拖垮。
 * 可用 GITEE_TIMEOUT_MS 覆盖,不必改代码走一次 CI。
 */
const DEFAULT_UPSTREAM_TIMEOUT_MS = 20000

let upstreamTimeoutMs = DEFAULT_UPSTREAM_TIMEOUT_MS

function applyTimeout(env: Env): void {
  const raw = Number.parseInt(env.GITEE_TIMEOUT_MS ?? '', 10)
  upstreamTimeoutMs = Number.isFinite(raw) && raw >= 1000 && raw <= 120000 ? raw : DEFAULT_UPSTREAM_TIMEOUT_MS
}

export interface RepoConf {
  owner: string
  repo: string
  branch: string
  token: string
}

export interface RemoteFile {
  path: string
  size: number
  sha: string
}

export interface RemoteTree {
  rev: string
  truncated: boolean
  files: RemoteFile[]
}

/**
 * 上游诊断记录。
 *
 * 线上曾出现 502 而文案只有「不可读,或令牌无效」,没法区分是「Gitee 拒绝了 Cloudflare 的
 * 出口 IP」「令牌没生效」还是「接口路径变了」,而云端调一轮要走一次 CI。
 * 所以把上游的真实状态码和响应片段一路带到前端,让一次请求就能定位。
 * 注意:只记状态码和响应体片段,**绝不记 URL**(URL 里带 access_token)。
 */
export interface Diag {
  step: string
  status: number | string
  body?: string
}

export interface GiteeSession {
  conf: RepoConf
  diags: Diag[]
  /** 是否出现过「连不上」类错误(超时/DNS/TLS)。一旦出现就没必要再试后面的回退 */
  networkDown: boolean
}

/** 仓库坐标。读路径不需要令牌也能知道自己在读哪个仓库,所以单独拆出来 */
export function repoInfo(env: Env): { owner: string; repo: string; branch: string } {
  return {
    owner: (env.GITEE_OWNER ?? DEFAULT_OWNER).trim(),
    repo: (env.GITEE_REPO ?? DEFAULT_REPO).trim(),
    branch: (env.GITEE_BRANCH ?? DEFAULT_BRANCH).trim(),
  }
}

export function confOf(env: Env): RepoConf {
  const token = (env.GITEE_TOKEN ?? '').trim()
  if (!token) {
    throw new HttpError(
      500,
      '未配置 GITEE_TOKEN:本地请在项目根目录的 .dev.vars 里填写,生产用 wrangler secret put GITEE_TOKEN',
    )
  }
  return { ...repoInfo(env), token }
}

export function openSession(env: Env): GiteeSession {
  applyTimeout(env)
  return { conf: confOf(env), diags: [], networkDown: false }
}

export function snippet(text: string, max = 200): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? flat.slice(0, max) + '…' : flat
}

export function diagText(s: GiteeSession): string {
  return s.diags.length === 0
    ? '无上游记录'
    : s.diags.map(d => `${d.step}=${d.status}${d.body ? `(${d.body})` : ''}`).join(' / ')
}

/** 带上限的上游请求;返回 null 表示这次尝试失败(原因已记入 diags) */
async function fetchWithTimeout(s: GiteeSession, url: string, init: RequestInit): Promise<Response | null> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), upstreamTimeoutMs)
  try {
    return await fetch(url, { ...init, signal: ac.signal })
  } catch (err) {
    s.networkDown = true
    s.diags.push({
      step: 'fetch',
      status: ac.signal.aborted ? `超时 ${upstreamTimeoutMs}ms` : 'fetch 异常',
      body: err instanceof Error ? err.message : String(err),
    })
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function requestJson(s: GiteeSession, url: string, step: string): Promise<Response | null> {
  const res = await fetchWithTimeout(s, url, {
    headers: { Accept: 'application/json', 'User-Agent': 'mycal-reader' },
    cf: { cacheEverything: true, cacheTtl: TREE_TTL_SEC },
  })
  if (!res) return null
  if (!res.ok) {
    let body = ''
    try {
      body = snippet(await res.text())
    } catch {
      /* 读不到就算了,状态码本身已经够用 */
    }
    s.diags.push({ step, status: res.status, body })
    return null
  }
  return res
}

const repoBase = (c: RepoConf) => `${API_BASE}/repos/${c.owner}/${c.repo}`
const encodePath = (path: string) => path.split('/').map(encodeURIComponent).join('/')

// ---------- 文件树 ----------

interface GiteeTreeEntry {
  path?: unknown
  type?: unknown
  sha?: unknown
  size?: unknown
}

/** 分支最新 commit sha。比分支名精确(内容变了 sha 就变) */
async function resolveCommitSha(s: GiteeSession): Promise<string | null> {
  const { conf } = s
  const url = `${repoBase(conf)}/branches/${encodeURIComponent(conf.branch)}?access_token=${encodeURIComponent(conf.token)}`
  const res = await requestJson(s, url, 'branches')
  if (!res) return null
  try {
    const data = (await res.json()) as { commit?: { sha?: unknown } }
    return typeof data.commit?.sha === 'string' ? data.commit.sha : null
  } catch {
    s.diags.push({ step: 'branches', status: 'JSON 解析失败' })
    return null
  }
}

async function requestTree(s: GiteeSession, ref: string): Promise<{ sha?: unknown; truncated?: unknown; tree?: GiteeTreeEntry[] } | null> {
  const { conf } = s
  const url = `${repoBase(conf)}/git/trees/${encodeURIComponent(ref)}?recursive=1&access_token=${encodeURIComponent(conf.token)}`
  const res = await requestJson(s, url, `trees:${ref.slice(0, 8)}`)
  if (!res) return null
  try {
    return (await res.json()) as { sha?: unknown; truncated?: unknown; tree?: GiteeTreeEntry[] }
  } catch {
    s.diags.push({ step: 'trees', status: 'JSON 解析失败' })
    return null
  }
}

/**
 * 拉取仓库文件树(已过滤隐藏项)。
 *
 * 两个实测出来的坑:
 *  1. 树接口返回的顶层 `sha` **只是回显传入的 ref 名**(传 master 就回 "master"),不能当版本号,
 *     所以 rev 取分支接口的 commit sha;
 *  2. Gitee 对**不存在的分支返回 200 + 空树**(不是 404),必须显式判空,
 *     否则分支名写错会静默显示一棵空目录树。
 */
export async function fetchRemoteTree(s: GiteeSession): Promise<RemoteTree> {
  const commitSha = await resolveCommitSha(s)

  // 连不上就收手:再试第二个 ref 只会把「卡一次」放大成「卡两次」
  let data = s.networkDown ? null : await requestTree(s, commitSha ?? s.conf.branch)
  if (!s.networkDown && !data && commitSha !== null) data = await requestTree(s, s.conf.branch)

  if (!data) {
    throw new HttpError(
      502,
      `Gitee 文件树获取失败:仓库 ${s.conf.owner}/${s.conf.repo}、分支 ${s.conf.branch}。` +
        `上游记录 → ${diagText(s)}。` +
        (s.networkDown
          ? `这是 Worker 到 Gitee 的连接不通(超时/被拦/DNS),不是令牌问题。`
          : `排查提示:403 通常是 Gitee 拒绝了 Cloudflare 的出口 IP 或触发风控;` +
            `401 是 GITEE_TOKEN 无效;404 是仓库名或令牌的仓库授权范围不对。`),
    )
  }

  const files: RemoteFile[] = []
  for (const entry of data.tree ?? []) {
    if (entry.type !== 'blob') continue
    const path = typeof entry.path === 'string' ? entry.path : ''
    if (!path || isHidden(path)) continue
    files.push({
      path,
      size: typeof entry.size === 'number' ? entry.size : 0,
      sha: typeof entry.sha === 'string' ? entry.sha : '',
    })
  }

  if (files.length === 0) {
    const rawCount = Array.isArray(data.tree) ? data.tree.length : -1
    throw new HttpError(
      502,
      `仓库 ${s.conf.owner}/${s.conf.repo} 在分支 ${s.conf.branch} 上没有可读文件。` +
        `接口返回 200,tree 条目 ${rawCount === -1 ? '不存在' : rawCount} 条,过滤隐藏项后 0 条。` +
        `上游记录 → ${diagText(s)}。`,
    )
  }

  return {
    rev: commitSha ?? '',
    truncated: data.truncated === true,
    files,
  }
}

// ---------- 单个文件内容 ----------

/**
 * 取单个文件的原始字节。
 *
 * 按类型分流(实测语义不同,不能混):
 *   - 文本走 `contents?ref=`:Gitee 会把 GBK 等旧编码**规整成 UTF-8** ——
 *     这个仓库里大量 2022 年的 SQL 就是 GBK,走 blobs 会直接存成乱码;
 *   - 二进制走 `git/blobs/{sha}`:返回**原始字节**,内容寻址,字节必须和仓库一模一样。
 * 两条都失败时退到 raw 直链(实测对私有仓库一律 403,只对公开仓库有意义)。
 */
export async function fetchRemoteBytes(s: GiteeSession, path: string, sha: string): Promise<Uint8Array> {
  const { conf } = s
  const encoded = encodePath(path)
  const token = encodeURIComponent(conf.token)

  const fromJson = async (url: string, step: string): Promise<Uint8Array | null> => {
    const res = await requestJson(s, url, step)
    if (!res) return null
    let data: unknown
    try {
      data = await res.json()
    } catch {
      s.diags.push({ step, status: 'JSON 解析失败' })
      return null
    }
    // Gitee 用 200 + [] 表示「这个路径不存在」,不是 404
    if (Array.isArray(data)) {
      s.diags.push({ step, status: '路径不存在(200 + [])' })
      return null
    }
    const content = (data as { content?: unknown }).content
    // 空文件的 content 是空字符串,属于合法内容,不能当成失败
    if (typeof content !== 'string') {
      s.diags.push({ step, status: 200, body: '响应里没有 content 字段(可能文件过大)' })
      return null
    }
    return base64ToBytes(content.replace(/\s+/g, ''))
  }

  if (isTextPath(path)) {
    const bytes = await fromJson(`${repoBase(conf)}/contents/${encoded}?ref=${encodeURIComponent(conf.branch)}&access_token=${token}`, 'contents')
    if (bytes !== null) return bytes
    if (s.networkDown) throw unreachable(s, path)
    const raw = await fromJson(`${repoBase(conf)}/git/blobs/${encodeURIComponent(sha)}?access_token=${token}`, 'blobs')
    if (raw !== null) return raw
  } else {
    const raw = await fromJson(`${repoBase(conf)}/git/blobs/${encodeURIComponent(sha)}?access_token=${token}`, 'blobs')
    if (raw !== null) return raw
    if (s.networkDown) throw unreachable(s, path)
    const bytes = await fromJson(`${repoBase(conf)}/contents/${encoded}?ref=${encodeURIComponent(conf.branch)}&access_token=${token}`, 'contents')
    if (bytes !== null) return bytes
  }

  throw new HttpError(502, `读取文件失败:${path}。上游记录 → ${diagText(s)}`)
}

function unreachable(s: GiteeSession, path: string): HttpError {
  return new HttpError(
    502,
    `读取文件失败:${path}。上游记录 → ${diagText(s)}。` +
      `这说明 Worker 到 Gitee 的连接不通(超时/被拦/DNS),而不是文件不存在或权限不足。`,
  )
}
