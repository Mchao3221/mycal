#!/usr/bin/env node
/**
 * 把本地文档目录同步到阅读器(v0.6.2)。
 *
 * 为什么是「读本地目录」而不是去 Gitee 取:
 *   三条网络路径实测全都不通/不稳 ——
 *     · Cloudflare Worker → gitee.com : fetch 直接超时(网络不通)
 *     · 浏览器 fetch       → gitee.com : 被 Gitee 的 WAF 拦成 403
 *     · 本机 Node 连续请求  → gitee.com : 前 150 个成功,之后被风控限流成 403
 *   而文档本来就在这台机器上:你 `git pull` 之后跑一次本命令即可,不碰网络、不受限流、
 *   还省掉了令牌。读路径依旧只读 Cloudflare D1 里的副本。
 *
 * 用法(需要 Node 18+,因为用到全局 fetch):
 *   node tools/sync-docs.mjs                          # 读 .dev.vars 里的配置
 *   node tools/sync-docs.mjs --url http://localhost:5173
 *   node tools/sync-docs.mjs --url https://xxx.workers.dev --password 访问码
 *   node tools/sync-docs.mjs --dir D:\path\to\my-docs
 *
 * .dev.vars 里可用的键:
 *   DOCS_DIR        本地文档目录(默认 C:\03Docs\my-docs)
 *   SYNC_URL        阅读器地址(默认 http://localhost:5173)
 *   SYNC_PASSWORD   阅读器访问码(不填则用 --password 参数)
 *
 * 幂等:内容按 **内容自身的 git blob 哈希** 寻址,已同步过的文件不会重复上传,
 * 中断后重跑就是续传;本地删掉的文件会在收尾时从服务端一并清理。
 */
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, relative, resolve, sep } from 'node:path'

const CONCURRENCY = 4
const TIMEOUT_MS = 30000
const DEFAULT_DIR = 'C:\\03Docs\\my-docs'
const DEFAULT_URL = 'http://localhost:5173'

// ---------- 配置 ----------

function loadDevVars() {
  const out = {}
  try {
    const text = readFileSync(resolve(process.cwd(), '.dev.vars'), 'utf8')
    for (const line of text.split(/\r?\n/)) {
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line)
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch {
    /* 没有 .dev.vars 就靠命令行参数 */
  }
  return out
}

const argv = process.argv.slice(2)
const arg = name => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : undefined
}

const devVars = loadDevVars()
const cfg = {
  dir: (arg('dir') ?? process.env.DOCS_DIR ?? devVars.DOCS_DIR ?? DEFAULT_DIR).trim(),
  url: (arg('url') ?? process.env.SYNC_URL ?? devVars.SYNC_URL ?? DEFAULT_URL).replace(/\/+$/, ''),
  password: (arg('password') ?? process.env.SYNC_PASSWORD ?? devVars.SYNC_PASSWORD ?? '').trim(),
}

const enc = encodeURIComponent
const log = (...a) => console.log(...a)

function fail(msg) {
  console.error(`\n[错误] ${msg}\n`)
  process.exit(1)
}

// ---------- 本地目录扫描 ----------

/**
 * 算 git blob 哈希:sha1("blob <字节数>\0" + 内容)。
 *
 * 用内容自己的哈希而不是 git 里的 sha,有两个好处:
 *   1. 与内容严格对应 —— 存进去的 (路径, sha) 永远描述的是同一份内容;
 *   2. 本地改了但还没提交的文件也能被正确识别为「变化了」,不会因为 sha 没变而漏同步。
 */
function blobSha(bytes) {
  const h = createHash('sha1')
  h.update(`blob ${bytes.length}\0`)
  h.update(bytes)
  return h.digest('hex')
}

/** 任何以 '.' 开头的路径段都视为隐藏(与前端、worker 的过滤规则一致) */
const isHidden = rel => rel.split(/[\\/]/).some(seg => seg.startsWith('.'))

/**
 * 不进阅读器的扩展名(与 worker/paths.ts 的 IGNORED_EXT 保持一致)。
 * zip 是纯归档,阅读器不解压也不下载,列在目录里只会干扰浏览 —— 干脆不上传。
 * 因为收尾时是按本清单裁剪的,之前误传进去的 zip 也会在下次同步时被删掉。
 */
const IGNORED_EXT = new Set(['zip'])
const isIgnored = rel => {
  const name = rel.split(/[\\/]/).pop() ?? ''
  const i = name.lastIndexOf('.')
  return i > 0 && IGNORED_EXT.has(name.slice(i + 1).toLowerCase())
}

function walk(dir, base = dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const rel = relative(base, full)
    if (isHidden(rel) || isIgnored(rel)) continue
    const st = statSync(full)
    if (st.isDirectory()) walk(full, base, out)
    else if (st.isFile()) out.push({ rel: rel.split(sep).join('/'), full, size: st.size })
  }
  return out
}

/** 取 HEAD 作为版本号;没有 git 就退回内容指纹,不影响同步本身 */
function resolveRev(dir, files) {
  try {
    return execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  } catch {
    const h = createHash('sha1')
    for (const f of files) h.update(f.rel + ':' + f.sha)
    return h.digest('hex')
  }
}

// ---------- 阅读器侧(需要先解锁拿会话 cookie)----------

let cookie = ''

async function fetchWithTimeout(url, init = {}) {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: ac.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function unlock() {
  let status
  try {
    status = await (await fetchWithTimeout(`${cfg.url}/api/lock/status`)).json()
  } catch (err) {
    fail(`连不上阅读器 ${cfg.url}:${err.message}\n(本地开发请先 pnpm run dev;线上请用 --url 指定地址)`)
  }

  if (!status.isSet) {
    if (!cfg.password) fail(`阅读器还没设置访问码,先在浏览器打开 ${cfg.url} 设置一个,或用 --password 指定`)
    const res = await fetchWithTimeout(`${cfg.url}/api/lock/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: cfg.password }),
    })
    if (!res.ok) fail(`设置访问码失败:HTTP ${res.status}`)
    cookie = (res.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]).join('; ')
    return
  }

  if (status.unlocked) return
  if (!cfg.password) fail('阅读器已上锁:请在 .dev.vars 里填 SYNC_PASSWORD,或用 --password 传入访问码')
  const res = await fetchWithTimeout(`${cfg.url}/api/lock/unlock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: cfg.password }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    fail(`解锁失败:HTTP ${res.status} ${body.error ?? ''}`)
  }
  cookie = (res.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]).join('; ')
}

const appFetch = (path, init = {}) =>
  fetchWithTimeout(`${cfg.url}${path}`, { ...init, headers: { ...(init.headers ?? {}), ...(cookie ? { Cookie: cookie } : {}) } })

// ---------- 主流程 ----------

async function main() {
  const dir = resolve(cfg.dir)
  try {
    if (!statSync(dir).isDirectory()) fail(`不是目录:${dir}`)
  } catch {
    fail(`本地文档目录不存在:${dir}\n请在 .dev.vars 里设置 DOCS_DIR,或用 --dir 指定`)
  }

  log(`本地目录 ${dir}`)
  log(`阅读器   ${cfg.url}`)
  log('')

  await unlock()

  const localRes = await appFetch('/api/docs/tree')
  if (!localRes.ok) fail(`读取服务端清单失败:HTTP ${localRes.status} ${await localRes.text()}`)
  const remote = await localRes.json()
  const remoteShas = new Map(remote.files.map(f => [f.path, f.sha]))
  log(`服务端已有 ${remote.files.length} 个文件${remote.syncedAt ? `(上次同步 ${new Date(remote.syncedAt).toLocaleString()})` : '(从未同步)'}`)

  // 第一遍:算出每个文件的内容哈希,挑出需要上传的
  const all = walk(dir)
  const need = []
  let unchanged = 0
  const started = Date.now()
  for (let i = 0; i < all.length; i++) {
    const f = all[i]
    const bytes = readFileSync(f.full)
    f.sha = blobSha(bytes)
    if (remoteShas.get(f.rel) === f.sha) unchanged += 1
    else need.push(f)
    if ((i + 1) % 200 === 0) process.stdout.write(`\r  正在扫描本地 ${i + 1}/${all.length}   `)
  }

  const rev = resolveRev(dir, all)
  log(`\r  本地共 ${all.length} 个文件,其中 ${need.length} 个需要上传(未变 ${unchanged} 个),rev ${rev.slice(0, 8)}`)
  log('')

  const sleep = ms => new Promise(r => setTimeout(r, ms))
  let uploaded = 0

  /** 跑一轮上传,返回这一轮仍失败的文件(保留原对象,方便下一轮重试) */
  const runPass = async items => {
    const bad = []
    let cursor = 0
    let doneThisPass = 0
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
        for (;;) {
          const idx = cursor++
          if (idx >= items.length) return
          const f = items[idx]
          try {
            const bytes = readFileSync(f.full)
            const res = await appFetch(`/api/sync/put?path=${enc(f.rel)}&sha=${f.sha}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/octet-stream' },
              body: bytes,
            })
            if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 120)}`)
            uploaded += 1
          } catch (err) {
            bad.push({ ...f, error: err.message })
          }
          doneThisPass += 1
          if (doneThisPass % 25 === 0 || doneThisPass >= items.length) {
            const secs = ((Date.now() - started) / 1000).toFixed(0)
            process.stdout.write(`\r  已上传 ${uploaded}  本轮进度 ${doneThisPass}/${items.length}  失败 ${bad.length}  ${secs}s   `)
          }
        }
      }),
    )
    return bad
  }

  // 失败多半是网络抖动或云端一瞬间的限流,重试两轮通常就干净了。
  // 之前只跑一轮:一旦中途大面积失败,收尾照样会执行,结果就是"应用里只显示了一部分文件"
  // 而使用者毫不知情 —— 所以现在必须重试,并且下面还要做一次上传后自检。
  if (need.length > 0) process.stdout.write('  上传中…')
  let pending = need
  let failed = []
  for (let attempt = 1; attempt <= 3 && pending.length > 0; attempt++) {
    if (attempt > 1) {
      log(`\n  第 ${attempt} 轮:重试 ${pending.length} 个…`)
      await sleep(1000 * (attempt - 1))
    }
    failed = await runPass(pending)
    pending = failed
  }
  if (need.length > 0) process.stdout.write('\n')

  process.stdout.write('  收尾中…')
  const fin = await appFetch('/api/sync/finish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paths: all.map(f => f.rel), rev }),
  })
  if (!fin.ok) fail(`收尾失败:HTTP ${fin.status} ${await fin.text()}`)
  const result = await fin.json()

  // ---- 上传后自检:拿服务端清单与本地逐一对,少了什么直接点名 ----
  // 这一步是这次补上的关键:以后"应用里文件不全"能自己说话,不必靠猜。
  const after = await (await appFetch('/api/docs/tree')).json()
  const have = new Set(after.files.map(f => f.path))
  const missing = all.filter(f => !have.has(f.rel)).map(f => f.rel)

  log(`\r  完成:上传 ${uploaded} 个,删除 ${result.removed} 个  `)
  log(`  服务端现有 ${after.files.length} 个 / 本地 ${all.length} 个`)
  log(`  用时 ${((Date.now() - started) / 1000).toFixed(0)} 秒`)

  if (missing.length === 0) {
    log('  自检:两边文件清单完全一致 ✅')
  } else {
    log('')
    log(`  ⚠️ 自检发现服务端还缺 ${missing.length} 个文件 —— 应用里会看不到它们:`)
    for (const p of missing.slice(0, 10)) log(`     ${p}`)
    if (missing.length > 10) log(`     …还有 ${missing.length - 10} 个`)
    log('  再跑一次本命令即可续传(已传成功的不会重复上传)。')
    process.exitCode = 1
  }

  if (failed.length > 0) {
    log('')
    log(`  ⚠️ 有 ${failed.length} 个文件三轮都没传上去,失败原因:`)
    for (const f of failed.slice(0, 10)) log(`     ${f.rel} → ${f.error}`)
    if (failed.length > 10) log(`     …还有 ${failed.length - 10} 个`)
    process.exitCode = 1
  }
}

main().catch(err => fail(err?.stack ?? String(err)))
