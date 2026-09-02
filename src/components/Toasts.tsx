export interface ToastData {
  id: number
  kind: 'success' | 'error'
  text: string
}

export function Toasts({ items, onDismiss }: { items: ToastData[]; onDismiss: (id: number) => void }) {
  if (!items.length) return null
  return (
    <div className="toast toast-end z-50">
      {items.map(t => (
        <div
          key={t.id}
          className={`alert alert-vertical sm:alert-horizontal shadow-lg ${
            t.kind === 'success' ? 'alert-success' : 'alert-error'
          }`}
        >
          <span>{t.text}</span>
          <button
            type="button"
            className="btn btn-ghost btn-xs"
            onClick={() => onDismiss(t.id)}
            aria-label="关闭提示"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  )
}
