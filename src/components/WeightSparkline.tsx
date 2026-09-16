import { useMemo } from 'react'
import { movingAvg, type WeightPoint } from '../utils/stats'

interface Props {
  /** 全量升序序列(内部自行截取近 N 个点) */
  series: WeightPoint[]
  recent?: number
}

/** 左栏迷你走势:近 N 点的 7 日均滑均线 + 末点强调,无坐标轴纯形状 */
export function WeightSparkline({ series, recent = 30 }: Props) {
  const view = useMemo(() => {
    if (series.length < 2) return null
    const ma = movingAvg(series)
    const start = Math.max(0, series.length - recent)
    const pts = series.slice(start).map((p, i) => ({ p, ma: ma[start + i] }))
    const vals = pts.flatMap(x => [x.p.kg, x.ma])
    const min = Math.min(...vals)
    const max = Math.max(...vals)
    const span = max - min || 1
    const W = 172
    const H = 44
    const pad = 5
    const x = (i: number) => (i / (pts.length - 1)) * (W - 2 * pad) + pad
    const y = (v: number) => pad + (1 - (v - min) / span) * (H - 2 * pad)
    const line = pts.map((q, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(q.ma).toFixed(1)}`).join(' ')
    return { W, H, line, lastX: x(pts.length - 1), lastY: y(pts[pts.length - 1].ma) }
  }, [series, recent])

  if (!view) {
    return <p className="m-0 py-2 text-xs text-base-content/45">记 2 天体重后这里会出现走势</p>
  }

  return (
    <svg viewBox={`0 0 ${view.W} ${view.H}`} className="h-11 w-full" aria-hidden="true">
      <path d={view.line} fill="none" stroke="var(--color-primary)" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx={view.lastX} cy={view.lastY} r="2.6" fill="var(--color-primary)" />
    </svg>
  )
}
