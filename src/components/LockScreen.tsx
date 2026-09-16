import { useEffect, useRef, useState } from 'react'
import { api } from '../utils/api'

interface Props {
  /** setup = 首次设置访问码;locked = 输入访问码解锁 */
  mode: 'setup' | 'locked'
  onUnlocked: () => void
}

/**
 * 全屏锁屏:未解锁时整页只渲染这一屏,连日历壳子都不出。
 * 校验全部在服务端(worker/lock.ts),这里只是表单;429 冷却信息透传后端文案。
 */
export function LockScreen({ mode, onUnlocked }: Props) {
  const [pwd, setPwd] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const firstRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    firstRef.current?.focus()
  }, [mode])

  const submit = async () => {
    if (busy) return
    if (mode === 'setup') {
      if (pwd.length < 6) {
        setError('访问码至少 6 位')
        return
      }
      if (pwd !== confirm) {
        setError('两次输入不一致')
        return
      }
    }
    setBusy(true)
    setError('')
    try {
      await api<{ ok: true }>(mode === 'setup' ? '/api/lock/setup' : '/api/lock/unlock', {
        method: 'POST',
        body: JSON.stringify({ password: pwd }),
      })
      onUnlocked()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setPwd('')
      firstRef.current?.focus()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-base-200 p-6">
      <form
        className="w-full max-w-sm rounded-box border border-base-300 bg-base-100 p-8 shadow-sm"
        onSubmit={e => {
          e.preventDefault()
          void submit()
        }}
      >
        <div className="mb-5 flex items-center gap-2.5">
          <span className="btn btn-primary btn-square btn-sm font-mono text-xs font-bold">M</span>
          <span className="font-display text-lg font-semibold tracking-tight">MyCal</span>
          <span className="badge badge-ghost badge-sm">私人健康日志</span>
        </div>

        {mode === 'setup' ? (
          <p className="mt-0 text-sm leading-relaxed text-base-content/60">
            首次使用,设置一个<b>访问码</b>。之后任何人打开本站,包括持有链接的人,
            都必须先输入它才能看到数据。忘记访问码无法自助找回,需到 Cloudflare D1 手动重置。
          </p>
        ) : (
          <p className="mt-0 text-sm leading-relaxed text-base-content/60">
            本应用已上锁,数据不会加载。请输入访问码解锁。
          </p>
        )}

        <input
          ref={firstRef}
          type="password"
          className="input input-bordered mt-4 w-full"
          value={pwd}
          onChange={e => setPwd(e.target.value)}
          placeholder={mode === 'setup' ? '设置访问码(≥6 位)' : '访问码'}
          autoComplete={mode === 'setup' ? 'new-password' : 'current-password'}
          aria-label="访问码"
        />
        {mode === 'setup' && (
          <input
            type="password"
            className="input input-bordered mt-2 w-full"
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            placeholder="再输一遍确认"
            autoComplete="new-password"
            aria-label="确认访问码"
          />
        )}

        {error && <p className="mb-0 mt-2 text-sm text-error">{error}</p>}

        <button type="submit" className="btn btn-primary mt-5 w-full" disabled={busy || !pwd || (mode === 'setup' && !confirm)}>
          {busy ? (
            <span className="inline-flex items-center gap-2">
              <span className="loading loading-spinner loading-xs" />
              {mode === 'setup' ? '设置中…' : '校验中…'}
            </span>
          ) : mode === 'setup' ? (
            '设置并进入'
          ) : (
            '解锁'
          )}
        </button>
      </form>
    </div>
  )
}
