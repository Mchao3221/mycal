// 同步的写入端(v0.6.1)。
//
// 这里只负责「收字节 → 存进 D1」。**取数不在这里做**:Cloudflare 到 Gitee 的网络实测不通
// (fetch 直接超时),所以由浏览器去 Gitee 取内容,再把字节 POST 上来。
//
// 为什么用原始字节放在请求体里,而不是 JSON + base64:
//   base64 会多 33% 体积,而且 Worker 侧要额外做一次解码(占 CPU)。
//   直接把字节放 body,worker 用 req.arrayBuffer() 拿到就能写库,零解码开销。
import { HttpError } from './http'
import { isBlobSha, normPath } from './paths'
import { getSyncMeta, listFiles, prune, saveSyncMeta, writeFile } from './store'
import { repoInfo } from './repo'
import type { Env } from './env'

/** 单个文件的体积上限:仓库里最大的文件是 2.4MB 的 epub,留足余量 */
const MAX_FILE_BYTES = 16 * 1024 * 1024

export interface SyncStatus {
  owner: string
  repo: string
  branch: string
  rev: string
  syncedAt: number
  fileCount: number
  totalBytes: number
}

export async function handleStatus(env: Env): Promise<SyncStatus> {
  const meta = await getSyncMeta(env.mycalDB)
  return { ...repoInfo(env), ...meta }
}

export interface PutResult {
  path: string
  sha: string
  size: number
  /** 是否真的产生了写入(内容寻址命中时为 false) */
  written: boolean
}

/**
 * 收一个文件的字节并入库。
 * path 与 sha 都来自客户端,必须校验:sha 只接受 40 位十六进制,path 走 normPath。
 */
export async function handlePut(env: Env, req: Request): Promise<PutResult> {
  const params = new URL(req.url).searchParams
  const path = normPath(params.get('path'))
  const sha = params.get('sha')
  if (!isBlobSha(sha)) throw new HttpError(400, 'sha 必须是 40 位十六进制')

  const buf = await req.arrayBuffer()
  if (buf.byteLength > MAX_FILE_BYTES) {
    throw new HttpError(413, `文件过大:${buf.byteLength} 字节(上限 ${MAX_FILE_BYTES})`)
  }

  const bytes = new Uint8Array(buf)
  const written = await writeFile(env.mycalDB, { path, sha, size: bytes.byteLength }, bytes)
  return { path, sha, size: bytes.byteLength, written }
}

export interface SyncFinishResult {
  removed: number
  fileCount: number
  totalBytes: number
  syncedAt: number
}

/** 收尾:删除远端已不存在的路径、清掉没人引用的内容块,并记录本次同步的 rev 与统计 */
export async function handleFinish(env: Env, body: unknown): Promise<SyncFinishResult> {
  const b = body as { paths?: unknown; rev?: unknown }
  const paths = Array.isArray(b?.paths) ? b.paths.filter((p): p is string => typeof p === 'string') : null
  if (!paths) throw new HttpError(400, 'paths 必须是字符串数组')

  const removed = await prune(env.mycalDB, paths)
  const files = await listFiles(env.mycalDB)
  const total = await env.mycalDB.prepare('SELECT COALESCE(SUM(size), 0) AS total FROM doc_files').first<{ total: number }>()

  const syncedAt = Date.now()
  await saveSyncMeta(env.mycalDB, {
    rev: typeof b.rev === 'string' ? b.rev : '',
    syncedAt,
    fileCount: files.length,
    totalBytes: total?.total ?? 0,
  })

  return { removed, fileCount: files.length, totalBytes: total?.total ?? 0, syncedAt }
}
