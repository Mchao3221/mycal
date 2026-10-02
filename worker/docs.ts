// Gitee 私有仓库只读代理层(v0.5.0)。
//
// 为什么必须走服务端(两条都是实测结论,不是推测):
//   1. 仓库私有,匿名访问一律 404;且 raw 直链即使带上 access_token 也照样 403;
//   2. raw 直链不返回任何 CORS 头,浏览器直连根本拿不到内容
//      (对照:api/v5 返回 Access-Control-Allow-Origin: *)。
// 所以令牌只存在于 Worker 侧,浏览器永远不接触它,文件内容一律由 Worker 代取。
//
// 文件内容取数顺序(见 fetchFile 注释):contents -> git/blobs -> raw 兜底。
// 三级全失败时把每一级的状态码一起报出来,便于区分「令牌无效」「路径写错」「文件过大」。

import { HttpError } from './http'
import type { Env } from './env'

const API_BASE = 'https://gitee.com/api/v5'
const WEB_BASE = 'https://gitee.com'

const DEFAULT_OWNER = 'chu-tianshu'
const DEFAULT_REPO = 'my-docs'
const DEFAULT_BRANCH = 'master'

/** 文档仓库按小时级更新(Obsidian Git 自动备份),分钟级缓存足够,同时给手动刷新留出口 */
const TREE_TTL_SEC = 60
const FILE_TTL_SEC = 300
/** 内容寻址(带 sha)的响应可以长缓存:内容变了 sha 就变了,URL 也就变了 */
const IMMUTABLE_TTL_SEC = 31536000

/**
 * 单个上游请求的超时。
 *
 * 这个值不是拍脑袋来的:线上曾出现「打开一个 30K 的文件要几分钟」,而本地实测取数 10ms、
 * 渲染 <1ms —— 说明耗时全在 Cloudflare 到 Gitee 这一段。回退链在失败时最多要打 5 个上游请求
 * (contents → branches → trees → blobs → raw),每个都挂住的话就是几分钟。
 * 有了这个上限,最坏情况也是有界的,而且超时会作为「fetch 异常」写进诊断,
 * 一眼就能和「上游返回 4xx」区分开。
 */
const UPSTREAM_TIMEOUT_MS = 8000

interface RepoConf {
  owner: string
  repo: string
  branch: string
  token: string
}

export interface TreeFile {
  /** 仓库内相对路径,正斜杠分隔 */
  path: string
  size: number
  sha: string
}

export interface DocsTree {
  owner: string
  repo: string
  branch: string
  /** 文件树 sha,内容一变它就变,前端可当版本号用 */
  rev: string
  fetchedAt: number
  /** Gitee 侧树被截断时为 true(条数过多),前端需要提示 */
  truncated: boolean
  files: TreeFile[]
}

function confOf(env: Env): RepoConf {
  const token = (env.GITEE_TOKEN ?? '').trim()
  if (!token) {
    throw new HttpError(
      500,
      '未配置 GITEE_TOKEN:本地请在项目根目录的 .dev.vars 里填写,生产用 wrangler secret put GITEE_TOKEN',
    )
  }
  return {
    owner: (env.GITEE_OWNER ?? DEFAULT_OWNER).trim(),
    repo: (env.GITEE_REPO ?? DEFAULT_REPO).trim(),
    branch: (env.GITEE_BRANCH ?? DEFAULT_BRANCH).trim(),
    token,
  }
}

/** 路径段编码,保留 '/' 作为分隔符 */
const encodePath = (path: string) => path.split('/').map(encodeURIComponent).join('/')

/**
 * 校验并规范化客户端传来的 path。
 * 这里同时挡住目录穿越(../)、空段(//)、反斜杠与控制字符,
 * 保证拼出来的 URL 永远落在仓库内部,不会变成第二个主机名。
 */
export function normPath(raw: string | null | undefined): string {
  const trimmed = (raw ?? '').trim()
  if (!trimmed) throw new HttpError(400, '缺少 path 参数')
  if (trimmed.length > 1024) throw new HttpError(400, 'path 过长')
  const path = trimmed.replace(/^\/+/, '')
  if (!path) throw new HttpError(400, 'path 不能为空')
  if (path.includes('\\')) throw new HttpError(400, 'path 含非法字符')
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(path)) throw new HttpError(400, 'path 含控制字符')
  if (/[?#]/.test(path)) throw new HttpError(400, 'path 含非法字符')
  for (const seg of path.split('/')) {
    if (!seg || seg === '.' || seg === '..') throw new HttpError(400, 'path 含非法路径段')
  }
  return path
}

/** 任何以 '.' 开头的路径段都视为隐藏:挡掉 .obsidian/、.tmp_legal_ch3/、.gitignore */
function isHidden(path: string): boolean {
  return path.split('/').some(seg => seg.startsWith('.'))
}

// ---------- 目录树 ----------

interface GiteeTreeEntry {
  path?: unknown
  type?: unknown
  sha?: unknown
  size?: unknown
}

interface GiteeTreeData {
  sha?: unknown
  truncated?: unknown
  tree?: GiteeTreeEntry[]
}

/**
 * 上游诊断记录。
 *
 * 为什么要有它:线上第一次部署时 Cloudflare 侧拿到了 502,而当时的文案只有「不可读,
 * 或令牌无效」—— 没法区分是「Gitee 拒绝了 Cloudflare 的出口 IP」「令牌没生效」还是
 * 「接口路径变了」。云端调试一轮要走一次 CI,所以宁可把上游的真实状态码和响应片段
 * 一路带到前端,让一次请求就能定位。
 * 注意:只记状态码和响应体片段,**绝不记 URL**(URL 里带 access_token)。
 */
interface Diag {
  step: string
  status: number | string
  body?: string
}

let diags: Diag[] = []
/** 本次请求里是否出现过「连不上」类错误(超时/DNS/TLS)。
 *  一旦出现就没必要再试后面的回退了 —— 那是整条链路不通,不是某一个接口的问题。
 *  没有这一条,卡住一次会变成卡住五次,用户看到的就是"转几分钟"。 */
let networkDown = false

function snippet(text: string, max = 200): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? flat.slice(0, max) + '…' : flat
}

function diagText(): string {
  return diags.length === 0 ? '无上游记录' : diags.map(d => `${d.step}=${d.status}${d.body ? `(${d.body})` : ''}`).join(' / ')
}

/** 带上限的上游请求;返回 null 表示这次尝试失败(原因已记入 diags) */
async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response | null> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), UPSTREAM_TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: ac.signal })
  } catch (err) {
    networkDown = true
    diags.push({
      step: 'fetch',
      status: ac.signal.aborted ? `超时 ${UPSTREAM_TIMEOUT_MS}ms` : 'fetch 异常',
      body: err instanceof Error ? err.message : String(err),
    })
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** 带诊断的上游 JSON 请求 */
async function requestJson(url: string, step: string): Promise<Response | null> {
  const res = await fetchWithTimeout(url, {
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
    diags.push({ step, status: res.status, body })
    return null
  }
  return res
}

/** 拿文件树;fresh 为 true 时用一次性查询参数绕开边缘缓存 */
async function requestTree(conf: RepoConf, ref: string, fresh: boolean): Promise<GiteeTreeData | null> {
  const bust = fresh ? `&_=${Date.now()}` : ''
  const url = `${API_BASE}/repos/${conf.owner}/${conf.repo}/git/trees/${encodeURIComponent(ref)}?recursive=1&access_token=${encodeURIComponent(conf.token)}${bust}`
  const res = await requestJson(url, `trees:${ref.slice(0, 8)}`)
  if (!res) return null
  try {
    return (await res.json()) as GiteeTreeData
  } catch (err) {
    diags.push({ step: 'trees', status: 'JSON 解析失败', body: err instanceof Error ? err.message : '' })
    return null
  }
}

/** 分支最新 commit sha。它既是精确的树 ref,也是前端要的版本号。 */
async function resolveCommitSha(conf: RepoConf, fresh: boolean): Promise<string | null> {
  const bust = fresh ? `&_=${Date.now()}` : ''
  const url = `${API_BASE}/repos/${conf.owner}/${conf.repo}/branches/${encodeURIComponent(conf.branch)}?access_token=${encodeURIComponent(conf.token)}${bust}`
  const res = await requestJson(url, 'branches')
  if (!res) return null
  try {
    const data = (await res.json()) as { commit?: { sha?: unknown } }
    return typeof data.commit?.sha === 'string' ? data.commit.sha : null
  } catch (err) {
    diags.push({ step: 'branches', status: 'JSON 解析失败', body: err instanceof Error ? err.message : '' })
    return null
  }
}

export async function fetchTree(env: Env, fresh = false): Promise<DocsTree> {
  const conf = confOf(env)
  diags = []
  networkDown = false

  // 用分支接口换 commit sha:它比分支名精确(内容变了 sha 就变),可以安全地长缓存。
  // 换不到就退回分支名当 ref,并且两个 ref 都试一遍 —— 少一次「云端 502 只能靠猜」。
  const commitSha = await resolveCommitSha(conf, fresh)

  // 连不上就收手:再试第二个 ref 只会把「卡一次」放大成「卡两次」,用户感知到的就是转圈
  let data = networkDown ? null : await requestTree(conf, commitSha ?? conf.branch, fresh)
  if (!networkDown && !data && commitSha !== null) data = await requestTree(conf, conf.branch, fresh)
  if (!data) {
    throw new HttpError(
      502,
      `Gitee 文件树获取失败:仓库 ${conf.owner}/${conf.repo}、分支 ${conf.branch}。` +
        `上游记录 → ${diagText()}。` +
        (networkDown
          ? `这是 Worker 到 Gitee 的连接不通(超时/被拦/DNS),不是令牌问题。` +
            `持续出现的话需要改用「把仓库同步到 Cloudflare 存储」的方案,不再依赖实时回源。`
          : `排查提示:出现 403 通常是 Gitee 拒绝了 Cloudflare 的出口 IP 或触发风控;` +
            `出现 401 则是 GITEE_TOKEN 无效;出现 404 则是仓库名或令牌的仓库授权范围不对。`),
    )
  }

  const files: TreeFile[] = []
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

  // 实测:Gitee 对不存在的分支返回 200 + 空树(不是 404)。不显式拦这一手,
  // 分支名写错时会静默显示一棵空目录树,排查起来非常费劲。
  //
  // 这里必须把「接口原始返回了多少条」和上游诊断一起报出来:
  // 「200 但 tree 为空」与「403 被拦」是两种完全不同的故障,只看一句"读不到文件"分不出来。
  // 尤其是令牌未生效或触发风控时,Gitee 可能回 200 带一个错误体,此时 data.tree 是 undefined。
  if (files.length === 0) {
    const rawCount = Array.isArray(data.tree) ? data.tree.length : -1
    const keys = Object.keys(data).join(',') || '(空对象)'
    throw new HttpError(
      502,
      `仓库 ${conf.owner}/${conf.repo} 在分支 ${conf.branch} 上没有可读文件。` +
        `接口返回 200,响应顶层字段 [${keys}],tree 条目 ${rawCount === -1 ? '不存在' : rawCount} 条,过滤隐藏项后 0 条。` +
        `上游记录 → ${diagText()}。` +
        `若 tree 条目不存在,多半是令牌未生效或触发风控(Gitee 有时用 200 带错误体);` +
        `若是 0 条,则是分支名写错。`,
    )
  }

  return {
    owner: conf.owner,
    repo: conf.repo,
    branch: conf.branch,
    // 注意:树接口返回的顶层 sha 只是回显传入的 ref,不能当版本号,所以这里用 commit sha
    rev: commitSha ?? '',
    fetchedAt: Date.now(),
    truncated: data.truncated === true,
    files,
  }
}

// ---------- 文件内容 ----------

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  avif: 'image/avif',
  ico: 'image/x-icon',
  svg: 'image/svg+xml',
  epub: 'application/epub+zip',
  pdf: 'application/pdf',
  zip: 'application/zip',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
}

/**
 * 文本类一律按 text/plain 下发:前端自己渲染,同时避免仓库里的 HTML 在本站执行。
 * worker 用它决定走 contents(会被 Gitee 转成 UTF-8)还是 git/blobs(原始字节),
 * 前端 src/utils/fileKind.ts 用基本同源的清单决定按文本读还是当二进制资源用。
 *
 * 唯一的例外是 `excalidraw`:worker 把它当文本下发(这样"新窗口打开"里能直接读到 JSON 原文,
 * 而不是变成一个下载),但前端已不再做画布渲染,把它归到 external。
 */
const TEXT_EXT = new Set([
  'md', 'markdown', 'txt', 'sql', 'json', 'excalidraw', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx',
  'css', 'scss', 'less', 'html', 'htm', 'xml', 'yml', 'yaml', 'toml', 'ini', 'conf', 'cfg',
  'sh', 'bash', 'ps1', 'bat', 'cmd', 'py', 'go', 'java', 'rb', 'rs', 'c', 'h', 'cpp', 'hpp',
  'cs', 'php', 'kt', 'swift', 'lua', 'pl', 'r', 'vue', 'svelte', 'log', 'csv', 'tsv',
])

function extOf(path: string): string {
  const name = path.split('/').pop() ?? ''
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(i + 1).toLowerCase() : ''
}

/**
 * 文本响应类型。Gitee 的 contents 接口会自动把 GBK 这类旧编码规整成 UTF-8,
 * 但 git/blobs 返回的是原始字节,所以这里必须验一次:
 * 不是合法 UTF-8 就把真实编码写进 charset,交给浏览器去解码,绝不能让中文变成乱码。
 */
function textContentType(bytes: Uint8Array): string {
  try {
    new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes)
    return 'text/plain; charset=utf-8'
  } catch {
    return 'text/plain; charset=gb18030'
  }
}

function contentTypeFor(path: string, bytes?: Uint8Array): string {
  const ext = extOf(path)
  if (TEXT_EXT.has(ext)) return bytes ? textContentType(bytes) : 'text/plain; charset=utf-8'
  return MIME[ext] ?? 'application/octet-stream'
}

/** inline + 双写 filename:中文名在 Chrome 里也能拿到正确的下载名 */
function contentDisposition(path: string): string {
  const name = path.split('/').pop() ?? 'file'
  const ascii = name.replace(/[^\u0020-\u007e]/g, '_').replace(/["\\]/g, '_')
  return `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`
}

/**
 * immutable=true 用于走 git/blobs 拿到的内容:那是内容寻址的,sha 不变内容就一定不变,
 * 所以同一条 URL(带 sha)可以放心长期缓存 —— 再次打开同一个文件就是浏览器缓存命中,零请求。
 * 走 contents 的内容是路径寻址的(可能被改),只能用短缓存。
 */
function fileResponse(body: BodyInit, path: string, bytes?: Uint8Array, immutable = false): Response {
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': contentTypeFor(path, bytes),
      'Content-Disposition': contentDisposition(path),
      'Cache-Control': immutable
        ? `private, max-age=${IMMUTABLE_TTL_SEC}, immutable`
        : `private, max-age=${FILE_TTL_SEC}, stale-while-revalidate=86400`,
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

/** 整条链路连不上时的统一报错:带上诊断,并明确告诉用户这是网络问题而不是权限问题 */
function unreachable(path: string): HttpError {
  return new HttpError(
    502,
    `读取文件失败:${path}。上游记录 → ${diagText()}。` +
      `这说明 Worker 到 Gitee 的连接不通(超时/被拦/DNS),而不是文件不存在或权限不足。` +
      `若是持续出现,需要改用「把仓库同步到 Cloudflare 存储」的方案,不再依赖实时回源。`,
  )
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** 从（已缓存的）文件树里找某个路径的 blob sha,供 git/blobs 接口使用 */
async function blobShaOf(env: Env, path: string): Promise<string | null> {
  try {
    const tree = await fetchTree(env)
    return tree.files.find(f => f.path === path)?.sha || null
  } catch {
    return null
  }
}

/** 一次取数尝试的结果:状态码 + Gitee 特有的「路径不存在」信号 */
interface Attempt {
  code: number
  notFound: boolean
}

/**
 * 取 JSON 并把其中的 base64 内容解出来。
 *
 * 两个坑都是实测出来的:
 *  1. **路径不存在时 Gitee 返回 200 + `[]`**(它把这当成"这个目录里没有文件"),不是 404,
 *     所以必须显式识别数组响应,否则会把它当成"令牌有问题"报错,误导排查方向;
 *  2. **空文件的 `content` 是空字符串**,属于合法内容,不能当成取失败 ——
 *     仓库里确实有 0 字节的文件,按失败处理会让它永远打不开。
 */
async function tryBase64Json(url: string, status: Attempt, step: string): Promise<Uint8Array | null> {
  const res = await fetchWithTimeout(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'mycal-reader' },
  })
  if (!res) return null
  status.code = res.status
  if (!res.ok) {
    if (res.status === 404) status.notFound = true
    let body = ''
    try {
      body = snippet(await res.text())
    } catch {
      /* 状态码够用 */
    }
    diags.push({ step, status: res.status, body })
    return null
  }
  let data: unknown
  try {
    data = await res.json()
  } catch (err) {
    diags.push({ step, status: 'JSON 解析失败', body: err instanceof Error ? err.message : '' })
    return null
  }
  if (Array.isArray(data)) {
    // Gitee 用 200 + [] 表示「这个路径不存在」,不是 404
    status.notFound = true
    return null
  }
  const content = (data as { content?: unknown }).content
  if (typeof content !== 'string') {
    diags.push({ step, status: 200, body: '响应里没有 content 字段(可能文件过大)' })
    return null
  }
  return base64ToBytes(content.replace(/\s+/g, ''))
}

/**
 * 取文件内容。顺序按文件类型分流,原因是两条接口的语义实测不同:
 *
 *   文本(.md/.sql/.txt/...):contents 优先 —— Gitee 会顺手把 GBK 等旧编码规整成 UTF-8,
 *     而 git/blobs 返回的是原始 GBK 字节。这个仓库里大量 2022 年的 SQL 就是 GBK 的,
 *     走 blobs 当首选会直接把中文渲染成乱码。
 *   二进制(图片/epub/pptx/xlsx/zip):git/blobs 优先 —— 内容寻址(sha 不变内容就不变,
 *     天然可长缓存),且绝无转码风险,字节必须和仓库一模一样。
 *
 * 两者都失败时退到 raw 直链(实测 Gitee 对私有仓库一律 403,只留给公开仓库)。
 *
 * `shaHint` 由前端从文件树里带过来。这一条对性能影响很大:没有它,走 blobs 就必须先
 * 拉一次完整文件树(还是 branches + trees 两个请求)才能把路径换成 sha;有了它,
 * 打开一个文件最多就一次上游请求。前端本来就已经持有整棵树,不用白不用。
 */
export async function fetchFile(env: Env, path: string, shaHint?: string): Promise<Response> {
  const conf = confOf(env)
  diags = []
  networkDown = false
  const encoded = encodePath(path)
  const token = encodeURIComponent(conf.token)
  const ref = encodeURIComponent(conf.branch)
  const repoBase = `${API_BASE}/repos/${conf.owner}/${conf.repo}`

  const contentsUrl = `${repoBase}/contents/${encoded}?ref=${ref}&access_token=${token}`
  const isText = TEXT_EXT.has(extOf(path))
  const contentsStatus: Attempt = { code: 0, notFound: false }
  const blobStatus: Attempt = { code: 0, notFound: false }

  // 只接受 40 位十六进制的 sha:前端传来的是客户端数据,不能直接拼进 URL
  const sha = shaHint && /^[0-9a-f]{40}$/i.test(shaHint) ? shaHint : null

  /** 走 blobs 取内容;有 shaHint 就直接用,否则才去拉一次文件树换 sha */
  const tryBlobs = async (): Promise<Uint8Array | null> => {
    const realSha = sha ?? (await blobShaOf(env, path))
    if (!realSha) return null
    return tryBase64Json(`${repoBase}/git/blobs/${encodeURIComponent(realSha)}?access_token=${token}`, blobStatus, 'blobs')
  }

  // 注意用 !== null 而不是真值判断:0 字节文件的合法结果就是一个空的 Uint8Array,
  // 写成 if (bytes) 会让它被当成失败继续往下走,最后报一个莫名其妙的错。
  if (isText) {
    const bytes = await tryBase64Json(contentsUrl, contentsStatus, 'contents')
    if (bytes !== null) return fileResponse(bytes, path, bytes)
    // 整条链路连不上时立刻收手:接着试 blobs / raw 只会再挂两次,把"慢"变成"更慢"
    if (networkDown) throw unreachable(path)
    const raw = await tryBlobs()
    // 这里拿到的可能是 GBK 原始字节,fileResponse 会据此写对 charset
    if (raw !== null) return fileResponse(raw, path, raw)
  } else {
    const fromBlob = await tryBlobs()
    if (fromBlob !== null) return fileResponse(fromBlob, path, undefined, true)
    if (networkDown) throw unreachable(path)
    const bytes = await tryBase64Json(contentsUrl, contentsStatus, 'contents')
    if (bytes !== null) return fileResponse(bytes, path)
  }

  // 兜底:raw 直链(实测对私有仓库一律 403,只对公开仓库有意义)。
  // 这里不能用 requestJson:它会带 Accept: application/json,而 raw 返回的是文件原文/二进制。
  if (!networkDown) {
    const rawUrl = `${WEB_BASE}/${conf.owner}/${conf.repo}/raw/${ref}/${encoded}?access_token=${token}`
    const rawRes = await fetchWithTimeout(rawUrl, {
      headers: { 'User-Agent': 'mycal-reader' },
      cf: { cacheEverything: true, cacheTtl: FILE_TTL_SEC },
    })
    if (rawRes?.ok && rawRes.body) return fileResponse(rawRes.body, path)
    if (rawRes) {
      diags.push({ step: 'raw', status: rawRes.status })
      if (rawRes.status === 404) throw new HttpError(404, `文件不存在:${path}`)
    }
  }

  if (contentsStatus.notFound || blobStatus.notFound) {
    throw new HttpError(404, `文件不存在:${path}`)
  }
  throw new HttpError(
    502,
    `读取文件失败:${path}。上游记录 → ${diagText()}。` +
      `排查提示:出现「fetch 异常」或 403,通常是 Gitee 拒绝了 Cloudflare 的出口 IP 或触发风控;` +
      `出现 401,则是 GITEE_TOKEN 无效。`,
  )
}
