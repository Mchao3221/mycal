import { useEffect, useMemo, useState } from 'react'
import { api } from '../utils/api'
import { shiftKey, todayKey } from '../utils/date'
import { avgWithin, bmi, bmiBand, lastAtOrBefore, movingAvg, type WeightPoint } from '../utils/stats'
import type { Profile } from '../types'

interface Props {
  open: boolean
  onClose: () => void
  /** 全量升序体重序列 */
  series: WeightPoint[]
  onRemove: (key: string) => Promise<void>
  notify: (kind: 'success' | 'error', text: string) => void
}

const RANGES = [
  { days: 90, label: '90天' },
  { days: 365, label: '1年' },
  { days: 0, label: '全部' },
]

/** 体重曲线弹窗:纯看图与管理;录入只保留右栏「体重」一处(点哪天录哪天,补录同一路径) */
export function WeightModal({ open, onClose, series, onRemove, notify }: Props) {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [range, setRange] = useState(90)

  useEffect(() => {
    if (!open) return
    api<Profile | null>('/api/profile')
      .then(p => setProfile(p))
      .catch(err => console.error('加载档案失败:', err))
  }, [open])

  const chart = useMemo(() => {
    if (series.length === 0) return null
    const todayK = todayKey()
    const fullMa = movingAvg(series)
    const from = range > 0 ? shiftKey(todayK, -range) : null
    const idx: number[] = []
    series.forEach((p, i) => {
      if (!from || p.key >= from) idx.push(i)
    })
    if (!idx.length) idx.push(series.length - 1)
    const pts = idx.map(i => ({ ...series[i], ma: fullMa[i] }))

    // 日期比例横轴 + 数值纵轴(含目标线入域)
    const target = profile?.targetWeightKg ?? null
    const vals = pts.flatMap(p => [p.kg, p.ma, ...(target ? [target] : [])])
    const min = Math.min(...vals)
    const max = Math.max(...vals)
    const padV = Math.max(0.5, (max - min) * 0.12)
    const lo = min - padV
    const hi = max + padV
    const W = 620
    const H = 230
    const P = { l: 44, r: 16, t: 14, b: 26 }
    const t0 = Date.parse(pts[0].key + 'T00:00:00Z')
    const t1 = Date.parse(pts[pts.length - 1].key + 'T00:00:00Z')
    const x = (key: string) =>
      t1 === t0 ? (W + P.l - P.r) / 2 : P.l + ((Date.parse(key + 'T00:00:00Z') - t0) / (t1 - t0)) * (W - P.l - P.r)
    const y = (v: number) => P.t + (1 - (v - lo) / (hi - lo)) * (H - P.t - P.b)
    const maPath = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.key).toFixed(1)},${y(p.ma).toFixed(1)}`).join(' ')
    const ticks = [0, 0.25, 0.5, 0.75, 1].map(t => lo + (hi - lo) * t)
    return { pts, target, W, H, P, x, y, maPath, ticks, t0, t1 }
  }, [series, range, profile])

  const stats = useMemo(() => {
    const todayK = todayKey()
    const latest = series[series.length - 1] ?? null
    const avg7 = avgWithin(series, todayK, 7)
    // 与 30 天前的 7 日均值比,得到"真实趋势"(再绕开日波动)
    const prev = lastAtOrBefore(series, shiftKey(todayK, -30))
    const prevMa = prev ? (avgWithin(series.slice(0, series.indexOf(prev) + 1), prev.key, 7) ?? prev.kg) : null
    const delta30 = latest && prevMa != null ? Math.round((latest.kg - prevMa) * 10) / 10 : null
    const bmiVal = latest && profile?.heightCm ? bmi(latest.kg, profile.heightCm) : null
    const target = profile?.targetWeightKg ?? null
    let etaWeeks: number | null = null
    if (latest && delta30 != null && target != null && Math.abs(latest.kg - target) > 0.05) {
      const weekly = delta30 / 4.3
      const gap = target - latest.kg
      if (Math.abs(weekly) > 0.02 && Math.sign(weekly) === Math.sign(gap)) {
        etaWeeks = Math.min(104, Math.max(1, Math.ceil(Math.abs(gap / weekly))))
      }
    }
    return { latest, avg7, delta30, bmiVal, target, etaWeeks }
  }, [series, profile])

  if (!open) return null

  const recent = series.slice(-10).reverse()

  return (
    <div className="modal modal-open" role="dialog" aria-modal="true" aria-label="体重曲线">
      <div className="modal-box max-w-3xl">
        <h3 className="text-lg font-semibold">体重曲线</h3>

        {/* 三数一行 */}
        <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 font-mono text-xs text-base-content/60">
          <span>
            最新{' '}
            <b className="text-base-content text-sm tabular-nums">
              {stats.latest ? stats.latest.kg.toFixed(1) : '—'}
            </b>{' '}
            kg{stats.latest ? ` (${stats.latest.key.slice(5)})` : ''}
          </span>
          <span>
            7日均 <b className="text-base-content text-sm tabular-nums">{stats.avg7?.toFixed(1) ?? '—'}</b> kg
          </span>
          <span>
            较30日{' '}
            <b
              className={`text-sm tabular-nums ${
                stats.delta30 == null ? '' : stats.delta30 <= 0 ? 'text-success' : 'text-warning'
              }`}
            >
              {stats.delta30 == null ? '—' : `${stats.delta30 > 0 ? '+' : ''}${stats.delta30.toFixed(1)}`}
            </b>{' '}
            kg
          </span>
          {stats.bmiVal != null && (
            <span>
              BMI <b className={`text-sm tabular-nums ${bmiBand(stats.bmiVal).cls}`}>{stats.bmiVal}</b>{' '}
              <span className={bmiBand(stats.bmiVal).cls}>{bmiBand(stats.bmiVal).label}</span>
              <span className="text-base-content/35">(中国标准:≥24 超重 · ≥28 肥胖)</span>
            </span>
          )}
          {stats.target != null && stats.latest && (
            <span>
              目标 {stats.target.toFixed(1)} kg · 还差{' '}
              <b className="tabular-nums">{Math.abs(stats.latest.kg - stats.target).toFixed(1)}</b>
              {stats.etaWeeks ? `,按近期节奏约 ${stats.etaWeeks} 周达标` : ''}
            </span>
          )}
        </div>

        {/* 曲线 */}
        <div className="mt-3 flex items-center gap-1.5">
          {RANGES.map(r => (
            <button
              key={r.days}
              type="button"
              className={`btn btn-xs ${range === r.days ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setRange(r.days)}
            >
              {r.label}
            </button>
          ))}
        </div>
        {chart ? (
          <svg viewBox={`0 0 ${chart.W} ${chart.H}`} className="mt-1 w-full" role="img" aria-label="体重趋势图">
            {chart.ticks.map((v, i) => (
              <g key={i}>
                <line x1={chart.P.l} x2={chart.W - chart.P.r} y1={chart.y(v)} y2={chart.y(v)} stroke="var(--color-base-300)" strokeWidth="1" />
                <text x={chart.P.l - 6} y={chart.y(v) + 3} textAnchor="end" fontSize="10" fill="var(--color-base-content)" opacity="0.45" className="font-mono">
                  {v.toFixed(1)}
                </text>
              </g>
            ))}
            {chart.target != null && (
              <g>
                <line
                  x1={chart.P.l}
                  x2={chart.W - chart.P.r}
                  y1={chart.y(chart.target)}
                  y2={chart.y(chart.target)}
                  stroke="var(--color-success)"
                  strokeWidth="1.2"
                  strokeDasharray="5 4"
                  opacity="0.75"
                />
                <text x={chart.W - chart.P.r} y={chart.y(chart.target) - 4} textAnchor="end" fontSize="10" fill="var(--color-success)" className="font-mono">
                  目标 {chart.target.toFixed(1)}
                </text>
              </g>
            )}
            {chart.pts.map(p => (
              <circle key={p.key} cx={chart.x(p.key)} cy={chart.y(p.kg)} r="2.4" fill="var(--color-base-content)" opacity="0.22">
                <title>{`${p.key} ${p.kg.toFixed(1)} kg`}</title>
              </circle>
            ))}
            <path d={chart.maPath} fill="none" stroke="var(--color-primary)" strokeWidth="2.2" strokeLinecap="round" />
            <text x={chart.P.l} y={chart.H - 8} fontSize="10" fill="var(--color-base-content)" opacity="0.45" className="font-mono">
              {new Date(chart.t0).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}
            </text>
            <text x={chart.W - chart.P.r} y={chart.H - 8} textAnchor="end" fontSize="10" fill="var(--color-base-content)" opacity="0.45" className="font-mono">
              {new Date(chart.t1).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}
            </text>
          </svg>
        ) : (
          <p className="py-10 text-center text-sm text-base-content/50">还没有体重记录,在右栏「体重」块记一笔即可开始积累曲线</p>
        )}
        <p className="mt-1 mb-0 text-center font-mono text-[10px] text-base-content/40">
          实线为 7 日均滑(抵消水分/钠造成的日波动),浅点为每日原始值
        </p>

        {/* 近期记录管理(录入请回右栏「体重」块,点哪天录哪天) */}
        <div className="mt-3 flex items-center gap-2 border-t border-base-300 pt-3">
          <h4 className="m-0 font-mono text-[11px] uppercase tracking-[0.08em] text-base-content/45">
            近期记录
          </h4>
          <span className="ml-auto font-mono text-[11px] text-base-content/40">
            补录/修改:在日历选中那天,用右栏录入(同日覆盖)
          </span>
        </div>
        {recent.length > 0 && (
          <ul className="m-0 mt-2 max-h-40 list-none space-y-0 overflow-y-auto p-0 font-mono text-xs">
            {recent.map(p => (
              <li key={p.key} className="flex items-center gap-3 border-b border-base-300/60 py-1.5 last:border-b-0">
                <span className="tabular-nums text-base-content/70">{p.key}</span>
                <span className="tabular-nums">{p.kg.toFixed(1)} kg</span>
                <button
                  type="button"
                  className="ml-auto text-base-content/30 transition-colors hover:text-secondary"
                  onClick={() => void onRemove(p.key).catch(err => notify('error', String(err)))}
                  aria-label={`删除 ${p.key} 的体重记录`}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="modal-action">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
      <button className="modal-backdrop" onClick={onClose} aria-label="关闭" />
    </div>
  )
}
