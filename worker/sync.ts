// 同步流程(v0.6.0):把 Gitee 仓库搬进 D1。
//
// 为什么拆成「plan → files(多批)→ finish」三步而不是一个请求做完:
//   1. 一个 Worker 请求的时间与 CPU 都有上限,828 个文件 + 2.4MB 的 epub 一次做完会超;
//   2. 拆开之后前端能显示进度,也能在中断后重来(内容寻址,重来不会重复写);
//   3. 每一步都无状态:没有跨请求的会话,中断了再点一次刷新就是续传。
import { HttpError } from './http'
import { diagText, fetchRemoteBytes, fetchRemoteTree, openSession, repoInfo } from './gitee'
import { isBlobSha, normPath } from './paths'
import { getSyncMeta, listFiles, loadShaMap, prune, saveSyncMeta, writeFile } from './store'
import type { Env } from './env'

/** 单批最多处理多少个文件 */
const MAX_FILES_PER_BATCH = 8
/**
 * 单批的时间预算。超了就先把这批做完、返回给前端再来一轮。
 * 不能让它无限跑:一个请求拖太久,前端和 Cloudflare 都会先放弃。
 */
const BATCH_BUDGET_MS = 15000

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
  const { owner, repo, branch } = repoInfo(env)
  const meta = await getSyncMeta(env.mycalDB)
  return { owner, repo, branch, ...meta }
}

export interface SyncPlanItem {
  path: string
  sha: string
  size: number
}

export interface SyncPlan {
  rev: string
  /** 远端文件总数 */
  total: number
  /** 需要拉取的文件(新增的 + 内容变了的) */
  need: SyncPlanItem[]
  /** 内容没变、一个字节都不用写的文件数 */
  unchanged: number
  /** 本地有、远端已没有(收尾时删除) */
  removed: number
  /** 全部远端路径,finish 时原样回传用于清理 */
  paths: string[]
  /** 上游诊断,只在出错时才有内容 */
  diag?: string
}

/** 第一步:拉远端树,和本地清单比对出要同步的差异 */
export async function handlePlan(env: Env): Promise<SyncPlan> {
  const s = openSession(env)
  const remote = await fetchRemoteTree(s)
  const localShas = await loadShaMap(env.mycalDB)

  const need: SyncPlanItem[] = []
  let unchanged = 0
  for (const f of remote.files) {
    if (localShas.get(f.path) === f.sha) unchanged += 1
    else need.push({ path: f.path, sha: f.sha, size: f.size })
  }

  const remotePaths = new Set(remote.files.map(f => f.path))
  const removed = [...localShas.keys()].filter(p => !remotePaths.has(p)).length

  return {
    rev: remote.rev,
    total: remote.files.length,
    need,
    unchanged,
    removed,
    paths: remote.files.map(f => f.path),
  }
}

export interface SyncApplyResult {
  saved: number
  /** 本次真的产生了写入的文件数(内容寻址命中时不会有写入) */
  written: number
  failed: { path: string; error: string }[]
  /** 是否已到时间预算(前端据此决定还要不要再发一批) */
  more: boolean
  diag: string
}

/**
 * 第二步:把一批文件的内容取回来入库。
 *
 * 前端每次传一小批 `{path, sha}`,由 Worker 去 Gitee 取内容 —— 这样令牌始终留在服务端。
 * path 与 sha 都会校验:客户端数据不直接拼进上游 URL。
 */
export async function handleFiles(env: Env, body: unknown): Promise<SyncApplyResult> {
  const items = (body as { items?: unknown })?.items
  if (!Array.isArray(items) || items.length === 0) throw new HttpError(400, 'items 不能为空')
  if (items.length > MAX_FILES_PER_BATCH) {
    throw new HttpError(400, `一次最多处理 ${MAX_FILES_PER_BATCH} 个文件,收到 ${items.length} 个`)
  }

  const s = openSession(env)
  const started = Date.now()
  const result: SyncApplyResult = { saved: 0, written: 0, failed: [], more: false, diag: '' }

  for (const raw of items) {
    const item = raw as { path?: unknown; sha?: unknown }
    let path: string
    try {
      path = normPath(typeof item.path === 'string' ? item.path : '')
    } catch (err) {
      result.failed.push({ path: String(item.path ?? ''), error: err instanceof Error ? err.message : '路径非法' })
      continue
    }
    if (!isBlobSha(item.sha)) {
      result.failed.push({ path, error: 'sha 非法' })
      continue
    }

    try {
      const bytes = await fetchRemoteBytes(s, path, item.sha)
      const written = await writeFile(env.mycalDB, { path, sha: item.sha, size: bytes.byteLength }, bytes)
      result.saved += 1
      if (written) result.written += 1
    } catch (err) {
      // 单个文件失败不中断整批:剩下的继续,失败项回给前端展示
      result.failed.push({ path, error: err instanceof Error ? err.message : String(err) })
      // 整条链路连不上就别再试后面的了,直接结束这一批
      if (s.networkDown) {
        result.more = false
        break
      }
    }

    if (Date.now() - started > BATCH_BUDGET_MS) {
      result.more = true
      break
    }
  }

  result.diag = diagText(s)
  return result
}

export interface SyncFinishResult {
  removed: number
  fileCount: number
  totalBytes: number
  syncedAt: number
}

/**
 * 第三步:收尾。
 * 删除远端已不存在的路径、清掉没人引用的内容块,并记录本次同步的 rev 与统计。
 */
export async function handleFinish(env: Env, body: unknown): Promise<SyncFinishResult> {
  const b = body as { paths?: unknown; rev?: unknown }
  const paths = Array.isArray(b?.paths) ? b.paths.filter((p): p is string => typeof p === 'string') : null
  if (!paths) throw new HttpError(400, 'paths 必须是字符串数组')

  const removed = await prune(env.mycalDB, paths)
  const files = await listFiles(env.mycalDB)
  const totalBytes = await env.mycalDB
    .prepare('SELECT COALESCE(SUM(size), 0) AS total FROM doc_files')
    .first<{ total: number }>()

  const syncedAt = Date.now()
  await saveSyncMeta(env.mycalDB, {
    rev: typeof b.rev === 'string' ? b.rev : '',
    syncedAt,
    fileCount: files.length,
    totalBytes: totalBytes?.total ?? 0,
  })

  return { removed, fileCount: files.length, totalBytes: totalBytes?.total ?? 0, syncedAt }
}
