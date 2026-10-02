// 阅读 API(v0.6.0)。
//
// 只读同步进 D1 的本地副本,**不再实时回源 Gitee**。这是这次架构调整的核心:
// 实时回源会把「Cloudflare 到 Gitee 的链路质量」直接变成每次打开文件的体验,
// 链路一慢整站就慢;同步是一次性批量操作,慢可以接受,读路径必须快且稳定。
//
// 副作用(好的那种):读路径完全不需要令牌 —— 只要同步过一次,哪怕令牌失效了,
// 已经同步的内容照样能读。
import { HttpError } from './http'
import { repoInfo } from './gitee'
import { contentDisposition, contentTypeFor, normPath } from './paths'
import { getSyncMeta, listFiles, readFile } from './store'
import type { Env } from './env'

const FILE_TTL_SEC = 300
/** 内容寻址(带 sha 且与库中一致)的响应可以长缓存:内容变了 sha 就变了,URL 也就变了 */
const IMMUTABLE_TTL_SEC = 31536000

export interface TreeFile {
  path: string
  size: number
  sha: string
}

export interface DocsTree {
  owner: string
  repo: string
  branch: string
  /** 最近一次同步到的 commit sha */
  rev: string
  /** 最近一次同步完成时间;0 表示从未同步 */
  syncedAt: number
  fetchedAt: number
  files: TreeFile[]
  totalBytes: number
}

/** 文件树:直接读本地清单 */
export async function handleTree(env: Env): Promise<DocsTree> {
  const { owner, repo, branch } = repoInfo(env)
  const [files, meta] = await Promise.all([listFiles(env.mycalDB), getSyncMeta(env.mycalDB)])
  return {
    owner,
    repo,
    branch,
    rev: meta.rev,
    syncedAt: meta.syncedAt,
    fetchedAt: Date.now(),
    totalBytes: meta.totalBytes,
    files,
  }
}

/** 单个文件内容:直接读本地副本 */
export async function handleFile(env: Env, rawPath: string | null | undefined, shaHint?: string): Promise<Response> {
  const path = normPath(rawPath)
  const found = await readFile(env.mycalDB, path)
  if (!found) {
    // 未同步与真的不存在要分开报:前者是「点一下刷新就好」,后者是路径写错
    const meta = await getSyncMeta(env.mycalDB)
    if (meta.syncedAt === 0) {
      throw new HttpError(409, `仓库尚未同步,请点右上角「刷新」先同步一次(请求的文件:${path})`)
    }
    throw new HttpError(404, `文件不存在:${path}`)
  }

  const { file, bytes } = found
  // 只有「请求里带的 sha 和库里的一致」才敢长缓存 —— 否则路径可能已指向新内容
  const immutable = typeof shaHint === 'string' && shaHint.toLowerCase() === file.sha.toLowerCase()

  return new Response(bytes, {
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
