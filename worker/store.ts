// 同步语料的本地存储层(v0.6.0)。
//
// 阅读路径只碰这里,不再实时回源 Gitee。设计要点见 migrations/0007_doc_store.sql:
//   doc_files  文件清单(路径 → blob sha)
//   doc_blobs  内容,按 sha 内容寻址 + 分块
//   doc_meta   同步元信息
import type { Env } from './env'

type DB = Env['mycalDB']

/** 单块大小。D1 对单行/单值有大小上限,2.4MB 的 epub 必须分块存 */
const CHUNK_BYTES = 512 * 1024

export interface StoredFile {
  path: string
  sha: string
  size: number
}

export interface SyncMeta {
  rev: string
  syncedAt: number
  fileCount: number
  totalBytes: number
}

// ---------- 清单 ----------

export async function listFiles(db: DB): Promise<StoredFile[]> {
  const res = await db.prepare('SELECT path, sha, size FROM doc_files ORDER BY path').all<StoredFile>()
  return res.results ?? []
}

/** 路径 → sha 映射,用于和远端树比对出「需要重新拉取的文件」 */
export async function loadShaMap(db: DB): Promise<Map<string, string>> {
  const rows = await listFiles(db)
  return new Map(rows.map(r => [r.path, r.sha]))
}

export async function getFileRow(db: DB, path: string): Promise<StoredFile | null> {
  return db.prepare('SELECT path, sha, size FROM doc_files WHERE path = ?').bind(path).first<StoredFile>()
}

// ---------- 内容 ----------

/**
 * 写入一个文件的内容。
 * 先按 sha 判断是否已经存过 —— 内容寻址的意义就在这里:重复同步同一个文件不产生任何写入,
 * 也就不会因为「点了几次刷新」把 D1 的每日写入配额耗光。
 */
export async function writeFile(db: DB, file: StoredFile, bytes: Uint8Array): Promise<boolean> {
  const existed = await db.prepare('SELECT 1 AS ok FROM doc_blobs WHERE sha = ? LIMIT 1').bind(file.sha).first<{ ok: number }>()

  if (!existed) {
    const stmts: D1PreparedStatement[] = []
    // 至少写一块 —— 哪怕是 0 字节的空文件。
    // 不这么做的话空文件只会留下一行清单、没有任何内容块,读回时会被判成「不存在」
    //(仓库里确实有 0 字节的文件,这个坑踩过两次了)。
    const chunkCount = Math.max(1, Math.ceil(bytes.length / CHUNK_BYTES))
    for (let seq = 0; seq < chunkCount; seq++) {
      const chunk = bytes.subarray(seq * CHUNK_BYTES, Math.min((seq + 1) * CHUNK_BYTES, bytes.length))
      // 注意 subarray 的底层 buffer 可能是整块内存,必须切片后再绑定
      const buf = chunk.slice().buffer
      stmts.push(db.prepare('INSERT OR REPLACE INTO doc_blobs (sha, seq, data) VALUES (?, ?, ?)').bind(file.sha, seq, buf))
    }
    await db.batch(stmts)
  }

  await db
    .prepare(
      'INSERT INTO doc_files (path, sha, size, updated_at) VALUES (?, ?, ?, ?) ' +
        'ON CONFLICT(path) DO UPDATE SET sha = excluded.sha, size = excluded.size, updated_at = excluded.updated_at',
    )
    .bind(file.path, file.sha, file.size, Date.now())
    .run()

  return !existed
}

/** 读出文件内容;不存在返回 null */
export async function readFile(db: DB, path: string): Promise<{ file: StoredFile; bytes: Uint8Array } | null> {
  const file = await getFileRow(db, path)
  if (!file) return null

  const rows = await db
    .prepare('SELECT data FROM doc_blobs WHERE sha = ? ORDER BY seq')
    .bind(file.sha)
    .all<{ data: ArrayBuffer }>()
  const parts = rows.results ?? []
  // 老数据兜底:早期版本对 0 字节文件不写内容块(只留清单行),这里按 size 判定补上空内容
  if (parts.length === 0) {
    if (file.size === 0) return { file, bytes: new Uint8Array(0) }
    return null
  }

  let total = 0
  const buffers = parts.map(p => {
    const u8 = new Uint8Array(p.data)
    total += u8.byteLength
    return u8
  })
  const out = new Uint8Array(total)
  let offset = 0
  for (const b of buffers) {
    out.set(b, offset)
    offset += b.byteLength
  }
  return { file, bytes: out }
}

// ---------- 同步收尾 ----------

/** 删除清单里已不存在的路径,并清掉没人引用的内容块 */
export async function prune(db: DB, keepPaths: string[]): Promise<number> {
  const existing = await listFiles(db)
  const keep = new Set(keepPaths)
  const stale = existing.filter(f => !keep.has(f.path))
  if (stale.length > 0) {
    const stmts = stale.map(f => db.prepare('DELETE FROM doc_files WHERE path = ?').bind(f.path))
    await db.batch(stmts)
  }
  // 孤儿内容:清单里已经没有任何路径引用这个 sha
  await db.prepare('DELETE FROM doc_blobs WHERE sha NOT IN (SELECT sha FROM doc_files)').run()
  return stale.length
}

export async function clearAll(db: DB): Promise<void> {
  await db.batch([db.prepare('DELETE FROM doc_files'), db.prepare('DELETE FROM doc_blobs')])
}

// ---------- 元信息 ----------

export async function getMeta(db: DB, key: string): Promise<string | null> {
  const r = await db.prepare('SELECT value FROM doc_meta WHERE key = ?').bind(key).first<{ value: string }>()
  return r ? r.value : null
}

export async function setMeta(db: DB, key: string, value: string): Promise<void> {
  await db
    .prepare('INSERT INTO doc_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .bind(key, value)
    .run()
}

export async function getSyncMeta(db: DB): Promise<SyncMeta> {
  const [rev, syncedAt, fileCount, totalBytes] = await Promise.all([
    getMeta(db, 'sync.rev'),
    getMeta(db, 'sync.at'),
    getMeta(db, 'sync.count'),
    getMeta(db, 'sync.bytes'),
  ])
  return {
    rev: rev ?? '',
    syncedAt: Number(syncedAt ?? 0) || 0,
    fileCount: Number(fileCount ?? 0) || 0,
    totalBytes: Number(totalBytes ?? 0) || 0,
  }
}

export async function saveSyncMeta(db: DB, meta: SyncMeta): Promise<void> {
  await Promise.all([
    setMeta(db, 'sync.rev', meta.rev),
    setMeta(db, 'sync.at', String(meta.syncedAt)),
    setMeta(db, 'sync.count', String(meta.fileCount)),
    setMeta(db, 'sync.bytes', String(meta.totalBytes)),
  ])
}
