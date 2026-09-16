// 健康数据统计小工具:体重序列 / 移动平均 / BMI(中国标准)/ 连续记录。
// 与图表组件解耦,纯函数好验证。
import { shiftKey } from './date'
import type { WeightStore } from '../types'

export interface WeightPoint {
  key: string
  kg: number
}

/** 按日期升序的体重序列 */
export function weightSeries(store: WeightStore): WeightPoint[] {
  return Object.keys(store)
    .sort()
    .map(k => ({ key: k, kg: store[k].weightKg }))
}

/**
 * 逐点"近 N 日均值":对每个点,取窗口内(含当天)已有的记录求平均。
 * 体重日波动 1~2 kg 多为水分/钠,移动平均主线才反映真实趋势。
 */
export function movingAvg(series: WeightPoint[], days = 7): number[] {
  return series.map((p, i) => {
    const lo = shiftKey(p.key, -(days - 1))
    let sum = 0
    let n = 0
    for (let j = i; j >= 0; j--) {
      if (series[j].key < lo) break
      sum += series[j].kg
      n++
    }
    return Math.round((sum / n) * 10) / 10
  })
}

/** 截至 endKey(含)向前看 days 天的均值;无数据返回 null */
export function avgWithin(series: WeightPoint[], endKey: string, days: number): number | null {
  const lo = shiftKey(endKey, -(days - 1))
  let sum = 0
  let n = 0
  for (const p of series) {
    if (p.key > endKey) break
    if (p.key >= lo) {
      sum += p.kg
      n++
    }
  }
  return n ? Math.round((sum / n) * 10) / 10 : null
}

/** 序列里不晚于 key 的最后一条 */
export function lastAtOrBefore(series: WeightPoint[], key: string): WeightPoint | null {
  let out: WeightPoint | null = null
  for (const p of series) {
    if (p.key > key) break
    out = p
  }
  return out
}

export function bmi(kg: number, cm: number): number {
  return Math.round((kg / (cm / 100) ** 2) * 10) / 10
}

/** BMI 分段按中国标准(<18.5 偏瘦 / 24 超重 / 28 肥胖) */
export function bmiBand(b: number): { label: string; cls: string } {
  if (b < 18.5) return { label: '偏瘦', cls: 'text-info' }
  if (b < 24) return { label: '正常', cls: 'text-success' }
  if (b < 28) return { label: '超重', cls: 'text-warning' }
  return { label: '肥胖', cls: 'text-error' }
}

/**
 * 连续记录天数:从今天往前数,连续拥有任意记录(打卡/流水/体重)的天数。
 * 今天还没记不判负(从昨天起算),避免白天随时显示 0。
 */
export function recordStreak(recordedKeys: ReadonlySet<string>, todayK: string): number {
  let cur = recordedKeys.has(todayK) ? todayK : shiftKey(todayK, -1)
  if (!recordedKeys.has(cur)) return 0
  let n = 0
  while (recordedKeys.has(cur)) {
    n++
    cur = shiftKey(cur, -1)
  }
  return n
}
