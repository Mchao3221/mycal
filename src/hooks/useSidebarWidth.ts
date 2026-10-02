import { useCallback, useEffect, useRef, useState } from 'react'
import { loadJson, saveJson } from '../utils/storage'

const MIN_WIDTH = 180
const MAX_WIDTH = 520
const DEFAULT_WIDTH = 264

const clamp = (value: number) => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(value)))

/**
 * 左侧目录栏宽度:可拖拽 + 记忆到 localStorage。
 * 拖拽期间把光标锁成 col-resize 并禁掉文本选中,否则鼠标划过正文会一路选中文字,手感很差。
 */
export function useSidebarWidth() {
  const [width, setWidth] = useState(() => clamp(loadJson('sidebarWidth', DEFAULT_WIDTH)))
  const cleanupRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    saveJson('sidebarWidth', width)
  }, [width])

  // 拖动过程中组件被卸载(比如点了上锁)时,别把监听器和光标样式留在页面里
  useEffect(() => () => cleanupRef.current?.(), [])

  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const prevCursor = document.body.style.cursor
    const prevSelect = document.body.style.userSelect
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const onMove = (ev: MouseEvent) => setWidth(clamp(ev.clientX))
    const stop = () => {
      document.body.style.cursor = prevCursor
      document.body.style.userSelect = prevSelect
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', stop)
      cleanupRef.current = null
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', stop)
    cleanupRef.current = stop
  }, [])

  return { width, onDragStart }
}
