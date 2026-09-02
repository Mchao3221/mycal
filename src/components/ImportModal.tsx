import { useEffect, useRef } from 'react'

interface Props {
  open: boolean
  onClose: () => void
  /** 提交链接:父组件负责后台导入与提示;弹窗在提交后立即由父组件收起 */
  onSubmit: (url: string) => void
}

export function ImportModal({ open, onClose, onSubmit }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)

  // 每次打开时清空上次输入并聚焦
  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  if (!open) return null

  return (
    <div className="modal modal-open" role="dialog" aria-modal="true" aria-label="导入 ICS 订阅">
      <div className="modal-box">
        <h3 className="text-lg font-semibold">导入 .ics 订阅</h3>
        <p className="mt-1 text-sm text-base-content/55">
          粘贴日历订阅链接,后台导入完成后日程会自动铺进日历。
        </p>
        <form
          className="mt-4 flex gap-2"
          onSubmit={e => {
            e.preventDefault()
            const url = inputRef.current?.value.trim()
            if (url) onSubmit(url)
          }}
        >
          <input
            ref={inputRef}
            className="input input-bordered w-full"
            placeholder="https://example.com/calendar.ics"
            aria-label="ICS 订阅链接"
          />
          <button type="submit" className="btn btn-primary">
            导入
          </button>
        </form>
        <div className="modal-action">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            关闭
          </button>
        </div>
        <p className="mt-2 font-mono text-[11px] text-base-content/40">
          快捷键 Ctrl+I 呼出 · Esc 关闭
        </p>
      </div>
      <button className="modal-backdrop" onClick={onClose} aria-label="关闭" />
    </div>
  )
}
