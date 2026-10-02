import { useCallback, useEffect, useRef, useState } from 'react'

interface Props {
  /** mermaid 渲染出来的 SVG 标记(由 hydrateMermaidBlocks 通过 onActivate 传入) */
  svg: string
  /** 图形的自然尺寸(viewBox),用于全屏里按原尺寸显示 */
  width: number
  height: number
  onClose: () => void
}

const MIN_SCALE = 0.2
const MAX_SCALE = 8
/** 位移小于这个像素数就当成「点击」而不是「拖拽」 */
const DRAG_THRESHOLD = 4

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

/**
 * Mermaid 全屏查看器。
 *
 * 交互按用户要求:点开即全屏、可拖拽平移、滚轮缩放、点击关闭。
 * 几个实现上必须注意的点:
 *  1. **滚轮必须手动 addEventListener 并带 { passive: false }** —— React 的 onWheel 是被动监听,
 *     里面调 preventDefault() 无效(还会在控制台刷警告),页面会跟着一起滚;
 *  2. **点击与拖拽要区分**:全屏里拖拽是在平移,松手时不能顺手把它关掉,
 *     所以按下到松开位移小于阈值才算「点击」;
 *  3. 缩放要以**光标位置为锚点**,否则放大后目标会跑出视野,得反复拖动去找。
 */
export function MermaidLightbox({ svg, width, height, onClose }: Props) {
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const stageRef = useRef<HTMLDivElement>(null)
  const svgHostRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number; moved: boolean } | null>(null)

  // ESC 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // 打开期间锁住背景滚动,否则滚轮会同时滚到下面的正文
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  // 滚轮缩放(锚定光标)
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const cx = e.clientX - rect.left - rect.width / 2
      const cy = e.clientY - rect.top - rect.height / 2
      setView(v => {
        const next = clamp(v.scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15), MIN_SCALE, MAX_SCALE)
        const k = next / v.scale
        // 让光标下的那个点在缩放前后停在原地
        return { scale: next, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k }
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  /**
   * 把克隆进来的 SVG 还原成自然尺寸。
   * 必须做:正文里那张图为了塞进阅读区,width/height 已经被改写成缩小后的值,
   * 直接拿过来全屏放大会是「放大的缩略图」——模糊且尺寸对不上。这里按 viewBox 的自然尺寸重置。
   */
  useEffect(() => {
    const el = svgHostRef.current?.querySelector('svg')
    if (!el || width <= 0 || height <= 0) return
    el.setAttribute('width', String(width))
    el.setAttribute('height', String(height))
    el.style.maxWidth = 'none'
    el.style.height = 'auto'
  }, [svg, width, height])

  // 刚打开时如果图比屏幕大,先缩到能放下,省得用户一进来只看到局部
  useEffect(() => {
    const el = stageRef.current
    if (!el || width <= 0 || height <= 0) return
    const availW = el.clientWidth - 48
    const availH = el.clientHeight - 48
    const fit = Math.min(availW / width, availH / height, 1)
    if (fit < 1) setView({ scale: clamp(fit, MIN_SCALE, MAX_SCALE), x: 0, y: 0 })
  }, [width, height])

  const zoomBy = useCallback((factor: number) => {
    setView(v => ({ ...v, scale: clamp(v.scale * factor, MIN_SCALE, MAX_SCALE) }))
  }, [])

  const onPointerDown = (e: React.PointerEvent) => {
    // 工具栏上的按钮不算拖拽
    if ((e.target as HTMLElement).closest('[data-mm-ui]')) return
    dragRef.current = { startX: e.clientX, startY: e.clientY, baseX: view.x, baseY: view.y, moved: false }
    setDragging(true)
    // 指针捕获让拖出容器后仍能收到 move;某些环境(合成事件/异常 pointerId)会抛,不能让它影响拖拽
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* 拿不到捕获也能拖,只是指针移出容器后可能丢事件 */
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d) return
    const dx = e.clientX - d.startX
    const dy = e.clientY - d.startY
    if (!d.moved && Math.abs(dx) + Math.abs(dy) > DRAG_THRESHOLD) d.moved = true
    if (d.moved) setView(v => ({ ...v, x: d.baseX + dx, y: d.baseY + dy }))
  }

  const onPointerUp = () => {
    const d = dragRef.current
    dragRef.current = null
    setDragging(false)
    // 没拖动过 = 这是一次点击 = 关闭
    if (d && !d.moved) onClose()
  }

  return (
    <div
      ref={stageRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      style={{ cursor: dragging ? 'grabbing' : 'grab', touchAction: 'none' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      role="dialog"
      aria-modal="true"
      aria-label="图形全屏查看"
    >
      <div
        ref={svgHostRef}
        className="mm-lightbox-svg"
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
        // 标记来自 mermaid 渲染结果(securityLevel: strict,标签已由 mermaid 自己消毒)
        dangerouslySetInnerHTML={{ __html: svg }}
      />

      {/* 工具栏:带 data-mm-ui,按下时不会被当成拖拽起点 */}
      <div
        data-mm-ui
        className="pointer-events-auto absolute bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-base-100/95 px-2 py-1 shadow-lg"
        onPointerDown={e => e.stopPropagation()}
      >
        <button type="button" className="btn btn-ghost btn-xs" onClick={() => zoomBy(1 / 1.25)} title="缩小">
          −
        </button>
        <span className="min-w-14 text-center text-xs tabular-nums text-base-content/60">
          {Math.round(view.scale * 100)}%
        </span>
        <button type="button" className="btn btn-ghost btn-xs" onClick={() => zoomBy(1.25)} title="放大">
          ＋
        </button>
        <button type="button" className="btn btn-ghost btn-xs" onClick={() => setView({ scale: 1, x: 0, y: 0 })}>
          100%
        </button>
        <span className="mx-1 hidden text-[11px] text-base-content/40 sm:inline">拖拽平移 · 滚轮缩放 · 点击关闭</span>
        <button type="button" className="btn btn-ghost btn-xs" onClick={onClose}>
          关闭
        </button>
      </div>
    </div>
  )
}
