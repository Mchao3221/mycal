import { useState } from 'react'

interface Props {
  onImported: () => Promise<void> | void
}

interface ImportResult {
  fetchedEvents: number
  imported: number
  duplicates: number
  skippedRecurring: number
  outOfWindow: number
}

export function ImportBar({ onImported }: Props) {
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const submit = async () => {
    const u = url.trim()
    if (!u || busy) return
    setBusy(true)
    setMsg(null)
    try {
      const res = await fetch('/api/ics/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: u }),
      })
      const data = (await res.json()) as ImportResult & { error?: string }
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`)

      const parts = [`导入 ${data.imported} 条日程`]
      if (data.duplicates) parts.push(`跳过重复 ${data.duplicates} 条`)
      if (data.skippedRecurring) parts.push(`重复规则事件未展开 ${data.skippedRecurring} 条`)
      if (data.outOfWindow) parts.push(`窗口外 ${data.outOfWindow} 条`)
      setMsg({ ok: true, text: parts.join(' · ') })
      setUrl('')
      await onImported()
    } catch (err) {
      setMsg({ ok: false, text: `导入失败:${err instanceof Error ? err.message : String(err)}` })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="import-bar card" aria-label="导入 ICS 订阅">
      <span className="import-label">导入 .ics 链接</span>
      <input
        value={url}
        onChange={e => setUrl(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault()
            void submit()
          }
        }}
        placeholder="https://example.com/calendar.ics"
        aria-label="ICS 订阅链接"
      />
      <button type="button" onClick={() => void submit()} disabled={busy || !url.trim()}>
        {busy ? '导入中…' : '导入'}
      </button>
      {msg && <span className={msg.ok ? 'import-msg ok' : 'import-msg err'}>{msg.text}</span>}
    </section>
  )
}
