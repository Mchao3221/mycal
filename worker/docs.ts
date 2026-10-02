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

async function requestJson(url: string): Promise<Response> {
  return fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'mycal-reader' },
    cf: { cacheEverything: true, cacheTtl: TREE_TTL_SEC },
  })
}

/** 拿文件树;fresh 为 true 时用一次性查询参数绕开边缘缓存 */
async function requestTree(conf: RepoConf, ref: string, fresh: boolean): Promise<GiteeTreeData | null> {
  const bust = fresh ? `&_=${Date.now()}` : ''
  const url = `${API_BASE}/repos/${conf.owner}/${conf.repo}/git/trees/${encodeURIComponent(ref)}?recursive=1&access_token=${encodeURIComponent(conf.token)}${bust}`
  const res = await requestJson(url)
  if (!res.ok) return null
  try {
    return (await res.json()) as GiteeTreeData
  } catch {
    return null
  }
}

/** 分支最新 commit sha。它既是精确的树 ref,也是前端要的版本号。 */
async function resolveCommitSha(conf: RepoConf, fresh: boolean): Promise<string | null> {
  const bust = fresh ? `&_=${Date.now()}` : ''
  const url = `${API_BASE}/repos/${conf.owner}/${conf.repo}/branches/${encodeURIComponent(conf.branch)}?access_token=${encodeURIComponent(conf.token)}${bust}`
  const res = await requestJson(url)
  if (!res.ok) return null
  try {
    const data = (await res.json()) as { commit?: { sha?: unknown } }
    return typeof data.commit?.sha === 'string' ? data.commit.sha : null
  } catch {
    return null
  }
}

export async function fetchTree(env: Env, fresh = false): Promise<DocsTree> {
  const conf = confOf(env)

  // 先用分支接口换 commit sha:它比分支名精确(内容变了 sha 就变),可以安全地长缓存。
  const commitSha = await resolveCommitSha(conf, fresh)
  const ref = commitSha ?? conf.branch

  const data = await requestTree(conf, ref, fresh)
  if (!data) {
    throw new HttpError(502, `Gitee 文件树获取失败:仓库 ${conf.owner}/${conf.repo} 不可读,或 GITEE_TOKEN 无效/权限不足`)
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
  if (files.length === 0) {
    throw new HttpError(
      502,
      `仓库 ${conf.owner}/${conf.repo} 在分支 ${conf.branch} 上没有任何可读文件:分支名可能有误,或令牌缺少该仓库的读权限`,
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

function fileResponse(body: BodyInit, path: string, bytes?: Uint8Array): Response {
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': contentTypeFor(path, bytes),
      'Content-Disposition': contentDisposition(path),
      'Cache-Control': `private, max-age=${FILE_TTL_SEC}, stale-while-revalidate=86400`,
      'X-Content-Type-Options': 'nosniff',
    },
  })
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
async function tryBase64Json(url: string, status: Attempt): Promise<Uint8Array | null> {
  const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'mycal-reader' } })
  status.code = res.status
  if (!res.ok) {
    if (res.status === 404) status.notFound = true
    return null
  }
  let data: unknown
  try {
    data = await res.json()
  } catch {
    return null
  }
  if (Array.isArray(data)) {
    status.notFound = true
    return null
  }
  const content = (data as { content?: unknown }).content
  if (typeof content !== 'string') return null
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
 */
export async function fetchFile(env: Env, path: string): Promise<Response> {
  const conf = confOf(env)
  const encoded = encodePath(path)
  const token = encodeURIComponent(conf.token)
  const ref = encodeURIComponent(conf.branch)
  const repoBase = `${API_BASE}/repos/${conf.owner}/${conf.repo}`

  const contentsUrl = `${repoBase}/contents/${encoded}?ref=${ref}&access_token=${token}`
  const isText = TEXT_EXT.has(extOf(path))
  const contentsStatus: Attempt = { code: 0, notFound: false }
  const blobStatus: Attempt = { code: 0, notFound: false }
  let sha: string | null = null

  const tryBlobs = async (): Promise<Uint8Array | null> => {
    sha = await blobShaOf(env, path)
    if (!sha) return null
    return tryBase64Json(`${repoBase}/git/blobs/${encodeURIComponent(sha)}?access_token=${token}`, blobStatus)
  }

  // 注意用 !== null 而不是真值判断:0 字节文件的合法结果就是一个空的 Uint8Array,
  // 写成 if (bytes) 会让它被当成失败继续往下走,最后报一个莫名其妙的错。
  if (isText) {
    const bytes = await tryBase64Json(contentsUrl, contentsStatus)
    if (bytes !== null) return fileResponse(bytes, path, bytes)
    const raw = await tryBlobs()
    // 这里拿到的可能是 GBK 原始字节,fileResponse 会据此写对 charset
    if (raw !== null) return fileResponse(raw, path, raw)
  } else {
    const fromBlob = await tryBlobs()
    if (fromBlob !== null) return fileResponse(fromBlob, path)
    const bytes = await tryBase64Json(contentsUrl, contentsStatus)
    if (bytes !== null) return fileResponse(bytes, path)
  }

  // 兜底:raw 直链
  const rawUrl = `${WEB_BASE}/${conf.owner}/${conf.repo}/raw/${ref}/${encoded}?access_token=${token}`
  const raw = await fetch(rawUrl, {
    headers: { 'User-Agent': 'mycal-reader' },
    cf: { cacheEverything: true, cacheTtl: FILE_TTL_SEC },
  })
  if (raw.ok && raw.body) return fileResponse(raw.body, path)

  // 全失败:把每一级的状态码都报出来,便于区分「令牌无效」「路径写错」「文件过大」
  const codes = `contents=${contentsStatus.code || '未执行'} / blobs=${blobStatus.code || (sha ? '未执行' : '无 sha')} / raw=${raw.status}`
  if (contentsStatus.notFound || blobStatus.notFound || raw.status === 404) {
    throw new HttpError(404, `文件不存在:${path}`)
  }
  throw new HttpError(502, `读取文件失败:${path}(${codes})。请检查 GITEE_TOKEN 是否有效、是否具备该仓库的读权限`)
}
